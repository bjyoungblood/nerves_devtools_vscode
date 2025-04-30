import vscode, {
  ThemeColor,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
} from "vscode";
import { Device } from "./device";
import { DeviceManager } from "./device-manager";

export interface DeviceNode {
  nodeType: "device";
  device: Device;
}

export interface DeviceSubitemNode {
  nodeType: "deviceSubitem";
  label: string;
  device: Device;
}

export interface DeviceAlarmNode {
  nodeType: "alarm";
  label: string;
}

export interface DeviceMetadataNode {
  nodeType: "metadata";
  label?: string;
  value: string;
}

export interface DeviceTelemetryNode {
  nodeType: "telemetry";
  label: string;
}

export type DeviceTreeNode =
  | DeviceNode
  | DeviceSubitemNode
  | DeviceAlarmNode
  | DeviceMetadataNode
  | DeviceTelemetryNode;

export class DeviceTreeDataProvider
  implements TreeDataProvider<DeviceTreeNode>
{
  private _onDidChangeTreeData: vscode.EventEmitter<DeviceTreeNode | void> =
    new vscode.EventEmitter<DeviceTreeNode | void>();

  readonly onDidChangeTreeData: vscode.Event<DeviceTreeNode | void> =
    this._onDidChangeTreeData.event;

  constructor(private readonly deviceManager: DeviceManager) {
    deviceManager.on("change", () => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: DeviceTreeNode): TreeItem {
    let treeItem: TreeItem;
    if (node.nodeType === "device") {
      const device = node.device;
      const treeItem = new TreeItem(device.label);
      treeItem.contextValue = `device-${device.connectionState}`;

      if (device.label !== device.host) {
        treeItem.description = device.host;
      }

      switch (device.connectionState) {
        case "open":
          treeItem.iconPath = new ThemeIcon("vm-active");
          break;
        case "connecting":
          treeItem.iconPath = new ThemeIcon("sync~spin");
          break;
        case "error":
          treeItem.iconPath = new ThemeIcon(
            "error",
            new ThemeColor("errorForeground"),
          );
          break;
        case "closing":
          treeItem.iconPath = new ThemeIcon("vm-outline");
          break;
        case "closed":
        default:
          treeItem.iconPath = new ThemeIcon("vm-outline");
          break;
      }

      treeItem.collapsibleState = device.connected
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;

      return treeItem;
    } else if (node.nodeType === "deviceSubitem") {
      treeItem = new TreeItem(node.label);
      if (node.label.startsWith("Alarms") && node.device.alarms.length > 0) {
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      }
      if (
        ["Metadata", "Telemetry"].includes(node.label) ||
        node.label.startsWith("Dirty Modules")
      ) {
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      }
    } else if (node.nodeType === "metadata") {
      let label;
      if (node.label) {
        label = `${node.label}: ${node.value}`;
      } else {
        label = node.value;
      }
      treeItem = new TreeItem(label);
      treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
      treeItem.contextValue = "metadata";
    } else {
      treeItem = new TreeItem(node.label);
      treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    return treeItem;
  }

  getChildren(node?: DeviceTreeNode): DeviceTreeNode[] {
    return this._getChildren(node);
  }

  _getChildren(node?: DeviceTreeNode): DeviceTreeNode[] {
    if (!node) {
      return this.deviceManager
        .getDevices()
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((device) => ({
          nodeType: "device",
          device,
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
      node.device.dirtyModules.length > 0
        ? {
            nodeType: "deviceSubitem",
            label: `Dirty Modules (${node.device.dirtyModules.length})`,
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
        ["Active partition", `${node.device.metadata?.activePartition}`],
        ["Arch", `${node.device.metadata?.fwArchitecture}`],
        ["Platform", `${node.device.metadata?.fwPlatform}`],
        ["Product", `${node.device.metadata?.fwProduct}`],
        ["Version", `${node.device.metadata?.fwVersion}`],
        ["UUID", `${node.device.metadata?.fwUuid}`],
      ].map(([label, value]) => ({ nodeType: "metadata", label, value }));
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

    if (node.label.startsWith("Dirty Modules")) {
      return node.device.dirtyModules.map((module) => ({
        nodeType: "metadata",
        value: module,
      }));
    }

    return [];
  }
}
