"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navConfig";
import PrinterStatus from "./PrinterStatus";
import InstallButton from "./InstallButton";

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[238px] flex-none flex-col border-r border-line bg-white px-3.5 py-4 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-tile bg-brand text-sm font-bold text-white">
          NS
        </span>
        <span className="text-[15px] font-bold tracking-[-.01em] text-ink">
          Noor POS
        </span>
      </Link>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-tile px-3 py-2.5 text-sm font-medium transition ${
                active ? "bg-brand-soft text-brand" : "text-muted-dark hover:bg-canvas"
              }`}
            >
              <Icon size={19} strokeWidth={active ? 2.2 : 1.9} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3 border-t border-line-soft pt-3">
        <InstallButton />
        <PrinterStatus />
      </div>
    </aside>
  );
}
