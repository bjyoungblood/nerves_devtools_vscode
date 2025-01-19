import EventEmitter from "events";
import { window } from "vscode";
import { Socket, Channel, ConnectionState } from "phoenix";
import { ErrorEvent, WebSocket } from "ws";

import { setTimeoutAsync } from "./util";

export interface LogEvent {
  time: string;
  level: string;
  message: string;
  metadata: Record<string, any>;
}

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
  alarms: [Device, string[]];
  metadata: [Device, DeviceMetadata];
  telemetry: [Device, TelemetryData];
  connectionState: [Device, ConnectionState | "error"];
  dirtyModules: [Device, string[]];
  log: [Device, LogEvent];
}

export class Device extends EventEmitter<DeviceEventEmitterEvents> {
  private socket: Socket;
  private codeChannel: Channel | null = null;
  private logChannel: Channel | null = null;
  private telemetryChannel: Channel | null = null;

  private _label: string;
  private _connectError: boolean = false;

  private _alarms: string[] = [];
  private _telemetry: TelemetryData | null = null;
  private _metadata: DeviceMetadata | null = null;
  private _dirtyModules: string[] = [];

  constructor(
    private readonly _id: string,
    private _host: string,
    label?: string | null,
  ) {
    super({ captureRejections: true });

    this._label = label || this._host;

    this.socket = this.configureSocket();
  }

  public get connectionState(): ConnectionState | "error" {
    const cs = this.socket?.connectionState() ?? "closed";
    if (cs === "closed") {
      return this._connectError ? "error" : "closed";
    }
    return cs;
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

  public get alarms() {
    return this._alarms;
  }

  public get metadata() {
    return this._metadata;
  }

  public get telemetry() {
    return this._telemetry;
  }

  public get dirtyModules() {
    return this._dirtyModules;
  }

  public export(): DeviceExport {
    return {
      id: this._id,
      host: this._host,
      label: this._label,
    };
  }

  public async connect(timeout = 10000) {
    const promise = new Promise<void>((resolve, reject) => {
      let done = false;
      const dispose = () => {
        done = true;
        this.socket.off([onOpen, onClose, onError]);
      };
      const onOpen = this.socket.onOpen(() => {
        if (done) return;
        resolve();
        dispose();
      });
      const onClose = this.socket.onClose((e) => {
        console.error("Socket connection closed unexpectedly", e);
        if (done) return;
        reject(new Error("Connection closed"));
        dispose();
      });
      const onError = this.socket.onError(((e: ErrorEvent) => {
        console.error("Socket connection error", e);
        if (done) return;
        let message = `Failed to connect to ${this._label}`;
        if (typeof e.error === "object" && e.error?.code) {
          message += `: ${e.error.code}`;
        }
        window.showErrorMessage(message);
        reject(new Error(e.message));
        dispose();
      }) as any);
      this.socket?.connect();
    });

    return Promise.race([promise, setTimeoutAsync(timeout, "reject")]);
  }

  public async compileCode(code: string, filename?: string) {
    return new Promise<{ status: "ok" | "error"; diagnostics: string }>(
      (resolve, reject) => {
        if (!this.codeChannel) {
          return reject(new Error("Channel not connected"));
        }

        this.codeChannel
          .push("compile_code", { code, filename })
          .receive("ok", ({ diagnostics, dirtyModules }) => {
            this._dirtyModules = dirtyModules;
            this.emit("dirtyModules", this, dirtyModules);
            resolve({ status: "ok", diagnostics });
          })
          .receive("error", ({ diagnostics, dirtyModules }) => {
            this._dirtyModules = dirtyModules;
            this.emit("dirtyModules", this, dirtyModules);
            resolve({ status: "error", diagnostics });
          });
      },
    );
  }

  public async disconnect() {
    return new Promise<void>((resolve) => {
      this.socket?.disconnect(() => {
        this.resetState();
        resolve();
      });
    });
  }

  public async update({ host, label }: { host?: string; label?: string }) {
    if (host) this._host = host;
    if (label) this._label = label;

    const reconnect = this.connectionState !== "closed";
    await this.disconnect();
    this.socket = this.configureSocket();
    if (reconnect) await this.connect();
    this.emit("connectionState", this, this.connectionState);
  }

  private afterJoin(channel: string, message: any) {
    console.log("after join", channel, message);
    switch (channel) {
      case "code":
        this._dirtyModules = message.dirtyModules;
        this.emit("dirtyModules", this, this._dirtyModules);
        break;
      case "telemetry":
        this._metadata = message as DeviceMetadata;
        this.emit("metadata", this, this._metadata);
        break;
    }
  }

  private handleAlarms({ alarms }: { alarms: string[] }) {
    this._alarms = alarms;
    this.emit("alarms", this, alarms);
  }

  private handleTelemetry(telemetry: TelemetryData) {
    console.log("handleTelemetry", telemetry);
    this._telemetry = telemetry;
    this.emit("telemetry", this, telemetry);
  }

  private handleDirtyModules({ modules }: { modules: string[] }) {
    this._dirtyModules = modules;
    this.emit("dirtyModules", this, modules);
  }

  private resetState() {
    this._alarms = [];
    this._metadata = null;
    this._telemetry = null;
    this._dirtyModules = [];
  }

  private configureSocket() {
    const socket = new Socket(`http://${this._host}`, {
      transport: WebSocket,
    });

    socket.onOpen(() => {
      this.emit("connectionState", this, this.connectionState);
      this._connectError = false;
    });
    socket.onError(() => {
      this.emit("connectionState", this, this.connectionState);
      this._connectError = true;
    });
    socket.onClose(() => {
      this.emit("connectionState", this, this.connectionState);
    });

    this.codeChannel = socket.channel("code", {});
    this.codeChannel.join().receive("ok", this.afterJoin.bind(this, "code"));
    this.codeChannel.on("dirty_modules", this.handleDirtyModules.bind(this));

    // this.logChannel = socket.channel("logs", {});
    // this.logChannel.join();
    // this.logChannel.on("log", (message: LogEvent) => {
    //   console.log("log event", message);
    //   this.emit("log", this, message);
    // });

    this.telemetryChannel = socket.channel("telemetry", {});
    this.telemetryChannel
      .join()
      .receive("ok", this.afterJoin.bind(this, "telemetry"));
    this.telemetryChannel.on("telemetry", this.handleTelemetry.bind(this));
    this.telemetryChannel.on("alarms", this.handleAlarms.bind(this));

    return socket;
  }
}
