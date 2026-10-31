import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Poppins } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-fallback-serif",
  subsets: ["latin"],
  weight: ["600", "700"],
});
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// let the page reach under the iPhone's home bar, so the bottom bar can step clear of it (safe-area insets)
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Spruce & Co — Back Office",
  description: "Projects, capital and finance for Spruce & Co — Construction & Interior Design",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} ${cormorant.variable} antialiased`}>{children}</body>
    </html>
  );
}
