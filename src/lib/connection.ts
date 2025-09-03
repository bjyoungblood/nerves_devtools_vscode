import { Client, ClientChannel } from "ssh2";
import EventEmitter from "events";
import { promises as fs } from "fs";
import { homedir } from "os";
import * as path from "path";
import { workspace } from "vscode";
// import { setTimeoutAsync } from "./util";

const SUBSYSTEM_SCRIPT_PATH = path.join(
  __dirname,
  "../../resources/ssh_subsystem.ex",
);

export class TimeoutError extends Error {
  constructor() {
    super("Operation timed out");
    this.name = "TimeoutError";
  }
}

export function setTimeoutAsync(
  ms: number,
  type: "resolve",
): Promise<TimeoutError>;
export function setTimeoutAsync<T>(ms: number, type: "reject"): Promise<T>;

export function setTimeoutAsync(
  ms: number,
  type: "resolve" | "reject" = "reject",
) {
  return new Promise((resolve, reject) => {
    setTimeout(
      () => (type === "resolve" ? resolve : reject)(new TimeoutError()),
      ms,
    );
  });
}

const uninstallScript = `
NervesSSH.remove_subsystem(~c"nerves_devtools")
:code.purge(NervesDevServer)
:code.delete(NervesDevServer)
`;

export type ConnectionState =
  | "connecting"
  | "open"
  | "closing"
  | "closed"
  | "error";

interface ConnectionEvents {
  connectionState: [ConnectionState];
  error: [Error];
  message: [Record<string, unknown>];
}

export interface Response<T = unknown> {
  requestId: number;
  status: "ok" | "error";
  result: T;
}

function isResponse<T>(v: any): v is Response<T> {
  return (
    typeof v === "object" &&
    v !== null &&
    "requestId" in v &&
    "status" in v &&
    "result" in v
  );
}

interface Requests {
  [id: number]: {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  };
}

export class Connection extends EventEmitter<ConnectionEvents> {
  private client: Client;
  private channel: ClientChannel | null = null;
  private requests: Requests = {};
  private nextRequestId = 1;

  private _reconnectOnClose = false;
  private _reconnectDelay = 5000;
  private _reconnectMaxAttempts = 5;
  private _reconnectAttempts = 0;
  private _reconnectTimer: NodeJS.Timeout | null = null;
  private _connectionState: ConnectionState = "closed";

  private _host: string;

  constructor(host: string, private readonly _extensionVersion: string) {
    super({ captureRejections: true });

    this._host = host;

    this.client = new Client();

    this.client.on("ready", () => {
      this.connectionState = "open";
      console.log("Client :: ready");
    });

    this.client.on("error", (err) => {
      if (err.level === "client-ssh") {
        this.connectionState = "error";
      }
      this.connectionState = "error";
      console.error("Client :: error", err);
    });

    this.client.on("end", () => {
      this.connectionState = "closed";
      console.log("Client :: end");
    });

    this.client.on("connect", () => {
      this.connectionState = "connecting";
      console.log("client :: connect");
    });

    this.client.on("close", () => {
      if (this._reconnectOnClose) {
        this.reconnect();
      }
      this.connectionState = "closed";
      console.log("Client :: close");
    });
  }

  public get host() {
    return this._host;
  }

  public get connected() {
    return this.connectionState === "open";
  }

  private set connectionState(v: ConnectionState) {
    this._connectionState = v;
    this.emit("connectionState", v);
  }

  public get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private async clientConnect(timeout = 10000): Promise<void> {
    const privateKey = await this.readPrivateKey();
    await new Promise<void>((resolve, reject) => {
      this.client.once("ready", () => resolve());
      this.client.once("error", (err) => reject(err));
      this.client.once("timeout", () =>
        reject(new Error("Connection timeout")),
      );

      const [host, port] = this.splitHostAndPort(this._host);

      this.client.connect({
        username: "nerves",
        host,
        port,
        timeout,
        privateKey,
        readyTimeout: timeout,

        authHandler: ["agent", "publickey"],
        tryKeyboard: false,
        agent: process.env.SSH_AUTH_SOCK,
      });
    });
  }

  public async connect(timeout = 10000) {
    if (this._connectionState === "open") {
      return;
    }

    await this.clientConnect(timeout);
    this._reconnectOnClose = true;

    try {
      this.channel = await this.createDevServerChannel();
      // TODO: channel setup
    } catch (err: any) {
      if (err.message.startsWith("Unable to start subsystem")) {
        console.log("Subsystem not installed, installing now");
        await this.install();
        // changes to erlang's ssh daemon config (including new subsystems) only
        // apply to new connections, so we need to reconnect.
        await this.client.end();
        await this.clientConnect(timeout);
        this.channel = await this.createDevServerChannel();
      } else {
        console.log(err);
      }
    }
  }

