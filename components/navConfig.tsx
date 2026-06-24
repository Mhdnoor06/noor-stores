import {
  LayoutDashboard,
  FilePlus2,
  ReceiptText,
  Package,
  Barcode,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export const NAV_ITEMS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/bill/new", label: "New Bill", Icon: FilePlus2 },
  { href: "/bills", label: "Bills", Icon: ReceiptText },
  { href: "/items", label: "Items", Icon: Package },
  { href: "/labels", label: "Labels", Icon: Barcode },
  { href: "/settings", label: "Settings", Icon: SlidersHorizontal },
];
