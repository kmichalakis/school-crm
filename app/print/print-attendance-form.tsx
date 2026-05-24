"use client";

import { useState } from "react";
import { isAllowedSchoolDate, type SchoolCalendarException, type SchoolYearDateBounds } from "@/lib/school-calendar";

type PrintAttendanceFormProps = {
  calendarExceptions: SchoolCalendarException[];
  classId: string;
  defaultDate: string;
  schoolYearBounds: SchoolYearDateBounds | null;
};

export function PrintAttendanceForm({ calendarExceptions, classId, defaultDate, schoolYearBounds }: PrintAttendanceFormProps) {
  const [date, setDate] = useState(defaultDate);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      action="/print/attendance"
      className="inline-form print-selector-form"
      onSubmit={(event) => {
        if (!isAllowedSchoolDate(date, schoolYearBounds, calendarExceptions)) {
          event.preventDefault();
          setMessage("Η ημερομηνία είναι αργία ή μη εργάσιμη ημέρα και δεν υπάρχει ημερήσιο απουσιολόγιο για εκτύπωση.");
        }
      }}
    >
      <input name="classId" type="hidden" value={classId} />
      <label>
        Ημερομηνία
        <input
          min={schoolYearBounds?.startsOn}
          max={schoolYearBounds?.endsOn}
          name="date"
          onChange={(event) => {
            setDate(event.target.value);
            setMessage(null);
          }}
          required
          type="date"
          value={date}
        />
      </label>
      <button className="primary-button" type="submit">
        Προβολή εκτύπωσης
      </button>
      {message ? (
        <div className="admin-notice error print-form-message" role="alert">
          {message}
        </div>
      ) : null}
    </form>
  );
}