  private async reconnect() {
    if (this._reconnectAttempts >= this._reconnectMaxAttempts) {
      this._reconnectAttempts++;
      this._reconnectTimer = setTimeout(
        () => this.reconnect(),
        this._reconnectDelay,
      );
    }
  }

  public async request(
    command: string,
    payload: any,
    timeout: number = 15000,
  ): Promise<Response> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    const requestId = this.nextRequestId++;
    const req = new Promise<Response>((resolve, reject) => {
      this.requests[requestId] = { resolve, reject };

      const cmd = JSON.stringify({ requestId, cmd: command, payload });

      this.channel!.write(cmd);
    }).finally(() => {
      delete this.requests[requestId];
    });

    return Promise.race([req, setTimeoutAsync<Response>(timeout, "reject")]);
  }

  private async createDevServerChannel(): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.client.subsys("nerves_devtools", (err, channel) => {
        if (err) {
          return reject(err);
        }

        channel.on("data", this.onData.bind(this));

        resolve(channel);
      });
    });
  }

  private async install() {
    let installScript = await fs.readFile(SUBSYSTEM_SCRIPT_PATH, "utf8");

    installScript += `\n\nNervesSSH.add_subsystem({~c"nerves_devtools", {NervesDevtools.Subsystem, [version: "${this._extensionVersion}"]}})`;

    await new Promise<void>((resolve, reject) => {
      this.client.exec(installScript, (err, ch) => {
        if (err) {
          console.error("Failed to execute command", err);
          return reject(err);
        }

        ch.on("data", (data: any) => {
          console.log("STDOUT:", data.toString());
        });

        ch.on("exit", (code) => {
          if (code === 0) {
            console.log("Installation successful");
            resolve();
          } else {
            console.error(`Installation failed with code ${code}`);
            reject(new Error(`Installation failed with code ${code}`));
          }
        });
      });
    });
  }

  public async uninstall() {
    await new Promise<void>((resolve, reject) => {
      this.client.exec(uninstallScript, (err, ch) => {
        if (err) {
          console.error("Failed to execute command", err);
          return reject(err);
        }

        ch.on("data", (data: any) => {
          console.log("STDOUT:", data.toString());
        });

        ch.on("exit", (code) => {
          if (code === 0) {
            console.log("Uninstall successful");
            resolve();
          } else {
            console.error(`Uninstall failed with code ${code}`);
            reject(new Error(`Uninstall failed with code ${code}`));
          }
        });
      });
    });
  }

  private async readPrivateKey(): Promise<string | undefined> {
    let privateKeyPath = workspace
      .getConfiguration("nerves-devtools")
      .get("privateKeyPath");

    if (typeof privateKeyPath !== "string" || !privateKeyPath) {
      return;
    }

    if (privateKeyPath.startsWith("~/")) {
      privateKeyPath = path.join(homedir(), privateKeyPath.slice(2));
    }

    try {
      return fs.readFile(privateKeyPath as string, { encoding: "utf8" });
    } catch (err) {
      console.error("Failed to read private key:", err);
      return;
    }
  }

  private onData(data: Buffer) {
    try {
      const message: Record<string, unknown> = JSON.parse(
        data.toString("utf8"),
      );
      this.handleMessage(message);
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  }

  private handleMessage(message: Record<string, unknown>) {
    if (isResponse(message) && this.requests[message.requestId]) {
      const { resolve } = this.requests[message.requestId];
      delete this.requests[message.requestId];

      resolve(message);
    } else if (isResponse(message)) {
      console.error("Got response for unknown message: ", message);
    } else {
      this.emit("message", message);
    }
    console.log("handleMessage", message);
  }

  private splitHostAndPort(host: string): [string, number] {
    const parts = host.split(":");
    const hostname = parts[0];
    const port = parts.length > 1 ? parseInt(parts[1], 10) : 22;
    return [hostname, port];
  }

  public async disconnect() {
    this._reconnectOnClose = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    Promise.race([
      new Promise<void>((resolve) => {
        this.client.once("close", () => resolve());
        this.client.end();
      }),
      setTimeoutAsync(10000, "resolve").then(() => {
        this.client?.destroy();
      }),
    ]);
  }

  public async dispose() {
    await this.disconnect();
    this.client.destroy();
  }
}
