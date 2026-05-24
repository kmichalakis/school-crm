CREATE TABLE "SchoolCalendarDay" (
    "id" TEXT NOT NULL,
    "schoolYearId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isWorkingDay" BOOLEAN NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolCalendarDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolCalendarDay_schoolYearId_date_key" ON "SchoolCalendarDay"("schoolYearId", "date");
CREATE INDEX "SchoolCalendarDay_schoolYearId_isWorkingDay_idx" ON "SchoolCalendarDay"("schoolYearId", "isWorkingDay");

ALTER TABLE "SchoolCalendarDay" ADD CONSTRAINT "SchoolCalendarDay_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
