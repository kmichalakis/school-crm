"use client";

import { cancelParentAppointmentAction } from "@/app/parent/appointment-actions";

type ParentCancelAppointmentFormProps = {
  appointmentId: string;
  date: string;
  studentId: string;
};

export function ParentCancelAppointmentForm({ appointmentId, date, studentId }: ParentCancelAppointmentFormProps) {
  return (
    <form
      action={cancelParentAppointmentAction}
      onSubmit={(event) => {
        if (!window.confirm("Θέλετε σίγουρα να ακυρώσετε αυτό το ραντεβού;")) {
          event.preventDefault();
        }
      }}
    >
      <input name="id" type="hidden" value={appointmentId} />
      <input name="date" type="hidden" value={date} />
      <input name="studentId" type="hidden" value={studentId} />
      <button className="secondary-button danger" type="submit">
        Ακύρωση
      </button>
    </form>
  );
}
