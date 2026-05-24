export type AttendanceStudent = {
  id: string;
  code: string;
  name: string;
  surname: string;
  absent: boolean;
  isHourlyExpulsion?: boolean;
};

export type AttendanceTeacherOption = {
  id: string;
  name: string;
};

export type AttendanceCourseOption = {
  courseId: string;
  isNoCourse: boolean;
  isSubstitution?: boolean;
  name: string;
  teacherId: string | null;
  teacherName: string;
};

export type AttendanceCourseEntry = AttendanceCourseOption & {
  position: number;
  signedAt: string | null;
};

export type AttendanceSheetPayload = {
  date: string;
  day: string;
  hour: number;
  course: string;
  courses?: string[];
  courseOptions?: AttendanceCourseOption[];
  courseEntries?: AttendanceCourseEntry[];
  teacherOptions?: AttendanceTeacherOption[];
  teacherName: string;
  students: AttendanceStudent[];
  signedAt: string | null;
  savedAt: string | null;
  dirty: boolean;
};

export type SaveAttendanceAction = "draft" | "sign" | "unlock";

export type SaveAttendanceRequest = AttendanceSheetPayload & {
  classId: string;
  action: SaveAttendanceAction;
  signaturePassword?: string;
  signaturePasswords?: Record<string, string>;
};
