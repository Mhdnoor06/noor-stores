"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

// The beforeinstallprompt event isn't in the standard lib types.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    // Already running as an installed app — nothing to offer.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari exposes this non-standard flag.
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    const ua = window.navigator.userAgent;
    // iOS (incl. iPadOS reporting as Mac with touch) has no install prompt.
    const ios =
      /iphone|ipad|ipod/i.test(ua) ||
      (/macintosh/i.test(ua) && "ontouchend" in document);
    setIsIOS(ios);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Nothing to show: already installed, or not installable and not iOS.
  if (installed) return null;
  if (!deferred && !isIOS) return null;

  const handleClick = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
      return;
    }
    // iOS: no programmatic prompt — show the manual steps.
    setShowIosHelp((v) => !v);
  };

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className={
          compact
            ? "flex items-center gap-1.5 rounded-tile bg-brand px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
            : "flex w-full items-center justify-center gap-2 rounded-tile bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        }
      >
        <Download size={compact ? 14 : 16} strokeWidth={2.2} />
        Install app
      </button>

      {isIOS && showIosHelp && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-60 rounded-card border border-line bg-white p-3 text-xs leading-relaxed text-muted-dark shadow-pop">
          <button
            onClick={() => setShowIosHelp(false)}
            className="absolute right-2 top-2 text-muted-light hover:text-muted-dark"
            aria-label="Close"
          >
            <X size={14} />
          </button>
          <p className="mb-1 font-semibold text-ink">Add to Home Screen</p>
          <p className="flex items-center gap-1">
            Tap <Share size={13} className="inline" /> Share, then
          </p>
          <p>“Add to Home Screen”.</p>
        </div>
      )}
    </div>
  );
}
