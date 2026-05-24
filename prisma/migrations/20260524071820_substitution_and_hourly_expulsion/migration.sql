-- AlterTable
ALTER TABLE "AttendanceSheet" ALTER COLUMN "date" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "AttendanceSheetAbsence" ADD COLUMN     "isHourlyExpulsion" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "isSubstitution" BOOLEAN NOT NULL DEFAULT false;
