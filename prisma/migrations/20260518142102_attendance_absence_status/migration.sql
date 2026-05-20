-- AlterTable
ALTER TABLE "AttendanceSheetAbsence" ADD COLUMN     "excusedAt" TIMESTAMP(3),
ADD COLUMN     "excusedReason" TEXT,
ADD COLUMN     "status" "AbsenceStatus" NOT NULL DEFAULT 'MARKED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "AttendanceSheetAbsence_studentId_updatedAt_idx" ON "AttendanceSheetAbsence"("studentId", "updatedAt");
