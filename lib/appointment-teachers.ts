import { prisma } from "@/lib/prisma";

const principalAm = "190068";

export async function bookableTeacherIdsForClass(classId: string): Promise<Set<string>> {
  const [slots, principal] = await Promise.all([
    prisma.scheduleSlot.findMany({
      where: { classId },
      select: {
        course: {
          select: {
            isNoCourse: true,
            isSubstitution: true,
            teachers: { select: { teacherId: true } }
          }
        }
      }
    }),
    prisma.teacher.findUnique({ where: { am: principalAm }, select: { id: true } })
  ]);

  const teacherIds = new Set(
    slots
      .filter((slot) => !slot.course.isNoCourse && !slot.course.isSubstitution)
      .flatMap((slot) => slot.course.teachers.map((link) => link.teacherId))
  );
  if (principal) teacherIds.add(principal.id);
  return teacherIds;
}
