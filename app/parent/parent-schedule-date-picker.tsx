"use client";

import { useState } from "react";

type ParentScheduleDatePickerProps = {
  date: string;
  maxDate: string;
  minDate: string;
  studentId: string;
};

export function ParentScheduleDatePicker({ date, maxDate, minDate, studentId }: ParentScheduleDatePickerProps) {
  const [selectedDate, setSelectedDate] = useState(date);

  return (
    <div className="inline-form date-selector-form">
      <label>
        Συγκεκριμένη ημερομηνία
        <input
          max={maxDate}
          min={minDate}
          onChange={(event) => {
            const nextDate = event.target.value;
            setSelectedDate(nextDate);
            const params = new URLSearchParams({
              view: "schedule",
              studentId
            });
            if (nextDate) {
              params.set("date", nextDate);
            }
            window.location.href = `/parent?${params.toString()}`;
          }}
          type="date"
          value={selectedDate}
        />
      </label>
    </div>
  );
}
