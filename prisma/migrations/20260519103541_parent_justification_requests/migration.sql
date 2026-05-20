-- CreateEnum
CREATE TYPE "ParentJustificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ParentJustificationRequest" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "status" "ParentJustificationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "schoolResponse" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentJustificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParentJustificationRequest_status_createdAt_idx" ON "ParentJustificationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ParentJustificationRequest_studentId_createdAt_idx" ON "ParentJustificationRequest"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParentJustificationRequest_parentId_studentId_sheetId_key" ON "ParentJustificationRequest"("parentId", "studentId", "sheetId");

-- AddForeignKey
ALTER TABLE "ParentJustificationRequest" ADD CONSTRAINT "ParentJustificationRequest_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentJustificationRequest" ADD CONSTRAINT "ParentJustificationRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentJustificationRequest" ADD CONSTRAINT "ParentJustificationRequest_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "AttendanceSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
