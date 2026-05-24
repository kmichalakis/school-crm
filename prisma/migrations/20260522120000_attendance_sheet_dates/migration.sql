-- Add attendance calendar dates so sheets are unique per class, date, and hour.
ALTER TABLE "AttendanceSheet"
ADD COLUMN "date" DATE NOT NULL DEFAULT CURRENT_DATE;

DROP INDEX IF EXISTS "AttendanceSheet_classId_day_hour_key";

CREATE UNIQUE INDEX "AttendanceSheet_classId_date_hour_key" ON "AttendanceSheet"("classId", "date", "hour");

CREATE INDEX "AttendanceSheet_classId_date_idx" ON "AttendanceSheet"("classId", "date");
