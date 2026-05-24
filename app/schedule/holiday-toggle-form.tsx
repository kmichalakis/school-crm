"use client";

import { useRef } from "react";

type HolidayToggleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  classId: string;
  date: string;
  isHoliday: boolean;
};

export function HolidayToggleForm({ action, classId, date, isHoliday }: HolidayToggleFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form action={action} className="holiday-toggle-form" ref={formRef}>
      <input name="classId" type="hidden" value={classId} />
      <input name="date" type="hidden" value={date} />
      <label className="checkbox-row">
        <input
          defaultChecked={isHoliday}
          name="isHoliday"
          onChange={() => formRef.current?.requestSubmit()}
          type="checkbox"
        />
        Αργία / δεν γίνονται μαθήματα
      </label>
      <span>{isHoliday ? "Η ημερομηνία είναι κλειδωμένη ως αργία." : "Η ημερομηνία είναι εργάσιμη."}</span>
    </form>
  );
}
