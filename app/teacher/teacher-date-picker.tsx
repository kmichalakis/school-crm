"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type TeacherDatePickerProps = {
  selectedDate: string;
  hint: string;
  minDate?: string;
  maxDate?: string;
};

export function TeacherDatePicker({ selectedDate, hint, minDate, maxDate }: TeacherDatePickerProps) {
  const router = useRouter();
  const [date, setDate] = useState(selectedDate);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setDate(selectedDate);
  }, [selectedDate]);

  return (
    <div className="inline-form date-selector-form">
      <div className="field">
        <label htmlFor="teacherDate">Ημερομηνία</label>
        <input
          aria-busy={isPending}
          id="teacherDate"
          name="date"
          min={minDate}
          max={maxDate}
          required
          type="date"
          value={date}
          onChange={(event) => {
            const nextDate = event.target.value;
            setDate(nextDate);

            if (!nextDate) {
              return;
            }

            startTransition(() => {
              router.push(`/teacher?date=${encodeURIComponent(nextDate)}`);
            });
          }}
        />
        <span className="field-hint">{hint}</span>
      </div>
    </div>
  );
}
