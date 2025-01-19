// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import { stripVTControlCharacters } from "node:util";
import {
  ExtensionContext,
  OutputChannel,
  ProgressLocation,
  QuickPick,
  QuickPickItem,
  TextEditor,
  commands,
  window,
  workspace,
} from "vscode";

import { DeviceManager } from "../lib/device-manager";
import { pickDevice } from "../lib/pick-device";

interface DeviceQuickPickItem extends QuickPickItem {
  id: string;
}

let out: OutputChannel;
let qp: QuickPick<DeviceQuickPickItem>;

async function runOnDevice(
  context: ExtensionContext,
  editor: TextEditor,
  deviceManager: DeviceManager,
) {
  out.clear();

  window.visibleTextEditors.find((v) => v.document.fileName === out.name);

  if (editor.document.languageId !== "elixir") {
    window.showErrorMessage("This command only works with Elixir source files");
    return;
  }

  const lastHost = context.workspaceState.get<string>("lastHost");
  const deviceId = await pickDevice(deviceManager, lastHost);
  if (!deviceId) {
    return;
  }

  const device = deviceManager.getDevice(deviceId);
  if (!device) {
    return;
  }

  context.workspaceState.update("lastHost", deviceId);

  let editorFileName: string | null = null;
  if (!editor.document.isUntitled) {
    editorFileName = workspace.asRelativePath(editor.document.uri);
  }

  const code = editor.document.getText();

  window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Connecting to ${device.label}...`,
    },
    async (notification) => {
      try {
        const device = deviceManager.getDevice(deviceId)!;
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
        } else {
          out.appendLine(`Already connected to ${device.label}`);
        }

        out.appendLine(`Uploading ${editorFileName} to ${device.label}...`);
        notification.report({
          message: `Compiling ${editorFileName} on ${device.label}...`,
          increment: 50,
        });

        const { status, diagnostics } = await device.compileCode(code);

        if (status === "ok") {
          out.appendLine(`Compilation successful!`);
          showMessage(
            "info",
            `${editorFileName} is compiled and loaded on ${device.label}.`,
            false,
          );
        } else {
          out.appendLine(`Compilation failed!`);
          showMessage(
            "error",
            `${editorFileName} failed to compile on ${device.label}. See output for diagnostics.`,
          );
        }

        if (Array.isArray(diagnostics)) {
          out.show();
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

  const cmd = commands.registerTextEditorCommand(
    "nerves-devtools.run-on-device",
    (textEditor) => runOnDevice(context, textEditor, deviceManager),
  );

  return [out, qp, cmd];
}
