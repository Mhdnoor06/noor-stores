import {
  LayoutDashboard,
  FilePlus2,
  ReceiptText,
  Package,
  Barcode,
  HandCoins,
  BarChart3,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

// `primary` items show in the mobile bottom bar; the rest live under "More".
export const NAV_ITEMS: { href: string; label: string; Icon: LucideIcon; primary?: boolean }[] = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard, primary: true },
  { href: "/bill/new", label: "New Bill", Icon: FilePlus2, primary: true },
  { href: "/bills", label: "Bills", Icon: ReceiptText, primary: true },
  { href: "/udhaar", label: "Udhaar", Icon: HandCoins, primary: true },
  { href: "/items", label: "Items", Icon: Package, primary: true },
  { href: "/report", label: "Day Close", Icon: BarChart3 },
  { href: "/labels", label: "Labels", Icon: Barcode },
  { href: "/settings", label: "Settings", Icon: SlidersHorizontal },
];
