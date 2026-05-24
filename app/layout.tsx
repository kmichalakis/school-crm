import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mytilene Scholaris",
  description: "Ψηφιακή ροή απουσιολογίου για το 1ο Πρότυπο Γυμνάσιο Μυτιλήνης"
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
