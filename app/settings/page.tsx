"use client";

import { useEffect, useRef, useState } from "react";
import { getSettings, saveSettings, getUpiQrs, addUpiQr, deleteUpiQr } from "@/lib/db";
import { DEFAULT_SETTINGS, Settings, UpiQr } from "@/lib/types";
import { useBluetooth } from "@/components/PrinterProvider";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import { Printer, Check, QrCode, Upload, Trash2 } from "lucide-react";

// Down-scales an uploaded image to a crisp-but-small PNG data URL for storage.
function fileToDataUrl(file: File, max = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas unavailable"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("invalid image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [qrs, setQrs] = useState<UpiQr[]>([]);
  const [qrLabel, setQrLabel] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  const qrFileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
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
    getUpiQrs().then(setQrs).catch(() => {});
  }, []);

  async function handleQrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setQrBusy(true);
    try {
      const image = await fileToDataUrl(file);
      await addUpiQr(qrLabel.trim() || `UPI QR ${qrs.length + 1}`, image);
      setQrLabel("");
      setQrs(await getUpiQrs());
      toast("UPI QR added.", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't add QR.", "error");
    } finally {
      setQrBusy(false);
    }
  }
  async function removeQr(id: string) {
    if (!confirm("Remove this QR?")) return;
    try {
      await deleteUpiQr(id);
      setQrs((s) => s.filter((q) => q.id !== id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove QR.", "error");
    }
  }

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
    <div className="mx-auto w-full max-w-2xl space-y-5">
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
              disabled={!supported || status === "connecting" || status === "reconnecting"}
              className="btn-primary h-10"
            >
              {status === "connecting" ? "Connecting…" : status === "reconnecting" ? "Reconnecting…" : "Scan & Connect"}
            </button>
          )}
        </div>

        {!isConnected && supported && status !== "reconnecting" && (
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

      {/* UPI QR codes */}
      <div className="card space-y-4 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-canvas text-muted-dark">
            <QrCode size={19} />
          </div>
          <div>
            <p className="text-sm font-bold text-ink">UPI payment QR codes</p>
            <p className="text-xs text-muted">Add your GPay/PhonePe/Paytm QRs — show one to the customer when taking a UPI payment.</p>
          </div>
        </div>

        <input ref={qrFileRef} type="file" accept="image/*" onChange={handleQrFile} className="hidden" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={qrLabel}
            onChange={(e) => setQrLabel(e.target.value)}
            className="input sm:flex-1"
            placeholder="Label (e.g. GPay, PhonePe, Paytm)"
          />
          <button onClick={() => qrFileRef.current?.click()} disabled={qrBusy} className="btn-primary h-11">
            <Upload size={16} /> {qrBusy ? "Adding…" : "Upload QR"}
          </button>
        </div>

        {qrs.length === 0 ? (
          <p className="text-xs text-muted-light">No QR codes yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {qrs.map((q) => (
              <div key={q.id} className="rounded-tile border border-line p-2 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={q.image} alt={q.label} className="mx-auto aspect-square w-full rounded-md object-contain" />
                <p className="mt-1 truncate text-xs font-semibold text-ink">{q.label}</p>
                <button onClick={() => removeQr(q.id)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-danger hover:underline">
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
