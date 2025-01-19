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
      this.addDevice(device.host, device.label);
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

  public addDevice(host: string, label?: string | null) {
    const id = randomUUID();
    return this.importDevice({ id, host, label });
  }

  public async removeDevice(id: string) {
    if (!this.devices[id]) {
      return;
    }

    await this.devices[id].disconnect();
    delete this.devices[id];

    this.emit("change");
  }

  private importDevice({ id, host, label }: DeviceExport) {
    const device = new Device(id, host, label);
    this.devices[id] = device;
    device.on("connectionState", () => this.emit("change"));
    device.on("alarms", () => this.emit("change"));
    device.on("dirtyModules", () => this.emit("change"));
    device.on("metadata", () => this.emit("change"));
    device.on("telemetry", () => this.emit("change"));
    this.emit("change");
  }
}
