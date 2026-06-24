"use client";

import { useEffect, useState } from "react";
import { getSettings, saveSettings } from "@/lib/db";
import { DEFAULT_SETTINGS, Settings } from "@/lib/types";
import { useBluetooth } from "@/components/PrinterProvider";
import PageHeader from "@/components/PageHeader";
import { Printer, Check } from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const {
    supported,
    isConnected,
    deviceName,
    connect,
    disconnect,
    printTest,
    status,
    error,
  } = useBluetooth();

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Shop details and printer connection."
      />

      {/* Printer card first — most-used */}
      <div className="card space-y-3 p-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 flex-none items-center justify-center rounded-tile ${
              isConnected ? "bg-brand-soft text-brand" : "bg-canvas text-muted-dark"
            }`}
          >
            <Printer size={19} />
          </div>
          <div>
            <p className="text-sm font-bold text-ink">Printer (Bluetooth)</p>
            <p className="text-xs text-muted">
              {isConnected
                ? `Connected to ${deviceName || "printer"}.`
                : "Pair your EZO 58mm printer."}
            </p>
          </div>
        </div>

        {!supported && (
          <p className="rounded-[10px] bg-danger-soft p-2.5 text-xs text-danger">
            Web Bluetooth not supported. Use Chrome or Edge (Android/desktop). iPhone
            is not supported.
          </p>
        )}
        {error && status === "error" && (
          <p className="rounded-[10px] bg-danger-soft p-2.5 text-xs text-danger">{error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {isConnected ? (
            <>
              <button onClick={printTest} disabled={status === "printing"} className="btn-primary h-10">
                {status === "printing" ? "Printing…" : "Print test receipt"}
              </button>
              <button onClick={disconnect} className="btn-ghost h-10">
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => connect()}
              disabled={!supported || status === "connecting"}
              className="btn-primary h-10"
            >
              {status === "connecting" ? "Connecting…" : "Scan & Connect"}
            </button>
          )}
        </div>

        {!isConnected && supported && (
          <button
            onClick={() => connect(true)}
            disabled={status === "connecting"}
            className="text-xs font-medium text-muted-light hover:text-muted-dark disabled:opacity-50"
          >
            Can’t see your printer? Show all devices
          </button>
        )}
      </div>

      {/* Business details */}
      <form onSubmit={handleSave} className="card space-y-4 p-4">
        <div>
          <p className="text-sm font-bold text-ink">Business details</p>
          <p className="text-xs text-muted">These print at the top of every receipt.</p>
        </div>

        <label className="block">
          <span className="label">Business name</span>
          <input className="input" value={settings.businessName} onChange={(e) => update("businessName", e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Address (one line per row)</span>
          <textarea className="input" rows={2} value={settings.address} onChange={(e) => update("address", e.target.value)} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Phone</span>
            <input className="input" inputMode="tel" value={settings.phone} onChange={(e) => update("phone", e.target.value)} />
          </label>
          <label className="block">
            <span className="label">GSTIN (optional)</span>
            <input className="input" value={settings.gstin} onChange={(e) => update("gstin", e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="label">Receipt footer</span>
          <input className="input" value={settings.footer} onChange={(e) => update("footer", e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Paper width</span>
          <select
            className="input"
            value={settings.paperWidth}
            onChange={(e) => update("paperWidth", Number(e.target.value))}
          >
            <option value={32}>58mm (32 chars)</option>
            <option value={48}>80mm (48 chars)</option>
          </select>
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            Save settings
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-ok">
              <Check size={15} /> Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
