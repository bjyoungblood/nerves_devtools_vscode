// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { TreeDataProvider, TreeItem, ThemeIcon } from "vscode";

import { runOnDevice } from "./commands/run-on-device";
import { Device } from "./lib/device";
import { deviceManager } from "./lib/device-manager";

interface DeviceNode {
  nodeType: "device";
  device: Device;
}

interface DeviceSubitemNode {
  nodeType: "deviceSubitem";
  label: string;
  device: Device;
}

interface DeviceAlarmNode {
  nodeType: "alarm";
  label: string;
}

interface DeviceMetadataNode {
  nodeType: "metadata";
  label: string;
}

interface DeviceTelemetryNode {
  nodeType: "telemetry";
  label: string;
}

type DeviceTreeNode =
  | DeviceNode
  | DeviceSubitemNode
  | DeviceAlarmNode
  | DeviceMetadataNode
  | DeviceTelemetryNode;

class NervesDeviceTreeDataProvider implements TreeDataProvider<DeviceTreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<DeviceTreeNode | void> =
    new vscode.EventEmitter<DeviceTreeNode | void>();

  readonly onDidChangeTreeData: vscode.Event<DeviceTreeNode | void> =
    this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: DeviceTreeNode): TreeItem {
    let treeItem: TreeItem;
    if (node.nodeType === "device") {
      const device = node.device;
      const treeItem = new TreeItem(device.hostname);
      treeItem.contextValue = device.connectionState;

      switch (device.connectionState) {
        case "connected":
          treeItem.iconPath = new ThemeIcon("circle-filled");
          break;
        case "connecting":
          treeItem.iconPath = new ThemeIcon("sync~spin");
          break;
        case "disconnected":
          treeItem.iconPath = new ThemeIcon("circle-outline");
          break;
      }
      treeItem.iconPath = new ThemeIcon(
        device.connected ? "circle-filled" : "circle-outline",
      );

      treeItem.collapsibleState = device.connected
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;

      return treeItem;
    } else if (node.nodeType === "deviceSubitem") {
      treeItem = new TreeItem(node.label);
      if (node.label.startsWith("Alarms") && node.device.alarms.length > 0) {
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      }
      if (["Metadata", "Telemetry"].includes(node.label)) {
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      }
    } else {
      treeItem = new TreeItem(node.label);
      treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    return treeItem;
  }

  getChildren(node?: DeviceTreeNode): DeviceTreeNode[] {
    const children = this._getChildren(node);
    console.log("children for", node, "are", children);
    return children;
  }

  _getChildren(node?: DeviceTreeNode): DeviceTreeNode[] {
    if (!node) {
      return deviceManager.registeredDevices.map((key) => ({
        nodeType: "device",
        device: deviceManager.getDevice(key)!,
      }));
    }

    if (node.nodeType === "device" && !node.device.connected) {
      return [];
    }

    if (node.nodeType === "device" && node.device.connected) {
      return this.getDeviceChildren(node);
    }

    if (node.nodeType === "deviceSubitem") {
      return this.getSubitemChildren(node);
    }

    return [];
  }

  private getDeviceChildren(node: DeviceNode): DeviceTreeNode[] {
    return [
      {
        nodeType: `deviceSubitem`,
        label: `Alarms (${node.device.alarms.length})`,
        device: node.device,
      },
      node.device.metadata
        ? {
            nodeType: `deviceSubitem`,
            label: "Metadata",
            device: node.device,
          }
        : null,
      node.device.telemetry
        ? {
            nodeType: "deviceSubitem",
            label: "Telemetry",
            device: node.device,
          }
        : null,
    ].filter((v) => v !== null) as DeviceSubitemNode[];
  }

  private getSubitemChildren(node: DeviceSubitemNode): DeviceTreeNode[] {
    if (node.label.startsWith("Alarms")) {
      return node.device.alarms.map((alarm) => ({
        nodeType: "alarm",
        label: alarm,
      }));
    }

    if (node.label.startsWith("Metadata")) {
      return [
        `Active partition: ${node.device.metadata?.activePartition}`,
        `Arch: ${node.device.metadata?.fwArchitecture}`,
        `Platform: ${node.device.metadata?.fwPlatform}`,
        `Product: ${node.device.metadata?.fwProduct}`,
        `Version: ${node.device.metadata?.fwVersion}`,
        `UUID: ${node.device.metadata?.fwUuid}`,
      ].map((label) => ({ nodeType: "metadata", label }));
    }

    if (node.label.startsWith("Telemetry")) {
      return [
        `Uptime: ${node.device.telemetry?.uptime}`,
        node.device.telemetry?.loadAverage
          ? `Load Average: ${node.device.telemetry?.loadAverage}`
          : null,
        node.device.telemetry?.cpuTemperature
          ? `CPU Temp: ${node.device.telemetry?.cpuTemperature} °C`
          : null,
        node.device.telemetry?.memory
          ? `Memory: ${node.device.telemetry.memory.usedMb} / ${
              node.device.telemetry.memory.totalMb
            }MB (${Math.round(
              (node.device.telemetry.memory.usedMb /
                node.device.telemetry.memory.totalMb) *
                100,
            )}% used)`
          : null,
      ]
        .filter((v) => v !== null)
        .map((label) => ({ nodeType: "telemetry", label }));
    }

    return [];
  }
}

export function activate(context: vscode.ExtensionContext) {
  const devicesTreeProvider = new NervesDeviceTreeDataProvider();
  vscode.window.registerTreeDataProvider("devices", devicesTreeProvider);

  const disposable = vscode.commands.registerTextEditorCommand(
    "nerves-utils.run-on-device",
    (textEditor) => runOnDevice(context, textEditor),
  );

  vscode.commands.registerCommand("nerves-utils.refresh-devices", async () =>
    devicesTreeProvider.refresh(),
  );

  vscode.commands.registerCommand(
    "nerves-utils.connect",
    async (node?: DeviceTreeNode) => {
      if (!node || node.nodeType !== "device") return;
      try {
        await node.device.connect();
      } catch (err) {
        if (err instanceof Error) {
          vscode.window.showErrorMessage(err.message);
        }
      }

      setTimeout(() => devicesTreeProvider.refresh(), 100);
    },
  );
  vscode.commands.registerCommand(
    "nerves-utils.disconnect",
    async (node?: DeviceTreeNode) => {
      if (!node || node.nodeType !== "device") return;
      await node.device.disconnect();
      setTimeout(() => devicesTreeProvider.refresh(), 100);
    },
  );

  deviceManager.on("change", () => {
    devicesTreeProvider.refresh();
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
