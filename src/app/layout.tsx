import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "Intercert ERP", template: "%s · Intercert ERP" },
  description: "ERP Intercert para comércio e varejo",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f2147" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
