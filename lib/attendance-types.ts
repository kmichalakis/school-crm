export type AttendanceStudent = {
  id: string;
  code: string;
  name: string;
  surname: string;
  absent: boolean;
};

export type AttendanceSheetPayload = {
  day: string;
  hour: number;
  course: string;
  courses?: string[];
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
};
