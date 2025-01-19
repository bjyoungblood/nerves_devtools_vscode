import { commands, ExtensionContext, window } from "vscode";

import { validateHostAndPort } from "../lib/util";
import { DeviceManager } from "../lib/device-manager";
import { DeviceNode } from "../lib/device-tree-provider";
import { pickDevice } from "../lib/pick-device";

export function registerDeviceCommands(
  context: ExtensionContext,
  deviceManager: DeviceManager,
) {
  const qp = window.createQuickPick();

  const add = commands.registerCommand(
    "nerves-devtools.add-device",
    async () => {
      const host = await window.showInputBox({
        title: "Device hostname/IP and port",
        placeHolder: "nerves.local:4000",
        prompt: "Enter the device's IP or hostname and Nerves Dev Server port.",
        validateInput: validateHostAndPort,
      });

      if (!host) {
        return;
      }

      const label = await window.showInputBox({
        title: "Label",
        placeHolder: "My Nerves device",
      });

      deviceManager.addDevice(host, label);

      await context.globalState.update(
        "devices",
        deviceManager.getDevices().map((d) => d.export()),
      );
    },
  );

  const edit = commands.registerCommand(
    "nerves-devtools.edit-device",
    async (node?: DeviceNode) => {
      const deviceId = node?.device.id ?? (await pickDevice(deviceManager));
      if (!deviceId) {
        return;
      }

      const device = deviceManager.getDevice(deviceId);
      if (!device) {
        return;
      }

      const host = await window.showInputBox({
        title: "Device hostname/IP and port",
        placeHolder: "nerves.local:4000",
        prompt: "Enter the device's IP or hostname and Nerves Dev Server port.",
        value: device?.host,
        validateInput: validateHostAndPort,
      });

      if (!host) {
        return;
      }

      const label = await window.showInputBox({
        title: "Label",
        placeHolder: "My Nerves device",
        value: device?.label,
      });

      device.update({ host, label });

      context.globalState.update(
        "devices",
        deviceManager.getDevices().map((d) => d.export()),
      );
    },
  );

  const del = commands.registerCommand(
    "nerves-devtools.delete-device",
    async (node?: DeviceNode) => {
      const deviceId = node?.device.id ?? (await pickDevice(deviceManager));
      if (!deviceId) {
        return;
      }

      if (!deviceManager.getDevice(deviceId)) {
        return;
      }

      const yn = await window.showWarningMessage(
        "Are you sure you want to delete this device?",
        { modal: true },
        { title: "Yes" },
        { title: "No", isCloseAffordance: true },
      );

      if (yn?.title !== "Yes") return;

      await deviceManager.removeDevice(deviceId);

      context.globalState.update(
        "devices",
        deviceManager.getDevices().map((d) => d.export()),
      );
    },
  );

  return [add, edit, del, qp];
}
