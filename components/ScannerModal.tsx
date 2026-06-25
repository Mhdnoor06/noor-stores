"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
import { HINTS, decodeImageFile } from "@/lib/scan";
import { isValidEan13 } from "@/lib/barcode";
import { X, Zap, ZapOff, Keyboard, Camera, ScanLine } from "lucide-react";

// Format strings understood by the native BarcodeDetector (ML Kit / CoreImage).
const BD_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar"];

type Props = {
  open: boolean;
  onClose: () => void;
  onDetect: (code: string) => void;
  /** Keep scanning after a hit (billing). When false, close on first hit. */
  keepOpen?: boolean;
  title?: string;
};

// A short confirmation beep so the cashier knows a scan landed without looking.
let actx: AudioContext | null = null;
function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    actx = actx || new AC();
    if (actx.state === "suspended") actx.resume();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.frequency.value = 880;
    o.connect(g);
    g.connect(actx.destination);
    const t = actx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.start(t);
    o.stop(t + 0.16);
  } catch {
    /* audio not available — silent is fine */
  }
}

function camError(e: unknown): string {
  const name = (e as { name?: string })?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera permission was blocked. Allow camera access in the browser, or type the code manually.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera found. Use a USB/Bluetooth scanner, take a photo, or type the code.";
  return "Couldn't start the camera. Take a photo or type the code instead.";
}

