import { stripVTControlCharacters } from "node:util";
import {
  ExtensionContext,
  OutputChannel,
  ProgressLocation,
  QuickPick,
  QuickPickItem,
  commands,
  window,
  workspace,
} from "vscode";

import { DeviceManager } from "../lib/device-manager";
// import { pickDevice } from "../lib/pick-device";

interface DeviceQuickPickItem extends QuickPickItem {
  id: string;
}

let out: OutputChannel;
let qp: QuickPick<DeviceQuickPickItem>;

async function runOnDevice(
  context: ExtensionContext,
  deviceManager: DeviceManager,
) {
  const document = window.activeTextEditor?.document;

  if (document?.languageId !== "elixir") {
    window.showErrorMessage("This command only works with Elixir source files");
    return;
  }

  let device = deviceManager.getSelectedDevice();
  if (!device) {
    device = await commands.executeCommand("nerves-devtools.select-device");
  }

  if (!device) {
    return;
  }

  let editorFileName: string | null = null;
  if (!document.isUntitled) {
    editorFileName = workspace.asRelativePath(document.uri);
  }

  const code = document.getText();

  window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Connecting to ${device.label}...`,
    },
    async (notification) => {
      out.clear();
      try {
        if (!device.connected) {
          out.append(`Connecting to ${device.label}...`);
          try {
            await device.connect();
            out.append(" done!\n");
          } catch (err) {
            out.append(" failed!\n");
            console.error(err);
            return;
          }
        }

        out.appendLine(`Compiling ${editorFileName} on ${device.label}...`);
        notification.report({
          message: `Compiling ${editorFileName} on ${device.label}...`,
          increment: 50,
        });

        const { status, diagnostics } = await device.compileCode(
          code,
          editorFileName ?? undefined,
        );

        if (status === "ok") {
          out.appendLine(`Compilation successful!`);
          showMessage(
            "info",
            `${editorFileName} is compiled and loaded on ${device.label}.`,
            false,
          );
        } else {
          out.appendLine(`Compilation failed!`);
          out.appendLine("");
          showMessage(
            "error",
            `${editorFileName} failed to compile on ${device.label}. See output for diagnostics.`,
          );
        }

        if (Array.isArray(diagnostics)) {
          out.show(true);
          diagnostics.forEach((line) =>
            out.appendLine(stripVTControlCharacters(line)),
          );
        } else {
          out.appendLine(stripVTControlCharacters(diagnostics));
        }
      } catch (err) {
        if (err instanceof Error) {
          out.appendLine(`${err.name}: ${err.message}`);
        }
        showMessage(
          "error",
          `${editorFileName} failed to compile on ${device.label}. See output for diagnostics.`,
        );
        throw err;
      }
    },
  );
}

function showMessage(
  type: "info" | "error",
  message: string,
  showOutput: boolean = true,
) {
  let msg: Thenable<string | undefined>;
  const items = showOutput ? ["Show Output"] : [];
  if (type === "info") {
    msg = window.showInformationMessage(message, ...items);
  } else {
    msg = window.showErrorMessage(message, ...items);
  }

  msg.then((action) => {
    if (action === "Show Output") out.show();
  });
}

export default function register(
  context: ExtensionContext,
  deviceManager: DeviceManager,
) {
  out = window.createOutputChannel("Nerves Devtools: Run on Device");
  qp = window.createQuickPick();
  qp.canSelectMany = false;
  qp.title = "Enter Nerves device hostname or IP";

  const cmd = commands.registerCommand("nerves-devtools.run-on-device", () =>
    runOnDevice(context, deviceManager),
  );

  return [out, qp, cmd];
}
