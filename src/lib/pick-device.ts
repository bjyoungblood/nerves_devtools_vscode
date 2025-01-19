import { QuickPickItem, window } from "vscode";
import { DeviceManager } from "./device-manager";

export interface DeviceQuickPickItem extends QuickPickItem {
  id: string;
}

export async function pickDevice(
  deviceManager: DeviceManager,
  preselectedDeviceId?: string,
): Promise<string | null> {
  const qp = window.createQuickPick<DeviceQuickPickItem>();
  const devices = deviceManager.getDevices();
  const quickPickItems = devices.map((device): DeviceQuickPickItem => {
    return {
      id: device.id,
      label: device.label,
    };
  });

  qp.items = quickPickItems;
  qp.activeItems = quickPickItems.filter(
    (item) => item.id === preselectedDeviceId,
  );
  qp.canSelectMany = false;

  const deviceId = await new Promise<string | null>((resolve) => {
    let done = false;

    const dispose = () => {
      qp.hide();
      qp.dispose();
      onDidHide.dispose();
      onDidAccept.dispose();
    };

    const onDidHide = qp.onDidHide(() => {
      if (done) return;
      done = true;
      resolve(null);
      dispose();
    });

    const onDidAccept = qp.onDidAccept(() => {
      if (done) return;
      if (qp.selectedItems.length === 0) return;
      done = true;
      resolve(qp.selectedItems[0]?.id);
      qp.selectedItems = [];
      dispose();
    });

    qp.show();
  });

  return deviceId;
}
