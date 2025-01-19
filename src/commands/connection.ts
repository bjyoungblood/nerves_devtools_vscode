import { commands, window } from "vscode";

import {
  DeviceTreeDataProvider,
  DeviceTreeNode,
} from "../lib/device-tree-provider";

export function registerConnectionCommands(
  deviceTreeProvider: DeviceTreeDataProvider,
) {
  const connect = commands.registerCommand(
    "nerves-devtools.connect",
    async (node?: DeviceTreeNode) => {
      if (!node || node.nodeType !== "device") return;
      try {
        await node.device.connect();
      } catch (err) {
        if (err instanceof Error) {
          window.showErrorMessage(err.message);
        }
      }

      setTimeout(() => deviceTreeProvider.refresh(), 100);
    },
  );

  const disconnect = commands.registerCommand(
    "nerves-devtools.disconnect",
    async (node?: DeviceTreeNode) => {
      if (!node || node.nodeType !== "device") return;
      await node.device.disconnect();
      setTimeout(() => deviceTreeProvider.refresh(), 100);
    },
  );

  return [connect, disconnect];
}
