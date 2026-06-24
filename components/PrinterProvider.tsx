"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  connectAndDiscover,
  isBluetoothSupported,
  requestPrinter,
  writeData,
} from "@/lib/printer";
import { buildTestReceipt } from "@/lib/escpos";

export type PrinterStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "printing"
  | "error";

interface PrinterContextValue {
  supported: boolean;
  status: PrinterStatus;
  deviceName: string;
  error: string;
  connect: (showAll?: boolean) => Promise<void>;
  disconnect: () => void;
  print: (data: Uint8Array) => Promise<void>;
  printTest: () => Promise<void>;
  isConnected: boolean;
}

const PrinterContext = createContext<PrinterContextValue | null>(null);

export function PrinterProvider({ children }: { children: React.ReactNode }) {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<PrinterStatus>("idle");
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState("");

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const charRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  useEffect(() => {
    setSupported(isBluetoothSupported());
  }, []);

  const connect = useCallback(async (showAll = false) => {
    setError("");
    setStatus("connecting");
    try {
      const device = await requestPrinter(showAll);
      deviceRef.current = device;
      setDeviceName(device.name || "(unnamed)");

      device.addEventListener("gattserverdisconnected", () => {
        charRef.current = null;
        setStatus("idle");
      });

      const result = await connectAndDiscover(device);
      if (result.writable.length === 0) {
        throw new Error(
          "No writable characteristic found. This printer may not support Web Bluetooth (BLE)."
        );
      }
      charRef.current = result.writable[0].characteristic;
      setStatus("connected");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    const d = deviceRef.current;
    if (d?.gatt?.connected) d.gatt.disconnect();
    charRef.current = null;
    setStatus("idle");
  }, []);

  const print = useCallback(async (data: Uint8Array) => {
    if (!charRef.current) {
      throw new Error("Printer not connected. Click Connect first.");
    }
    setStatus("printing");
    try {
      await writeData(charRef.current, data);
      setStatus("connected");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      throw err;
    }
  }, []);

  const printTest = useCallback(async () => {
    await print(buildTestReceipt());
  }, [print]);

  return (
    <PrinterContext.Provider
      value={{
        supported,
        status,
        deviceName,
        error,
        connect,
        disconnect,
        print,
        printTest,
        isConnected: status === "connected" || status === "printing",
      }}
    >
      {children}
    </PrinterContext.Provider>
  );
}

export function useBluetooth(): PrinterContextValue {
  const ctx = useContext(PrinterContext);
  if (!ctx)
    throw new Error("useBluetooth must be used within <PrinterProvider>");
  return ctx;
}
