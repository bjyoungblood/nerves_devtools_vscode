import EventEmitter from "events";

import { Connection, ConnectionState } from "./connection";

export interface DeviceExport {
  id: string;
  host: string;
  label?: string | null;
}

export interface TelemetryData {
  uptime: string | null;
  loadAverage: string | null;
  cpuTemperature: number | null;
  memory: {
    usedMb: number;
    totalMb: number;
  } | null;
}

export interface DeviceMetadata {
  fwValid: boolean;
  activePartition: string;
  fwArchitecture: string;
  fwPlatform: string;
  fwProduct: string;
  fwVersion: string;
  fwUuid: string;
}

interface DeviceEventEmitterEvents {
  connectionState: [Device, ConnectionState];
  telemetry: [TelemetryData];
  metadata: [DeviceMetadata];
}

interface MetadataEvent {
  event: "metadata";
  data: DeviceMetadata;
}

interface TelemetryEvent {
  event: "telemetry";
  data: TelemetryData;
}

type ServerEvent = MetadataEvent | TelemetryEvent;

function isServerEvent(event: any): event is ServerEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "event" in event &&
    "data" in event
  );
}

export class Device extends EventEmitter<DeviceEventEmitterEvents> {
  private _connection: Connection;

  private _label: string;
  private _metadata: DeviceMetadata | null = null;
  private _telemetry: TelemetryData | null = null;

  constructor(
    private readonly _id: string,
    private _host: string,
    private readonly _extensionVersion: string,
    label?: string | null,
  ) {
    super({ captureRejections: true });

    this._label = label || this._host;

    this._connection = this.createConnection();
  }

  public get connectionState(): ConnectionState {
    return this._connection?.connectionState ?? "closed";
  }

  public get id() {
    return this._id;
  }

  public get host() {
    return this._host;
  }

  public get label() {
    return this._label;
  }

  public get connected() {
    return this.connectionState === "open";
  }

  public get metadata() {
    return this._metadata;
  }

  public get telemetry() {
    return this._telemetry;
  }

  public export(): DeviceExport {
    return {
      id: this._id,
      host: this._host,
      label: this._label,
    };
  }

  public async connect(timeout = 10000) {
    return this._connection.connect(timeout);
  }

  public async compileCode(code: string, filename?: string) {
    await this.connect(10000);

    const result = await this._connection.request("compile_code", {
      code,
      file: filename,
    });
    if (result.status === "ok") {
      // Handle successful compilation

      return { status: "ok", diagnostics: result.result as string[] };
    } else {
      return { status: "error", diagnostics: result.result as string[] };
    }
  }

  public async disconnect() {
    return this._connection.disconnect();
  }

  public async update({ host, label }: Omit<Partial<DeviceExport>, "id">) {
    if (host) this._host = host;
    if (label) this._label = label;

    const reconnect = this.connectionState !== "closed";
    await this.disconnect();
    this._connection = this.createConnection();

    if (reconnect) await this.connect();
  }

  private handleMessage(event: Record<string, unknown>) {
    if (!isServerEvent(event)) {
      console.log("Unexpected event from server", event);
      return;
    }

    switch (event.event) {
      case "metadata":
        this._metadata = event.data;
        this.emit("metadata", event.data);
        break;
      case "telemetry":
        this._telemetry = event.data;
        this.emit("telemetry", event.data);
        break;
    }
  }

  private createConnection() {
    const conn = new Connection(this._host, this._extensionVersion);
    conn.on("connectionState", (state) => {
      this.emit("connectionState", this, state);
    });
    conn.on("message", this.handleMessage.bind(this));
    return conn;
  }
}
