import { AbsenceStatus, EmailTrigger, ParentJustificationStatus, ParentNotificationStatus, WeekDay } from "@prisma/client";
import { schoolHours, weekDays } from "@/lib/school-time";

export function classYearLabel(year: string) {
  if (year === "B") return "Β";
  if (year === "C") return "Γ";
  return "Α";
}

export function weekDayLabel(day: WeekDay) {
  return weekDays.find((weekDay) => weekDay.value === day)?.label ?? "Δευτέρα";
}

export function hourLabel(hour: number) {
  return schoolHours.find((schoolHour) => schoolHour.hour === hour)?.label ?? `${hour}η ώρα`;
}

export function absenceStatusLabel(status: AbsenceStatus) {
  if (status === AbsenceStatus.EXCUSED) return "Δικαιολογημένη";
  if (status === AbsenceStatus.REMOVED) return "Αφαιρέθηκε";
  return "Καταχωρισμένη";
}

export function emailTriggerLabel(trigger: EmailTrigger) {
  if (trigger === EmailTrigger.LAST_HOUR_ABSENCE) return "Απουσία τελευταίας ώρας";
  if (trigger === EmailTrigger.DAILY_THRESHOLD) return "Ημερήσιο όριο απουσιών";
  if (trigger === EmailTrigger.WEEKLY_THRESHOLD) return "Εβδομαδιαίο όριο απουσιών";
  return "Απουσία πρώτης ώρας";
}

export function notificationStatusLabel(status: ParentNotificationStatus) {
  if (status === ParentNotificationStatus.SENT) return "Στάλθηκε";
  if (status === ParentNotificationStatus.DISMISSED) return "Παραλείφθηκε";
  return "Σε αναμονή";
}

export function parentJustificationStatusLabel(status: ParentJustificationStatus) {
  if (status === ParentJustificationStatus.APPROVED) return "Εγκρίθηκε";
  if (status === ParentJustificationStatus.REJECTED) return "Απορρίφθηκε";
  return "Σε έλεγχο";
}

export function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
