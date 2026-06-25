"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navConfig";
import PrinterStatus from "./PrinterStatus";
import InstallButton from "./InstallButton";
import { MoreHorizontal, X } from "lucide-react";

export function MobileTopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden print:hidden">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-tile bg-brand text-xs font-bold text-white">
          NS
        </span>
        <span className="text-[15px] font-bold text-ink">Noor POS</span>
      </Link>
      <div className="flex items-center gap-2">
        <InstallButton compact />
        <PrinterStatus compact />
      </div>
    </header>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = NAV_ITEMS.filter((i) => i.primary);
  const secondary = NAV_ITEMS.filter((i) => !i.primary);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const moreActive = secondary.some((i) => isActive(i.href));

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden print:hidden" onClick={() => setMoreOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-ink">More</span>
              <button onClick={() => setMoreOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {secondary.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-1.5 rounded-tile border p-3 text-xs font-semibold transition ${
                    isActive(href) ? "border-brand bg-brand-soft text-brand" : "border-line text-muted-dark hover:bg-canvas"
                  }`}
                >
                  <Icon size={20} />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
        {primary.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold transition ${
                active ? "text-brand" : "text-muted-light"
              }`}
            >
              <Icon size={19} strokeWidth={active ? 2.2 : 1.9} />
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold transition ${
            moreActive ? "text-brand" : "text-muted-light"
          }`}
        >
          <MoreHorizontal size={19} strokeWidth={moreActive ? 2.2 : 1.9} />
          More
        </button>
      </nav>
    </>
  );
}
