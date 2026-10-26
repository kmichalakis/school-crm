type Identified = { id: string };

export function studentParents<T extends Identified>(student: { parent: T | null; secondParent: T | null }): T[] {
  return Array.from(new Map([student.parent, student.secondParent].filter((parent): parent is T => Boolean(parent)).map((parent) => [parent.id, parent])).values());
}

export function parentStudents<T extends Identified>(parent: { students: T[]; secondaryStudents: T[] }): T[] {
  return Array.from(new Map([...parent.students, ...parent.secondaryStudents].map((student) => [student.id, student])).values());
}
