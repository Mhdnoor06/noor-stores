"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navConfig";
import PrinterStatus from "./PrinterStatus";

export function MobileTopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-tile bg-brand text-xs font-bold text-white">
          N
        </span>
        <span className="text-[15px] font-bold text-ink">Noor POS</span>
      </Link>
      <PrinterStatus compact />
    </header>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
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
    </nav>
  );
}
