import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ScrollProvider } from "@/components/motion";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Curtail: Verified Grid Capacity for Multi-Tenant Data Centers",
  description:
    "Curtail turns opted-in tenant load into verified capacity operators can commit to the grid. No new hardware. No contract changes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper text-ink">
        {/*
          Reveals are server-rendered in their hidden state (opacity 0) so
          there is no flash before hydration. Without JS nothing would ever
          reveal them, so make the resolved state the no-JS default. Transforms
          are deliberately left alone — a few px of offset reads fine, whereas
          clearing every transform would displace positioned elements.
        */}
        <noscript>
          <style>{`
            header *, main *, footer * {
              opacity: 1 !important;
              filter: none !important;
            }
          `}</style>
        </noscript>
        <ScrollProvider>{children}</ScrollProvider>
      </body>
    </html>
  );
}
