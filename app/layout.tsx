import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PrinterProvider } from "@/components/PrinterProvider";
import { ToastProvider } from "@/components/Toast";
import Sidebar from "@/components/Sidebar";
import { MobileTopBar, MobileBottomNav } from "@/components/MobileNav";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "Noor POS — Billing",
  description: "Web POS billing with EZO Bluetooth thermal printer",
  applicationName: "Noor POS",
  appleWebApp: {
    capable: true,
    title: "Noor POS",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#4338ca",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <ServiceWorkerRegister />
        <PrinterProvider>
          <ToastProvider>
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
          </ToastProvider>
        </PrinterProvider>
      </body>
    </html>
  );
}
