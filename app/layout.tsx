import type { Metadata } from "next";
import { schoolLogoUrl } from "@/app/school-brand";
import "./globals.css";

export const metadata: Metadata = {
  title: "Πλατφόρμα ενημέρωσης γονέων",
  description: '1ο Πρότυπο Γυμνάσιο Μυτιλήνης "Βύρων Σιβολαπένκο"',
  icons: {
    icon: schoolLogoUrl,
    shortcut: schoolLogoUrl,
    apple: schoolLogoUrl
  }
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
