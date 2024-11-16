// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { basename } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { deviceManager } from "../lib/device-manager";

const out = vscode.window.createOutputChannel("Run on Nerves Device");
const qp = vscode.window.createQuickPick();
qp.canSelectMany = false;
qp.title = "Enter Nerves device hostname or IP";

// async function privateKeyPath(): Promise<string | null> {
//   const config = vscode.workspace.getConfiguration("nerves-utils");
//   if (!config.has("sshIdentityFile")) {
//     return null;
//   }

//   let identityFile = config.get<string>("sshIdentityFile", "");
//   if (!identityFile) {
//     return null;
//   }

//   if (identityFile.startsWith("~")) {
//     identityFile = join(homedir(), identityFile.replace("~", ""));
//   }

//   return realpath(identityFile);
// }

export async function runOnDevice(
  context: vscode.ExtensionContext,
  editor: vscode.TextEditor,
) {
  out.clear();

  vscode.window.visibleTextEditors.find(
    (v) => v.document.fileName === out.name,
  );

  console.log(vscode.window.visibleTextEditors);

  if (editor.document.languageId !== "elixir") {
    vscode.window.showErrorMessage(
      "This command only works with Elixir source files",
    );
    return;
  }

  const quickPickItems = deviceManager.registeredDevices.map(
    (deviceName): vscode.QuickPickItem => {
      return {
        label: deviceName,
        picked: deviceName === context.workspaceState.get("lastHost"),
      };
    },
  );

  qp.items = quickPickItems;
  qp.activeItems = quickPickItems.filter((item) => item.picked);

  const deviceName = await new Promise<string | null>((resolve) => {
    let done = false;
    qp.onDidHide(() => {
      if (done) return;
      done = true;
      resolve(null);
    });
    qp.onDidAccept(() => {
      if (done) return;
      done = true;
      resolve(qp.selectedItems[0].label);
      qp.hide();
    });

    qp.show();
  });

  console.log(deviceName);

  if (!deviceName) {
    return;
  }

  context.workspaceState.update("lastHost", deviceName);

  const editorFileName = basename(editor.document.fileName);

  const code = editor.document.getText();

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Connecting to ${deviceName}...`,
    },
    async (notification) => {
      try {
        const device = deviceManager.getDevice(deviceName)!;
        if (!device.connected) {
          out.append(`Connecting to ${deviceName}...`);
          try {
            await device.connect();
            out.append(" done!\n");
          } catch (err) {
            out.append(" failed!\n");
            if (err instanceof Error) {
              out.appendLine(err.message);
              if (err.stack) out.appendLine(err.stack);
              vscode.window.showErrorMessage(err.message);
            }
            throw err;
          }
        } else {
          out.appendLine(`Already connected to ${deviceName}`);
        }

        notification.report({
          message: `Uploading ${editorFileName} to ${deviceName}...`,
          increment: 50,
        });

        out.appendLine(`Uploading ${editorFileName} to ${deviceName}...`);
        notification.report({
          message: `Compiling ${editorFileName} on ${deviceName}...`,
        });

        const { status, result } = await device.sendCommand("compile_code", {
          code,
        });

        if (status === "ok") {
          out.appendLine(`Compilation successful!`);
          showMessage(
            "info",
            `${editorFileName} is compiled and loaded on ${deviceName}.`,
            false,
          );
        } else {
          out.appendLine(`Compilation failed!`);
          showMessage(
            "error",
            `${editorFileName} failed to compile on ${deviceName}. See output for diagnostics.`,
          );
        }

        if (Array.isArray(result)) {
          result.forEach((line) =>
            out.appendLine(stripVTControlCharacters(line)),
          );
        } else {
          out.appendLine(stripVTControlCharacters(result));
        }
      } catch (err) {
        if (err instanceof Error) {
          out.appendLine(`${err.name}: ${err.message}`);
        }
        showMessage(
          "error",
          `${editorFileName} failed to compile on ${deviceName}. See output for diagnostics.`,
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
    msg = vscode.window.showInformationMessage(message, ...items);
  } else {
    msg = vscode.window.showErrorMessage(message, ...items);
  }

  msg.then((action) => {
    if (action === "Show Output") out.show();
  });
}
