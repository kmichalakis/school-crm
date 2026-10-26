ALTER TABLE "Student" ADD COLUMN "secondParentId" TEXT;

CREATE INDEX "Student_secondParentId_idx" ON "Student"("secondParentId");

ALTER TABLE "Student" ADD CONSTRAINT "Student_secondParentId_fkey"
  FOREIGN KEY ("secondParentId") REFERENCES "Parent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Student" ADD CONSTRAINT "Student_distinct_parents_check"
  CHECK ("parentId" IS NULL OR "secondParentId" IS NULL OR "parentId" <> "secondParentId");
