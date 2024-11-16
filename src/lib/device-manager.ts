import Bonjour, { Browser, type Service } from "bonjour-service";
import EventEmitter from "events";

import { Device, RegistrationType } from "./device";

interface DeviceManagerEvents {
  change: [];
}

export class DeviceManager extends EventEmitter<DeviceManagerEvents> {
  private mdnsBrowser: Browser | null = null;
  private devices: { [key: string]: Device } = {};

  get registeredDevices() {
    return Object.keys(this.devices);
  }

  constructor() {
    super({ captureRejections: true });

    const bonjour = new Bonjour();
    this.mdnsBrowser = bonjour.find({
      type: "ssh",
      protocol: "tcp",
      txt: { ssh_subsystem_vscode: "1" },
    });

    this.mdnsBrowser.on("up", (svc: Service) => {
      this.addDevice(
        svc.host,
        svc.host,
        svc.port,
        "/Users/benyoungblood/.ssh/id_rsa",
        "mdns",
      );
    });

    this.mdnsBrowser.on("down", (svc: Service) => {
      const client = this.devices[svc.host];
      if (!client || client.type !== "mdns" || client.connected) return;

      delete this.devices[svc.host];
    });
  }

  public async connect(
    key: string,
    hostname: string,
    port: number,
    privateKeyPath: string,
  ) {
    if (this.devices[key] && this.devices[key].connected)
      return this.devices[key];

    const device = this.addDevice(
      key,
      hostname,
      port,
      privateKeyPath,
      "manual",
    );
    await device.connect();

    return device;
  }

  public getDevice(key: string): Device | null {
    return this.devices[key] || null;
  }

  public async disconnect(key: string) {
    if (!this.devices[key]) {
      return;
    }

    await this.devices[key].disconnect();
  }

  public async disconnectAll() {
    for (const key in this.devices) {
      await this.disconnect(key);
    }
    this.emit("change");
  }

  private addDevice(
    key: string,
    hostname: string,
    port: number,
    privateKeyPath: string,
    type: RegistrationType,
  ) {
    const device = new Device(hostname, port, privateKeyPath, type);
    device.on("connectionState", () => this.emit("change"));
    device.on("alarms", () => this.emit("change"));
    this.devices[key] = device;
    return device;
  }
}

export const deviceManager = new DeviceManager();
