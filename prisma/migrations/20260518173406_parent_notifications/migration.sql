-- CreateEnum
CREATE TYPE "ParentNotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DISMISSED');

-- CreateTable
CREATE TABLE "ParentNotification" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "type" "EmailTrigger" NOT NULL,
    "status" "ParentNotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParentNotification_status_createdAt_idx" ON "ParentNotification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ParentNotification_parentId_createdAt_idx" ON "ParentNotification"("parentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParentNotification_parentId_studentId_sheetId_type_key" ON "ParentNotification"("parentId", "studentId", "sheetId", "type");

-- AddForeignKey
ALTER TABLE "ParentNotification" ADD CONSTRAINT "ParentNotification_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentNotification" ADD CONSTRAINT "ParentNotification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
