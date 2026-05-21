export type AttendanceStudent = {
  id: string;
  code: string;
  name: string;
  surname: string;
  absent: boolean;
};

export type AttendanceCourseOption = {
  courseId: string;
  name: string;
  teacherId: string | null;
  teacherName: string;
};

export type AttendanceCourseEntry = AttendanceCourseOption & {
  position: number;
  signedAt: string | null;
};

export type AttendanceSheetPayload = {
  day: string;
  hour: number;
  course: string;
  courses?: string[];
  courseOptions?: AttendanceCourseOption[];
  courseEntries?: AttendanceCourseEntry[];
  teacherName: string;
  students: AttendanceStudent[];
  signedAt: string | null;
  savedAt: string | null;
  dirty: boolean;
};

export type SaveAttendanceAction = "draft" | "sign";

export type SaveAttendanceRequest = AttendanceSheetPayload & {
  classId: string;
  action: SaveAttendanceAction;
  signaturePassword?: string;
  signaturePasswords?: Record<string, string>;
};
