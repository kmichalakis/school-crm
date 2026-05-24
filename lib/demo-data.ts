import { getCurrentSchoolHour } from "@/lib/school-time";

export const demoClass = {
  id: "class-a1",
  name: "Α1",
  grade: "Α",
  schoolYear: "2025-2026"
};

export const demoCourses = [
  "Μαθηματικά",
  "Νεοελληνική Γλώσσα",
  "Φυσική",
  "Ιστορία",
  "Φυσική Αγωγή",
  "ΚΕΝΟ"
];

export const demoStudents = [
  { id: "s1", code: "Α1-01", name: "Άννα", surname: "Αντωνίου", absent: false },
  { id: "s2", code: "Α1-02", name: "Νίκος", surname: "Γεωργίου", absent: true },
  { id: "s3", code: "Α1-03", name: "Ελένη", surname: "Ιωάννου", absent: false },
  { id: "s4", code: "Α1-04", name: "Πέτρος", surname: "Κυριάκου", absent: false },
  { id: "s5", code: "Α1-05", name: "Σοφία", surname: "Μιχαήλ", absent: true }
];

export const currentContext = {
  day: "Δευτέρα",
  hour: getCurrentSchoolHour(),
  course: "Μαθηματικά",
  teacher: "Μαρία Παπαδοπούλου",
  signed: false
};
