export const schoolHours = [
  { hour: 1, label: "1η ώρα", starts: "08:00", ends: "08:45" },
  { hour: 2, label: "2η ώρα", starts: "08:50", ends: "09:35" },
  { hour: 3, label: "3η ώρα", starts: "09:45", ends: "10:30" },
  { hour: 4, label: "4η ώρα", starts: "10:40", ends: "11:25" },
  { hour: 5, label: "5η ώρα", starts: "11:35", ends: "12:20" },
  { hour: 6, label: "6η ώρα", starts: "12:25", ends: "13:10" },
  { hour: 7, label: "7η ώρα", starts: "13:15", ends: "13:55" }
];

export const weekDays = [
  { value: "MONDAY", label: "Δευτέρα", number: 1 },
  { value: "TUESDAY", label: "Τρίτη", number: 2 },
  { value: "WEDNESDAY", label: "Τετάρτη", number: 3 },
  { value: "THURSDAY", label: "Πέμπτη", number: 4 },
  { value: "FRIDAY", label: "Παρασκευή", number: 5 }
] as const;

export type WeekDayValue = (typeof weekDays)[number]["value"];

export function dateToWeekDay(dateValue: string): WeekDayValue | null {
  const date = new Date(`${dateValue}T12:00:00`);
  const dayIndex = date.getDay();
  const dayByIndex: Record<number, WeekDayValue> = {
    1: "MONDAY",
    2: "TUESDAY",
    3: "WEDNESDAY",
    4: "THURSDAY",
    5: "FRIDAY"
  };

  return dayByIndex[dayIndex] ?? null;
}

export function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getCurrentSchoolHour(date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes();

  return (
    schoolHours.find((slot) => {
      const [startHour, startMinute] = slot.starts.split(":").map(Number);
      const [endHour, endMinute] = slot.ends.split(":").map(Number);
      const start = startHour * 60 + startMinute;
      const end = endHour * 60 + endMinute;

      return minutes >= start && minutes <= end;
    }) ?? schoolHours[0]
  );
}
