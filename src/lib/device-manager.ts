import {
  Disposable,
  ExtensionContext,
  StatusBarAlignment,
  StatusBarItem,
  commands,
  window,
} from "vscode";
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
  private context: ExtensionContext;
  private readonly extensionVersion: string;
  private statusBarItem: StatusBarItem;
  private devices: { [id: string]: Device } = {};

  constructor(context: ExtensionContext) {
    super({ captureRejections: true });
    this.context = context;
    this.extensionVersion = context.extension.packageJSON.version;

    const importDevices = context.globalState.get<DeviceExport[]>(
      "devices",
      [],
    );

    for (const device of importDevices) {
      this.addDevice(device);
    }

    this.statusBarItem = this.initStatusBarItem();
  }

  async dispose() {
    this.statusBarItem.dispose();
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

    if (this.getSelectedDeviceId() === id) {
      this.setSelectedDevice(null);
    }

    this.emit("change");
  }

  public setSelectedDevice(id: string | null) {
    this.context.workspaceState.update("selectedDevice", id);
    this.statusBarItem.text = this.statusBarItemText();
    commands.executeCommand(
      "setContext",
      "nerves-devtools.hasDeviceSelected",
      !!id,
    );
  }

  public getSelectedDevice(): Device | null {
    const id = this.context.workspaceState.get<string>("selectedDevice");
    if (!id) return null;

    const device = this.getDevice(id);
    if (!device) {
      this.context.workspaceState.update("selectedDevice", null);
      this.setSelectedDevice(null);
      return null;
    }

    return device;
  }

  public getSelectedDeviceId(): string | null {
    return this.context.workspaceState.get<string>("selectedDevice") ?? null;
  }

  private initStatusBarItem() {
    const statusBarItem = window.createStatusBarItem(
      "nerves-devtools.selectedDeviceStatusBarItem",
      StatusBarAlignment.Left,
    );
    statusBarItem.name = "Nerves Device";
    statusBarItem.text = this.statusBarItemText();
    statusBarItem.command = "nerves-devtools.select-device";
    statusBarItem.tooltip =
      "Select a Nerves device for the Run On Device command";
    statusBarItem.show();

    return statusBarItem;
  }

  private statusBarItemText() {
    const selectedDeviceId =
      this.context.workspaceState.get<string>("selectedDevice");
    const selectedDevice = selectedDeviceId
      ? this.getDevice(selectedDeviceId)
      : null;
    if (selectedDevice) {
      return `$(nerves-devtools) Nerves Device: ${selectedDevice.label}`;
    } else {
      return `$(nerves-devtools) Nerves Device: None`;
    }
  }

  private importDevice({ id, host, label }: DeviceExport) {
    const device = new Device(id, host, this.extensionVersion, label);
    this.devices[id] = device;
    device.on("connectionState", () => this.emit("change"));
    device.on("metadata", () => this.emit("change"));
    device.on("telemetry", () => this.emit("change"));
    this.emit("change");
  }
}
