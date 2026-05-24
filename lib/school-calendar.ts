export type SchoolYearDateBounds = {
  startsOn: string;
  endsOn: string;
};

export type SchoolCalendarException = {
  date: string;
  isWorkingDay: boolean;
};

export function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function isWeekdayDate(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

export function isWithinSchoolYear(dateValue: string, bounds: SchoolYearDateBounds | null) {
  if (!bounds) {
    return true;
  }

  return dateValue >= bounds.startsOn && dateValue <= bounds.endsOn;
}

export function isWorkingSchoolDate(dateValue: string, exceptions: SchoolCalendarException[]) {
  const exception = exceptions.find((calendarDay) => calendarDay.date === dateValue);
  if (exception) {
    return exception.isWorkingDay;
  }

  return isWeekdayDate(dateValue);
}

export function isAllowedSchoolDate(
  dateValue: string,
  bounds: SchoolYearDateBounds | null,
  exceptions: SchoolCalendarException[]
) {
  return isWithinSchoolYear(dateValue, bounds) && isWorkingSchoolDate(dateValue, exceptions);
}

export function clampToSchoolYear(dateValue: string, bounds: SchoolYearDateBounds | null) {
  if (!bounds) {
    return dateValue;
  }

  if (dateValue < bounds.startsOn) {
    return bounds.startsOn;
  }

  if (dateValue > bounds.endsOn) {
    return bounds.endsOn;
  }

  return dateValue;
}
