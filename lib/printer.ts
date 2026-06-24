// Web Bluetooth (BLE/GATT) printer client with service auto-discovery.
//
// IMPORTANT: Web Bluetooth can NOT use the classic SPP UUID
// (00001101-0000-1000-8000-00805f9b34fb) — that is Bluetooth Classic RFCOMM,
// which browsers do not support. Cheap 58mm thermal printers almost always
// expose a BLE GATT service instead. The common ones are listed below; we also
// scan every service the device advertises so unknown printers still work.

export const KNOWN_PRINTER_SERVICES: BluetoothServiceUUID[] = [
  0x18f0, // common BLE thermal printer service (000018f0-...)
  0xff00, // some Goojprt / generic printers
  0xae30, // some BLE printers
  0xffe0, // HM-10 style serial modules
  0x1101, // included for discovery (won't be usable, but harmless to list)
];

export type DiscoveredCharacteristic = {
  serviceUuid: string;
  charUuid: string;
  properties: string[];
  characteristic: BluetoothRemoteGATTCharacteristic;
};

export type ConnectResult = {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  writable: DiscoveredCharacteristic[];
  all: DiscoveredCharacteristic[];
};

function listProps(c: BluetoothRemoteGATTCharacteristic): string[] {
  const p = c.properties;
  const out: string[] = [];
  if (p.broadcast) out.push("broadcast");
  if (p.read) out.push("read");
  if (p.writeWithoutResponse) out.push("writeNoResp");
  if (p.write) out.push("write");
  if (p.notify) out.push("notify");
  if (p.indicate) out.push("indicate");
  return out;
}

export function isBluetoothSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.bluetooth !== "undefined"
  );
}

// Name prefixes we treat as "this is a printer". The EZO unit advertises as
// "EZO PRINTER"; the others are common generic 58mm printer names. Matching is
// OR-based, so any device whose name starts with one of these shows up.
const PRINTER_NAME_PREFIXES = ["EZO", "Printer", "BlueTooth Printer", "MPT", "MTP"];

// Shows the browser device picker filtered to known printer names, so only the
// printer appears (no headphones/phones to mis-tap). If a printer ever uses an
// unlisted name, call requestPrinter(true) to fall back to showing all devices.
// optionalServices is still required so characteristics are readable after
// connecting.
export async function requestPrinter(showAll = false): Promise<BluetoothDevice> {
  if (!isBluetoothSupported()) {
    throw new Error(
      "Web Bluetooth is not available. Use Chrome or Edge over HTTPS or localhost."
    );
  }
  if (showAll) {
    return navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_PRINTER_SERVICES,
    });
  }
  return navigator.bluetooth.requestDevice({
    filters: PRINTER_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
    optionalServices: KNOWN_PRINTER_SERVICES,
  });
}

// Connects to GATT and enumerates every service + characteristic so we can
// report exactly what the printer exposes and pick a writable channel.
export async function connectAndDiscover(
  device: BluetoothDevice
): Promise<ConnectResult> {
  if (!device.gatt) throw new Error("Device has no GATT server.");
  const server = await device.gatt.connect();

  const services = await server.getPrimaryServices();
  const all: DiscoveredCharacteristic[] = [];

  for (const service of services) {
    let chars: BluetoothRemoteGATTCharacteristic[] = [];
    try {
      chars = await service.getCharacteristics();
    } catch {
      // some services block enumeration; skip
      continue;
    }
    for (const c of chars) {
      all.push({
        serviceUuid: service.uuid,
        charUuid: c.uuid,
        properties: listProps(c),
        characteristic: c,
      });
    }
  }

  const writable = all.filter(
    (c) =>
      c.characteristic.properties.write ||
      c.characteristic.properties.writeWithoutResponse
  );

  return { device, server, writable, all };
}

// BLE has a small payload limit per write (~20 bytes default, often up to
// ~180-512 after MTU negotiation). We chunk conservatively and add a tiny
// delay so the printer buffer keeps up.
export async function writeData(
  characteristic: BluetoothRemoteGATTCharacteristic,
  data: Uint8Array,
  chunkSize = 180,
  delayMs = 20
): Promise<void> {
  const useNoResponse = characteristic.properties.writeWithoutResponse;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.slice(offset, offset + chunkSize);
    if (useNoResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    if (delayMs > 0 && offset + chunkSize < data.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
