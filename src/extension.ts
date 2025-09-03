// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { Disposable, ExtensionContext, window } from "vscode";

import { DeviceManager } from "./lib/device-manager";
import { DeviceTreeDataProvider as DeviceTreeProvider } from "./lib/device-tree-provider";

import { registerDeviceCommands } from "./commands/device";
import runOnDevice from "./commands/run-on-device";
import { registerConnectionCommands } from "./commands/connection";
import { registerMiscCommands } from "./commands/misc";

export function activate(context: ExtensionContext) {
  const deviceManager = new DeviceManager(context);

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
