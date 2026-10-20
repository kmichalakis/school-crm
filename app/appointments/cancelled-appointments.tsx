"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type CancelledAppointmentsProps = {
  count: number;
  children: ReactNode;
};

export function CancelledAppointments({ count, children }: CancelledAppointmentsProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (count === 0) {
    return null;
  }

  return (
    <div className="cancelled-appointments">
      <button
        aria-expanded={isOpen}
        className="secondary-button"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {isOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        {isOpen ? "Απόκρυψη διαγραμμένων ραντεβού" : "Διαγραμμένα Ραντεβού"}
        <span className="cancelled-appointment-count">{count}</span>
      </button>
      {isOpen ? <div className="appointment-list">{children}</div> : null}
    </div>
  );
}
