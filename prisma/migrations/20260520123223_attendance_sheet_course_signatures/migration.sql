-- CreateTable
CREATE TABLE "AttendanceSheetCourse" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "teacherId" TEXT,
    "position" INTEGER NOT NULL,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSheetCourse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSheetCourse_courseId_idx" ON "AttendanceSheetCourse"("courseId");

-- CreateIndex
CREATE INDEX "AttendanceSheetCourse_teacherId_idx" ON "AttendanceSheetCourse"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSheetCourse_sheetId_position_key" ON "AttendanceSheetCourse"("sheetId", "position");

-- AddForeignKey
ALTER TABLE "AttendanceSheetCourse" ADD CONSTRAINT "AttendanceSheetCourse_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "AttendanceSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSheetCourse" ADD CONSTRAINT "AttendanceSheetCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSheetCourse" ADD CONSTRAINT "AttendanceSheetCourse_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