export default function ScannerModal({ open, onClose, onDetect, keepOpen, title = "Scan barcode" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  // Confirmation buffer: a code must be read on consecutive frames before we
  // trust it — kills single-frame misreads (wrong number → "add new product").
  const pendingRef = useRef<{ code: string; count: number }>({ code: "", count: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const [err, setErr] = useState("");
  const [engine, setEngine] = useState<"native" | "zxing" | "">("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvail, setTorchAvail] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualVal, setManualVal] = useState("");
  const [flash, setFlash] = useState(false);
  const [lastCode, setLastCode] = useState("");

  // Gate every raw frame decode: reject impossible reads, then require the same
  // value twice in a row before accepting. A stray misread won't match the next
  // frame, so it's dropped instead of charged/added.
  const REQUIRED = 2;
  function consider(raw: string) {
    const code = (raw || "").trim();
    if (!code) return;
    // A 13-digit numeric must be a valid EAN-13 (check digit) — filters partials.
    if (/^\d{13}$/.test(code) && !isValidEan13(code)) return;
    const p = pendingRef.current;
    if (code === p.code) p.count += 1;
    else {
      p.code = code;
      p.count = 1;
    }
    if (p.count >= REQUIRED) {
      p.code = "";
      p.count = 0;
      accept(code);
    }
  }

  // Accept a confirmed value, with debounce so one barcode isn't added repeatedly.
  function accept(code: string) {
    code = (code || "").trim();
    if (!code) return;
    const now = Date.now();
    if (code === lastRef.current.code && now - lastRef.current.at < 1500) return;
    if (now - lastRef.current.at < 600) return;
    lastRef.current = { code, at: now };
    beep();
    navigator.vibrate?.(60);
    setLastCode(code);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 160);
    onDetect(code);
    if (!keepOpen) onClose();
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setErr("");
    setManual(false);
    setLastCode("");
    pendingRef.current = { code: "", count: 0 };
    lastRef.current = { code: "", at: 0 };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.setAttribute("playsinline", "true");
        await v.play().catch(() => {});

        const track = stream.getVideoTracks()[0];
        // Continuous autofocus is the single biggest fix for "blurry → won't scan".
        try {
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet] });
        } catch {
          /* not all cameras expose focusMode */
        }
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchAvail(!!caps.torch);

        // Prefer the OS-accelerated detector (much faster on phones); fall back to ZXing.
        const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorLike }).BarcodeDetector;
        let useNative = false;
        if (BD) {
          try {
            const sup = await BD.getSupportedFormats();
            useNative = sup.includes("ean_13");
          } catch {
            useNative = false;
          }
        }
        if (cancelled) return;
        if (useNative && BD) {
          setEngine("native");
          runNative(BD, v);
        } else {
          setEngine("zxing");
          runZxing(stream, v);
        }
      } catch (e) {
        if (!cancelled) setErr(camError(e));
      }
    })();

    return () => {
      cancelled = true;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function runNative(BD: BarcodeDetectorLike, v: HTMLVideoElement) {
    const detector = new BD({ formats: BD_FORMATS });
    let busy = false;
    const tick = async () => {
      if (!streamRef.current) return;
      if (!busy && v.readyState >= 2) {
        busy = true;
        try {
          const codes = await detector.detect(v);
          if (codes && codes[0]) consider(String(codes[0].rawValue));
        } catch {
          /* transient frame error — keep going */
        }
        busy = false;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function runZxing(stream: MediaStream, v: HTMLVideoElement) {
    const reader = new BrowserMultiFormatReader(HINTS);
    reader
      .decodeFromStream(stream, v, (result) => {
        if (result) consider(result.getText());
      })
      .then((c) => {
        controlsRef.current = c;
      })
      .catch((e) => setErr(camError(e)));
  }

  function stopAll() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorchOn(false);
    setEngine("");
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as unknown as MediaTrackConstraintSet] });
      setTorchOn((v) => !v);
    } catch {
      /* torch unsupported */
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const code = await decodeImageFile(f);
      if (code) accept(code);
      else setErr("Couldn't read that photo — keep the barcode flat, sharp and filling the frame.");
    } catch {
      setErr("Couldn't read that image. Try again.");
    }
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const v = manualVal.trim();
    if (v) {
      onDetect(v);
      if (!keepOpen) onClose();
      else {
        setManualVal("");
        setManual(false);
      }
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />

      {/* top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="flex items-center gap-2 text-sm font-bold">
          <ScanLine size={18} /> {title}
        </span>
        <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
          <X size={18} />
        </button>
      </div>

      {/* camera area */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />

        {!err && (
          <>
            {/* dim + scan window */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-44 w-[82%] max-w-md rounded-2xl border-2 border-white/80 shadow-[0_0_0_2000px_rgba(0,0,0,0.45)]">
                <span className={`absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-brand ${flash ? "" : "animate-pulse"}`} />
              </div>
            </div>
            <p className="absolute inset-x-0 top-3 text-center text-xs font-medium text-white/80">
              Point at the barcode — it scans automatically
            </p>
            {flash && (
              <div className="absolute inset-x-0 bottom-24 flex justify-center">
                <span className="rounded-full bg-ok px-4 py-1.5 text-sm font-bold text-white shadow-lg animate-pop">
                  ✓ {lastCode}
                </span>
              </div>
            )}
          </>
        )}

        {err && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera size={34} className="text-white/60" />
            <p className="max-w-sm text-sm text-white/90">{err}</p>
            <div className="flex gap-2">
              <button onClick={() => fileRef.current?.click()} className="btn-primary h-10">
                <Camera size={16} /> Take a photo
              </button>
              <button onClick={() => setManual(true)} className="btn-ghost h-10 border-white/30 bg-white/10 text-white hover:bg-white/20">
                <Keyboard size={16} /> Type code
              </button>
            </div>
          </div>
        )}
      </div>

      {/* bottom controls */}
      <div className="flex items-center justify-center gap-2 px-4 py-4">
        {torchAvail && !err && (
          <button
            onClick={toggleTorch}
            className={`btn h-11 px-4 ${torchOn ? "bg-amber text-white" : "border border-white/30 bg-white/10 text-white hover:bg-white/20"}`}
          >
            {torchOn ? <Zap size={17} /> : <ZapOff size={17} />} Torch
          </button>
        )}
        <button onClick={() => fileRef.current?.click()} className="btn h-11 border border-white/30 bg-white/10 px-4 text-white hover:bg-white/20">
          <Camera size={17} /> Photo
        </button>
        <button onClick={() => setManual(true)} className="btn h-11 border border-white/30 bg-white/10 px-4 text-white hover:bg-white/20">
          <Keyboard size={17} /> Type
        </button>
      </div>

      {engine === "zxing" && !err && (
        <p className="pb-3 text-center text-[11px] text-white/40">Basic scanner — for fastest scanning use Chrome on Android, or a USB/Bluetooth scanner.</p>
      )}

      {/* manual entry sheet */}
      {manual && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setManual(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submitManual} className="card w-full max-w-sm space-y-3 p-4">
            <p className="text-sm font-bold text-ink">Type the barcode</p>
            <input
              autoFocus
              value={manualVal}
              onChange={(e) => setManualVal(e.target.value)}
              inputMode="numeric"
              className="input"
              placeholder="e.g. 8901234567890"
            />
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1">
                Use code
              </button>
              <button type="button" onClick={() => setManual(false)} className="btn-ghost">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// Minimal shape of the native BarcodeDetector (not yet in TS DOM lib).
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorLike {
  new (opts?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}
