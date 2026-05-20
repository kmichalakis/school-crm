import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Σχολικό CRM",
  description: "Διαχείριση παρουσιών και απουσιών σχολείου"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}
