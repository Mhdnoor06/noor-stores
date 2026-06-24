import type { Metadata } from "next";
import "./globals.css";
import { PrinterProvider } from "@/components/PrinterProvider";
import Sidebar from "@/components/Sidebar";
import { MobileTopBar, MobileBottomNav } from "@/components/MobileNav";

export const metadata: Metadata = {
  title: "Noor POS — Billing",
  description: "Web POS billing with EZO Bluetooth thermal printer",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        <PrinterProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <MobileTopBar />
              <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 pb-24 lg:px-8 lg:pb-10">
                {children}
              </main>
            </div>
          </div>
          <MobileBottomNav />
        </PrinterProvider>
      </body>
    </html>
  );
}
