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
  | "reconnecting"
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
  const shouldReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSupported(isBluetoothSupported());
  }, []);

  // Silently reconnect to the already-paired device after a drop. Only
  // device.gatt.connect() is called — no browser picker, no user gesture needed.
  function scheduleReconnect() {
    if (!shouldReconnectRef.current) return;
    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;
      if (!shouldReconnectRef.current || !deviceRef.current) return;
      setStatus("reconnecting");
      try {
        const result = await connectAndDiscover(deviceRef.current);
        if (!shouldReconnectRef.current) return;
        if (result.writable.length === 0) throw new Error("no writable char");
        charRef.current = result.writable[0].characteristic;
        setStatus("connected");
      } catch {
        scheduleReconnect(); // still out of range — retry in 3 s
      }
    }, 3000);
  }

  const connect = useCallback(async (showAll = false) => {
    // Cancel any pending auto-reconnect before starting a fresh manual connect.
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setError("");
    setStatus("connecting");
    try {
      const device = await requestPrinter(showAll);
      deviceRef.current = device;
      setDeviceName(device.name || "(unnamed)");
      shouldReconnectRef.current = true;

      device.addEventListener("gattserverdisconnected", () => {
        charRef.current = null;
        if (shouldReconnectRef.current) {
          scheduleReconnect();
        } else {
          setStatus("idle");
        }
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
      shouldReconnectRef.current = false;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    // Explicit disconnect — stop all auto-reconnect attempts.
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
