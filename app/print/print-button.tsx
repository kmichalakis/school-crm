"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button className="primary-button no-print" onClick={() => window.print()} type="button">
      <Printer size={18} />
      Εκτύπωση / PDF
    </button>
  );
}
