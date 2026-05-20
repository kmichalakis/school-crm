-- Natural import keys for school data.
ALTER TABLE "Parent" DROP COLUMN IF EXISTS "phone";

ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "am" TEXT;
UPDATE "Teacher" SET "am" = 'T-' || "id" WHERE "am" IS NULL OR "am" = '';
ALTER TABLE "Teacher" ALTER COLUMN "am" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Teacher_am_key" ON "Teacher"("am");

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "am" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "patronymic" TEXT;
UPDATE "Student"
SET
  "am" = COALESCE(NULLIF("am", ''), 'S-' || "id"),
  "patronymic" = COALESCE("patronymic", '')
WHERE "am" IS NULL OR "am" = '' OR "patronymic" IS NULL;
ALTER TABLE "Student" ALTER COLUMN "am" SET NOT NULL;
ALTER TABLE "Student" ALTER COLUMN "patronymic" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Student_schoolYearId_am_key" ON "Student"("schoolYearId", "am");

ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "aa" TEXT;
UPDATE "Course" SET "aa" = 'C-' || "id" WHERE "aa" IS NULL OR "aa" = '';
ALTER TABLE "Course" ALTER COLUMN "aa" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Course_classId_aa_key" ON "Course"("classId", "aa");
