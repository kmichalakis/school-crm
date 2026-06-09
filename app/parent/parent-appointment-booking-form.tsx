"use client";

import { useMemo, useState } from "react";
import { bookParentAppointmentsAction } from "@/app/parent/appointment-actions";

type AppointmentSlotOption = {
  key: string;
  teacherId: string;
  teacherName: string;
  hourLabel: string;
  disabledReason: string | null;
};

type ParentAppointmentBookingFormProps = {
  date: string;
  studentId: string;
  slots: AppointmentSlotOption[];
};

export function ParentAppointmentBookingForm({ date, studentId, slots }: ParentAppointmentBookingFormProps) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const selectedTeacherIds = useMemo(
    () => new Set(slots.filter((slot) => selectedKeys.includes(slot.key)).map((slot) => slot.teacherId)),
    [selectedKeys, slots]
  );

  return (
    <form action={bookParentAppointmentsAction} className="appointment-booking-form">
      <input name="date" type="hidden" value={date} />
      <input name="studentId" type="hidden" value={studentId} />
      <div className="appointment-slot-grid">
        {slots.map((slot) => {
          const checked = selectedKeys.includes(slot.key);
          const sameTeacherSelected = selectedTeacherIds.has(slot.teacherId) && !checked;
          const disabled = Boolean(slot.disabledReason) || sameTeacherSelected;
          const disabledReason = slot.disabledReason ?? (sameTeacherSelected ? "Έχετε επιλέξει ήδη αυτόν/ήν τον/την εκπαιδευτικό." : null);

          return (
            <label className={disabled ? "appointment-option disabled" : "appointment-option"} key={slot.key}>
              <input
                checked={checked}
                disabled={disabled}
                name="slot"
                onChange={(event) => {
                  setSelectedKeys((current) =>
                    event.target.checked ? [...current, slot.key] : current.filter((selectedKey) => selectedKey !== slot.key)
                  );
                }}
                type="checkbox"
                value={slot.key}
              />
              <span>
                <strong>{slot.teacherName}</strong>
                <small>{slot.hourLabel}</small>
                {disabledReason ? <em>{disabledReason}</em> : null}
              </span>
            </label>
          );
        })}
      </div>
      <div className="section-actions">
        <button className="primary-button" type="submit">
          Κλείσιμο ραντεβού
        </button>
      </div>
    </form>
  );
}
