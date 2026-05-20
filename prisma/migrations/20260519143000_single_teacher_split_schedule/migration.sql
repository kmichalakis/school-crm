-- A course has at most one teacher. A schedule hour may still contain many courses.
DELETE FROM "CourseTeacher" kept
WHERE kept.ctid NOT IN (
  SELECT MIN(candidate.ctid)
  FROM "CourseTeacher" candidate
  GROUP BY candidate."courseId"
);

CREATE UNIQUE INDEX IF NOT EXISTS "CourseTeacher_courseId_key" ON "CourseTeacher"("courseId");
