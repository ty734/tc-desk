import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Living Well Desk",
  description: "Living Well customer support desk",
  appleWebApp: {
    capable: true,
    title: "Living Well Desk",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#6E9277",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
