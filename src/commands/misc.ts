import { commands, env } from "vscode";
import {
  DeviceMetadataNode,
  DeviceTreeDataProvider,
} from "../lib/device-tree-provider";

export function registerMiscCommands(
  deviceTreeProvider: DeviceTreeDataProvider,
) {
  const copy = commands.registerCommand(
    "nerves-devtools.copy",
    async function (text: string | DeviceMetadataNode) {
      if (typeof text === "object") {
        text = text.value;
      }

      await env.clipboard.writeText(text);
    },
  );

  const refresh = commands.registerCommand(
    "nerves-devtools.refresh-devices",
    async () => deviceTreeProvider.refresh(),
  );

  return [copy, refresh];
}
