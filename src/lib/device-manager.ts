import { Disposable } from "vscode";
import EventEmitter from "events";
import { randomUUID } from "crypto";

import { Device, DeviceExport } from "./device";

interface DeviceManagerEvents {
  change: [];
}

export class DeviceManager
  extends EventEmitter<DeviceManagerEvents>
  implements Disposable
{
  private devices: { [id: string]: Device } = {};

  constructor(importDevices: DeviceExport[] = []) {
    super({ captureRejections: true });
    for (const device of importDevices) {
      this.addDevice(device);
    }
  }

  async dispose() {
    this.disconnectAll();
    this.removeAllListeners();
  }

  public getDevices(): Device[] {
    return Object.values(this.devices);
  }

  public getDevice(id: string): Device | null {
    return this.devices[id] || null;
  }

  public async disconnect(id: string) {
    if (!this.devices[id]) {
      return;
    }

    await this.devices[id].disconnect();
  }

  public async disconnectAll() {
    for (const id in this.devices) {
      await this.disconnect(id);
    }
    this.emit("change");
  }

  public addDevice(device: Partial<DeviceExport> & { host: string }) {
    if (!device.host) {
      throw new Error("Device host is required");
    }
    return this.importDevice({ id: randomUUID(), ...device });
  }

  public async removeDevice(id: string) {
    if (!this.devices[id]) {
      return;
    }

    await this.devices[id].disconnect();
    delete this.devices[id];

    this.emit("change");
  }

  private importDevice({ id, host, label, tokenSecret }: DeviceExport) {
    const device = new Device(id, host, label, tokenSecret);
    this.devices[id] = device;
    device.on("connectionState", () => this.emit("change"));
    device.on("alarms", () => this.emit("change"));
    device.on("dirtyModules", () => this.emit("change"));
    device.on("metadata", () => this.emit("change"));
    device.on("telemetry", () => this.emit("change"));
    this.emit("change");
  }
}
