"use client";

import { useState } from "react";
import { isWeekdayDate, isWithinSchoolYear, type SchoolYearDateBounds } from "@/lib/school-calendar";

type ScheduleDatePickerProps = {
  classId: string;
  maxDate: string;
  minDate: string;
  schoolYearBounds: SchoolYearDateBounds;
  selectedDate: string;
};

export function ScheduleDatePicker({
  classId,
  maxDate,
  minDate,
  schoolYearBounds,
  selectedDate
}: ScheduleDatePickerProps) {
  const [date, setDate] = useState(selectedDate);
  const [error, setError] = useState<string | null>(null);

  function navigateToDate(nextDate: string) {
    const params = new URLSearchParams({ classId });
    if (nextDate) {
      params.set("date", nextDate);
    }

    window.location.href = `/schedule?${params.toString()}`;
  }

  return (
    <div className="inline-form print-selector-form">
      <label>
        Ημερομηνία έκτακτου προγράμματος
        <input
          max={maxDate}
          min={minDate}
          onChange={(event) => {
            const nextDate = event.target.value;
            setDate(nextDate);
            setError(null);

            if (!nextDate) {
              navigateToDate("");
              return;
            }

            if (!isWithinSchoolYear(nextDate, schoolYearBounds) || !isWeekdayDate(nextDate)) {
              setError("Επιλέξτε καθημερινή ημερομηνία μέσα στο σχολικό έτος.");
              setDate("");
              return;
            }

            navigateToDate(nextDate);
          }}
          type="date"
          value={date}
        />
      </label>
      {error ? (
        <div className="admin-notice error print-form-message" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
