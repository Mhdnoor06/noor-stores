"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getItems, seedLocalCounterFromServer, syncOutbox } from "@/lib/db";
import { outboxCount } from "@/lib/offline";
import { useToast } from "@/components/Toast";
import { CloudOff, RefreshCw } from "lucide-react";

// Keeps the local cache/counter seeded and drains the offline sales outbox when
// the connection returns. Renders a small status chip only when it matters.
export default function OfflineSync() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();
  const running = useRef(false);

  const runSync = useCallback(async () => {
    if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    setPending(outboxCount());
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      await seedLocalCounterFromServer().catch(() => {});
      await getItems().catch(() => {}); // refresh catalogue cache
      const n = await syncOutbox().catch(() => 0);
      if (n > 0) toast(`Synced ${n} offline bill${n > 1 ? "s" : ""}.`, "ok");
    } finally {
      setPending(outboxCount());
      setSyncing(false);
      running.current = false;
    }
  }, [toast]);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    runSync();
    const onOnline = () => {
      setOnline(true);
      runSync();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const iv = window.setInterval(() => {
      setPending(outboxCount());
      if (navigator.onLine && outboxCount() > 0) runSync();
    }, 20000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(iv);
    };
  }, [runSync]);

  if (online && pending === 0) return null;

  return (
    <div className="fixed bottom-[4.75rem] left-3 z-30 lg:bottom-4 print:hidden">
      {!online ? (
        <span className="pill bg-amber-soft text-amber-deep shadow-card">
          <CloudOff size={14} />
          Offline{pending > 0 ? ` · ${pending} unsynced` : ""}
        </span>
      ) : (
        <button onClick={runSync} className="pill bg-ink text-white shadow-card">
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : `${pending} to sync`}
        </button>
      )}
    </div>
  );
}
