import { Channel, Client } from "ssh2";
import EventEmitter from "events";
import { randomUUID } from "crypto";
import { awaitTimeout } from "./util";

export type RegistrationType = "mdns" | "manual";
export type ConnectionState = "connected" | "connecting" | "disconnected";

interface CommandResponse<T> {
  status: "ok" | "error";
  result: T;
  requestId: string;
}

function isCommandResponse<T>(v: unknown): v is CommandResponse<T> {
  return !!v && typeof v === "object" && "status" in v && "result" in v;
}

interface DeviceEvent<E, T> {
  event: E;
  data: T;
}

interface TelemetryData {
  uptime: string | null;
  loadAverage: string | null;
  cpuTemperature: number | null;
  memory: {
    usedMb: number;
    totalMb: number;
  } | null;
}

interface DeviceMetadata {
  fwValid: boolean;
  activePartition: string;
  fwArchitecture: string;
  fwPlatform: string;
  fwProduct: string;
  fwVersion: string;
  fwUuid: string;
}

function isDeviceEvent<E, T>(v: unknown): v is DeviceEvent<E, T> {
  return !!v && typeof v === "object" && "event" in v && "data" in v;
}

interface DeviceEventEmitterEvents {
  alarms: [Device, string[]];
  metadata: [Device, DeviceMetadata];
  telemetry: [Device, TelemetryData];
  connectionState: [Device, ConnectionState];
}

export class Device extends EventEmitter<DeviceEventEmitterEvents> {
  #client: Client | null = null;
  #channel: Channel | null = null;
  #alarms: string[] = [];
  #telemetry: TelemetryData | null = null;
  #metadata: DeviceMetadata | null = null;

  private _connectionState: ConnectionState = "disconnected";

  private _inflight: Record<string, (...args: unknown[]) => unknown> = {};

  constructor(
    public readonly hostname: string,
    public readonly port: number,
    private privateKeyPath: string,
    public readonly type: RegistrationType = "manual",
  ) {
    super({ captureRejections: true });
  }

  public get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private set connectionState(state: ConnectionState) {
    this._connectionState = state;
    console.info(`${this.hostname} ssh connection state: ${state}`);
    this.emit("connectionState", this, state);
  }

  public get connected() {
    return this._connectionState === "connected";
  }

  public get alarms() {
    return this.#alarms;
  }

  public get metadata() {
    return this.#metadata;
  }

  public get telemetry() {
    return this.#telemetry;
  }

  public async connect() {
    // if (this.#client && this.#client.)
    // const privateKey = await readFile(this.privateKeyPath);

    this._connectionState = "connecting";

    return new Promise<void>((resolve, reject) => {
      this.#client = new Client();

      this.#client.connect({
        username: "nerves",
        host: this.hostname,
        port: this.port,
        agent: process.env.SSH_AUTH_SOCK,
        // privateKey,
      });

      this.#client.on("error", (msg) => {
        console.error("SSH error: ", msg);
        this._connectionState = "disconnected";
        this.#client?.destroy();
        this.#client = null;
        reject(msg);
      });

      this.#client.on("end", () => {
        this.#client = null;
        this._connectionState = "disconnected";
      });

      this.#client.on("ready", async () => {
        this.#client!.subsys("nerves_vscode", (err, channel) => {
          if (err) {
            reject(err);
            return;
          }

          this.#channel = channel;
          this._connectionState = "connected";

          this.#channel.on("data", this.handleData.bind(this));

          this.#channel.on("end", () => {
            this.#channel = null;
            this._connectionState = "disconnected";
            this.#client?.end();
          });

          resolve();
        });
      });
    });
  }

  public async sendCommand(
    cmd: "exec",
    payload: { data: string },
  ): Promise<CommandResponse<string>>;

  public async sendCommand(
    cmd: "compile_code",
    payload: { code: string },
  ): Promise<CommandResponse<string | string[]>>;

  public async sendCommand(
    cmd: string,
    payload: unknown,
    timeout: number = 10000,
  ) {
    if (!this.connected) await this.connect();

    const requestId = randomUUID();
    const req = new Promise((resolve, reject) => {
      if (!this.#channel) {
        return reject(new Error("Channel not connected"));
      }

      this._inflight[requestId] = resolve;

      this.#channel?.write(
        JSON.stringify({ cmd, payload, requestId }) + "\n",
        (err) => err && reject(err),
      );
    });

    return Promise.race([req, awaitTimeout(timeout, "reject")]);
  }

  public async disconnect() {
    if (!this.connected) return;

    this.#client!.end();
  }

  private handleData(data: string) {
    try {
      const command = JSON.parse(data);

      console.info("Processing command: ", command);

      if (isCommandResponse(command)) {
        const resolveFn = this._inflight[command.requestId];
        if (!resolveFn) {
          console.error("Received response for unknown request: ", command);
          return;
        } else {
          console.info("found request", command.requestId);
        }
        delete this._inflight[command.requestId];
        resolveFn(command);
        return;
      }

      if (isDeviceEvent(command)) {
        switch (command.event) {
          case "alarms":
            console.info("received alarms", command.data);
            this.#alarms = command.data as string[];
            this.emit("alarms", this, this.alarms);
            break;
          case "device_metadata":
            this.#metadata = command.data as DeviceMetadata;
            this.emit("metadata", this, this.#metadata);
            break;
          case "telemetry":
            this.#telemetry = command.data as TelemetryData;
            this.emit("telemetry", this, this.#telemetry);
            break;
        }
      }

      // TODO: check for invalid command errors and other events
    } catch {
      console.error("Invalid JSON data received from device: ", data);
    }
  }
}
