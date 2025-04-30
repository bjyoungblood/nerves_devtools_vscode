// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { Disposable, ExtensionContext, window } from "vscode";
import type { CloseEvent as WsCloseEvent } from "ws";

import { DeviceExport } from "./lib/device";
import { DeviceManager } from "./lib/device-manager";
import { DeviceTreeDataProvider as DeviceTreeProvider } from "./lib/device-tree-provider";

import { registerDeviceCommands } from "./commands/device";
import runOnDevice from "./commands/run-on-device";
import { registerConnectionCommands } from "./commands/connection";
import { registerMiscCommands } from "./commands/misc";

declare module "phoenix" {
  type CloseEvent = WsCloseEvent;
}

declare module "erlang_js" {}

// TODO: break this function up a bit, move implementations to separate files
export function activate(context: ExtensionContext) {
  const storedDevices = context.globalState.get<DeviceExport[]>("devices", []);
  const deviceManager = new DeviceManager(storedDevices);

  const deviceTreeProvider = new DeviceTreeProvider(deviceManager);

  const disposables: Disposable[] = [
    deviceManager,
    window.registerTreeDataProvider(
      "nerves-devtools.devices",
      deviceTreeProvider,
    ),
    ...runOnDevice(context, deviceManager),
    ...registerDeviceCommands(context, deviceManager),
    ...registerConnectionCommands(deviceTreeProvider),
    ...registerMiscCommands(deviceTreeProvider),
  ];

  context.subscriptions.push(...disposables);
}

export function deactivate() {}
