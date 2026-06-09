ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SCHOOL_OFFICE';

CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED_BY_PARENT', 'CANCELLED_BY_ADMIN');

CREATE TABLE "AppointmentSetting" (
  "id" TEXT NOT NULL,
  "maxPerTeacherSlot" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppointmentSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeacherOfficeHour" (
  "id" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "day" "WeekDay" NOT NULL,
  "hour" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherOfficeHour_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeacherUnavailableDay" (
  "id" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherUnavailableDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentBlockedDay" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppointmentBlockedDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParentTeacherAppointment" (
  "id" TEXT NOT NULL,
  "parentId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "day" "WeekDay" NOT NULL,
  "hour" INTEGER NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
  "cancellationReason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "notifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ParentTeacherAppointment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherOfficeHour_teacherId_day_hour_key" ON "TeacherOfficeHour"("teacherId", "day", "hour");
CREATE INDEX "TeacherOfficeHour_day_hour_idx" ON "TeacherOfficeHour"("day", "hour");

CREATE UNIQUE INDEX "TeacherUnavailableDay_teacherId_date_key" ON "TeacherUnavailableDay"("teacherId", "date");
CREATE INDEX "TeacherUnavailableDay_date_idx" ON "TeacherUnavailableDay"("date");

CREATE UNIQUE INDEX "AppointmentBlockedDay_date_key" ON "AppointmentBlockedDay"("date");

CREATE UNIQUE INDEX "ParentTeacherAppointment_parentId_studentId_teacherId_date_hour_key" ON "ParentTeacherAppointment"("parentId", "studentId", "teacherId", "date", "hour");
CREATE INDEX "ParentTeacherAppointment_teacherId_date_hour_status_idx" ON "ParentTeacherAppointment"("teacherId", "date", "hour", "status");
CREATE INDEX "ParentTeacherAppointment_parentId_date_status_idx" ON "ParentTeacherAppointment"("parentId", "date", "status");
CREATE INDEX "ParentTeacherAppointment_date_status_idx" ON "ParentTeacherAppointment"("date", "status");

ALTER TABLE "TeacherOfficeHour" ADD CONSTRAINT "TeacherOfficeHour_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherUnavailableDay" ADD CONSTRAINT "TeacherUnavailableDay_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentTeacherAppointment" ADD CONSTRAINT "ParentTeacherAppointment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentTeacherAppointment" ADD CONSTRAINT "ParentTeacherAppointment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentTeacherAppointment" ADD CONSTRAINT "ParentTeacherAppointment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
