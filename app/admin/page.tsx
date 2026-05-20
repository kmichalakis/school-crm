import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ClassYear, WeekDay } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { LogoutButton } from "@/app/logout-button";
import {
  createSchoolYearAction,
  deleteClassAction,
  deleteCourseAction,
  deleteParentAction,
  deleteScheduleSlotAction,
  deleteStudentAction,
  deleteTeacherAction,
  importSchoolWorkbookAction,
  promoteSchoolYearAction,
  setScheduleSlotAction,
  upsertClassAction,
  upsertCourseAction,
  upsertParentAction,
  upsertStudentAction,
  upsertTeacherAction
} from "@/app/admin/actions";
import { schoolHours, weekDays } from "@/lib/school-time";

export const maxDuration = 60;

type AdminPageProps = {
  searchParams: Promise<{
    notice?: string;
    noticeType?: string;
  }>;
};

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function classYearLabel(year: ClassYear) {
  if (year === ClassYear.B) return "Β";
  if (year === ClassYear.C) return "Γ";
  return "Α";
}

function weekDayLabel(day: WeekDay) {
  return weekDays.find((weekDay) => weekDay.value === day)?.label ?? "Δευτέρα";
}

function nextYearName(currentName: string) {
  const [start, end] = currentName.split("-").map(Number);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "";
  }

  return `${start + 1}-${end + 1}`;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const adminUser = await prisma.user.findUnique({
    where: { id: session.userId }
  });

  if (!adminUser || adminUser.role !== "ADMIN") {
    redirect("/");
  }

  const [schoolYears, classes, teachers, students, parents, courses, scheduleSlots] = await Promise.all([
    prisma.schoolYear.findMany({
      orderBy: [{ status: "asc" }, { startsOn: "desc" }]
    }),
    prisma.class.findMany({
      include: {
        schoolYear: true,
        responsibleTeacher: true,
        classUsers: true
      },
      orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
    }),
    prisma.teacher.findMany({
      include: {
        user: true,
        homeClass: true
      },
      orderBy: [{ surname: "asc" }, { name: "asc" }]
    }),
    prisma.student.findMany({
      include: {
        class: {
          include: { schoolYear: true }
        },
        parent: true
      },
      orderBy: [{ class: { name: "asc" } }, { surname: "asc" }, { name: "asc" }]
    }),
    prisma.parent.findMany({
      include: {
        user: true,
        students: true
      },
      orderBy: [{ surname: "asc" }, { name: "asc" }]
    }),
    prisma.course.findMany({
      include: {
        class: {
          include: { schoolYear: true }
        },
        teachers: {
          include: { teacher: true }
        }
      },
      orderBy: [{ class: { name: "asc" } }, { name: "asc" }]
    }),
    prisma.scheduleSlot.findMany({
      include: {
        course: {
          include: {
            class: {
              include: { schoolYear: true }
            }
          }
        }
      },
      orderBy: [{ classId: "asc" }, { day: "asc" }, { hour: "asc" }]
    })
  ]);

  const activeYear = schoolYears.find((schoolYear) => schoolYear.status === "ACTIVE") ?? schoolYears[0];
  const params = await searchParams;
  const noticeType = params.noticeType === "error" ? "error" : "success";

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Διαχείριση σχολείου</h1>
            <span>Δεδομένα ανά σχολικό έτος, τμήμα και πρόγραμμα</span>
          </div>
        </div>
        <Link className="secondary-button" href="/">
          Απουσιολόγιο
        </Link>
        <Link className="secondary-button" href="/notifications">
          Ειδοποιήσεις
        </Link>
        <Link className="secondary-button" href="/dashboard">
          Dashboard
        </Link>
        <Link className="secondary-button" href="/teacher">
          Σήμερα
        </Link>
        <Link className="secondary-button" href="/print">
          Εκτυπώσεις
        </Link>
        <Link className="secondary-button" href="/schedule">
          Πρόγραμμα
        </Link>
        <LogoutButton />
      </header>

      {params.notice ? (
        <div className={`admin-notice ${noticeType}`} role="status">
          {params.notice}
        </div>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Εισαγωγή δεδομένων από Excel</h2>
          <p>Μαζική εισαγωγή τμημάτων, εκπαιδευτικών, γονέων, μαθητών, μαθημάτων και προγράμματος. Στο πρόγραμμα τα πολλά μαθήματα της ίδιας ώρας δηλώνονται με ΑΑ χωρισμένα με ;</p>
        </div>
        <form action={importSchoolWorkbookAction} className="admin-form import-form">
          <input name="activeSchoolYearId" type="hidden" value={activeYear?.id ?? ""} />
          <input name="workbook" type="file" accept=".xlsx,.xls" required />
          <a className="secondary-button" href="/admin/import-template">
            Λήψη προτύπου Excel
          </a>
          <button className="primary-button" type="submit">
            Εισαγωγή Excel
          </button>
        </form>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Σχολικά έτη</h2>
          <p>Το ενεργό έτος καθορίζει τα τμήματα και τους μαθητές της τρέχουσας χρονιάς.</p>
        </div>

        <form action={createSchoolYearAction} className="admin-form compact-form">
          <input name="name" placeholder="2027-2028" required />
          <input name="startsOn" type="date" required />
          <input name="endsOn" type="date" required />
          <label className="check-field">
            <input name="active" type="checkbox" />
            Ενεργό
          </label>
          <button className="primary-button" type="submit">
            Προσθήκη έτους
          </button>
        </form>

        <div className="admin-table">
          {schoolYears.map((schoolYear) => (
            <div className="admin-row" key={schoolYear.id}>
              <strong>{schoolYear.name}</strong>
              <span>{schoolYear.status === "ACTIVE" ? "Ενεργό" : "Αρχείο"}</span>
              <span>
                {dateInputValue(schoolYear.startsOn)} έως {dateInputValue(schoolYear.endsOn)}
              </span>
            </div>
          ))}
        </div>

        {activeYear ? (
          <form action={promoteSchoolYearAction} className="admin-form promote-form">
            <input name="sourceSchoolYearId" type="hidden" value={activeYear.id} />
            <div className="field">
              <label htmlFor="nextName">Επόμενο σχολικό έτος</label>
              <input id="nextName" name="nextName" defaultValue={nextYearName(activeYear.name)} required />
            </div>
            <div className="field">
              <label htmlFor="startsOn">Έναρξη</label>
              <input id="startsOn" name="startsOn" type="date" required />
            </div>
            <div className="field">
              <label htmlFor="endsOn">Λήξη</label>
              <input id="endsOn" name="endsOn" type="date" required />
            </div>
            <button className="primary-button" type="submit">
              Μετάβαση στο επόμενο έτος
            </button>
          </form>
        ) : null}
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Τμήματα</h2>
          <p>Κάθε τμήμα ανήκει σε σχολικό έτος και μπορεί να έχει δικό του χρήστη τάξης.</p>
        </div>

        <form action={upsertClassAction} className="admin-form grid-form">
          <select name="schoolYearId" defaultValue={activeYear?.id} required>
            {schoolYears.map((schoolYear) => (
              <option key={schoolYear.id} value={schoolYear.id}>
                {schoolYear.name}
              </option>
            ))}
          </select>
          <input name="name" placeholder="Α1" required />
          <select name="year" defaultValue="A">
            <option value="A">Τάξη Α</option>
            <option value="B">Τάξη Β</option>
            <option value="C">Τάξη Γ</option>
          </select>
          <select name="responsibleTeacherId" defaultValue="">
            <option value="">Υπεύθυνος εκπαιδευτικός</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.am} - {teacher.surname} {teacher.name}
              </option>
            ))}
          </select>
          <input name="username" placeholder="login τμήματος π.χ. a1" />
          <input name="password" placeholder="κωδικός τμήματος" type="password" />
          <label className="check-field">
            <input name="mustChangePassword" type="checkbox" defaultChecked />
            Αλλαγή στο πρώτο login
          </label>
          <button className="primary-button" type="submit">
            Προσθήκη τμήματος
          </button>
        </form>

        <div className="admin-table">
          {classes.map((classRecord) => (
            <form action={upsertClassAction} className="admin-row editable-row" key={classRecord.id}>
              <input name="id" type="hidden" value={classRecord.id} />
              <select name="schoolYearId" defaultValue={classRecord.schoolYearId}>
                {schoolYears.map((schoolYear) => (
                  <option key={schoolYear.id} value={schoolYear.id}>
                    {schoolYear.name}
                  </option>
                ))}
              </select>
              <input name="name" defaultValue={classRecord.name} required />
              <select name="year" defaultValue={classRecord.year}>
                <option value="A">Τάξη Α</option>
                <option value="B">Τάξη Β</option>
                <option value="C">Τάξη Γ</option>
              </select>
              <select name="responsibleTeacherId" defaultValue={classRecord.responsibleTeacherId ?? ""}>
                <option value="">Χωρίς υπεύθυνο</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.am} - {teacher.surname} {teacher.name}
                  </option>
                ))}
              </select>
              <span>Τάξη {classYearLabel(classRecord.year)}</span>
              <input name="username" defaultValue={classRecord.classUsers[0]?.username ?? ""} placeholder="login" />
              <input name="password" placeholder="νέος κωδικός" type="password" />
              <label className="check-field">
                <input name="mustChangePassword" type="checkbox" defaultChecked={classRecord.classUsers[0]?.mustChangePassword ?? false} />
                Αλλαγή
              </label>
              <button className="secondary-button" type="submit">
                Αποθήκευση
              </button>
              <button className="secondary-button danger" formAction={deleteClassAction} type="submit">
                Διαγραφή
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Εκπαιδευτικοί</h2>
          <p>Οι εκπαιδευτικοί έχουν ΑΜ, δικά τους login στοιχεία και μπορούν να συνδέονται με τμήματα/μαθήματα.</p>
        </div>

        <form action={upsertTeacherAction} className="admin-form grid-form">
          <input name="am" placeholder="ΑΜ" required />
          <input name="name" placeholder="Όνομα" required />
          <input name="surname" placeholder="Επώνυμο" required />
          <input name="username" placeholder="username" required />
          <input name="password" placeholder="password" type="password" required />
          <select name="homeClassId" defaultValue="">
            <option value="">Χωρίς τμήμα ευθύνης</option>
            {classes.map((classRecord) => (
              <option key={classRecord.id} value={classRecord.id}>
                {classRecord.name} ({classRecord.schoolYear.name})
              </option>
            ))}
          </select>
          <label className="check-field">
            <input name="isAdmin" type="checkbox" />
            Admin
          </label>
          <label className="check-field">
            <input name="mustChangePassword" type="checkbox" defaultChecked />
            Αλλαγή στο πρώτο login
          </label>
          <button className="primary-button" type="submit">
            Προσθήκη εκπαιδευτικού
          </button>
        </form>

        <div className="admin-table">
          {teachers.map((teacher) => (
            <form action={upsertTeacherAction} className="admin-row editable-row" key={teacher.id}>
              <input name="id" type="hidden" value={teacher.id} />
              <input name="userId" type="hidden" value={teacher.userId} />
              <input name="am" defaultValue={teacher.am} required />
              <input name="surname" defaultValue={teacher.surname} required />
              <input name="name" defaultValue={teacher.name} required />
              <input name="username" defaultValue={teacher.user.username} required />
              <input name="password" placeholder="νέος κωδικός" type="password" />
              <select name="homeClassId" defaultValue={teacher.homeClassId ?? ""}>
                <option value="">Χωρίς τμήμα</option>
                {classes.map((classRecord) => (
                  <option key={classRecord.id} value={classRecord.id}>
                    {classRecord.name} ({classRecord.schoolYear.name})
                  </option>
                ))}
              </select>
              <label className="check-field">
                <input name="isAdmin" type="checkbox" defaultChecked={teacher.isAdmin} />
                Admin
              </label>
              <label className="check-field">
                <input name="mustChangePassword" type="checkbox" defaultChecked={teacher.user.mustChangePassword} />
                Αλλαγή
              </label>
              <button className="secondary-button" type="submit">
                Αποθήκευση
              </button>
              <button className="secondary-button danger" formAction={deleteTeacherAction} type="submit">
                Διαγραφή
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Γονείς</h2>
          <p>Οι γονείς έχουν login με username ως κλειδί και συνδέονται με μαθητές μέσω email.</p>
        </div>

        <form action={upsertParentAction} className="admin-form grid-form">
          <input name="name" placeholder="Όνομα" required />
          <input name="surname" placeholder="Επώνυμο" required />
          <input name="email" placeholder="email" type="email" required />
          <input name="username" placeholder="username" required />
          <input name="password" placeholder="password" type="password" required />
          <label className="check-field">
            <input name="mustChangePassword" type="checkbox" defaultChecked />
            Αλλαγή στο πρώτο login
          </label>
          <button className="primary-button" type="submit">
            Προσθήκη γονέα
          </button>
        </form>

        <div className="admin-table">
          {parents.map((parent) => (
            <form action={upsertParentAction} className="admin-row editable-row" key={parent.id}>
              <input name="id" type="hidden" value={parent.id} />
              <input name="userId" type="hidden" value={parent.userId} />
              <input name="surname" defaultValue={parent.surname} required />
              <input name="name" defaultValue={parent.name} required />
              <input name="email" defaultValue={parent.email} type="email" required />
              <input name="username" defaultValue={parent.user.username} required />
              <input name="password" placeholder="νέος κωδικός" type="password" />
              <label className="check-field">
                <input name="mustChangePassword" type="checkbox" defaultChecked={parent.user.mustChangePassword} />
                Αλλαγή
              </label>
              <span>{parent.students.length} μαθητές</span>
              <button className="secondary-button" type="submit">
                Αποθήκευση
              </button>
              <button className="secondary-button danger" formAction={deleteParentAction} type="submit">
                Διαγραφή
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Μαθητές</h2>
          <p>Ο μαθητής έχει ΑΜ και ανήκει σε τμήμα, άρα και σε συγκεκριμένο σχολικό έτος.</p>
        </div>

        <form action={upsertStudentAction} className="admin-form grid-form">
          <input name="am" placeholder="ΑΜ" required />
          <input name="name" placeholder="Όνομα" required />
          <input name="surname" placeholder="Επώνυμο" required />
          <input name="patronymic" placeholder="Πατρώνυμο" required />
          <select name="classId" required>
            {classes.map((classRecord) => (
              <option key={classRecord.id} value={classRecord.id}>
                {classRecord.name} ({classRecord.schoolYear.name})
              </option>
            ))}
          </select>
          <select name="parentId" defaultValue="">
            <option value="">Χωρίς γονέα</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.surname} {parent.name}
              </option>
            ))}
          </select>
          <button className="primary-button" type="submit">
            Προσθήκη μαθητή
          </button>
        </form>

        <div className="admin-table">
          {students.map((student) => (
            <form action={upsertStudentAction} className="admin-row editable-row" key={student.id}>
              <input name="id" type="hidden" value={student.id} />
              <input name="am" defaultValue={student.am} required />
              <input name="surname" defaultValue={student.surname} required />
              <input name="name" defaultValue={student.name} required />
              <input name="patronymic" defaultValue={student.patronymic} required />
              <select name="classId" defaultValue={student.classId}>
                {classes.map((classRecord) => (
                  <option key={classRecord.id} value={classRecord.id}>
                    {classRecord.name} ({classRecord.schoolYear.name})
                  </option>
                ))}
              </select>
              <select name="parentId" defaultValue={student.parentId ?? ""}>
                <option value="">Χωρίς γονέα</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.surname} {parent.name}
                  </option>
                ))}
              </select>
              <span>{student.class.schoolYear.name}</span>
              <button className="secondary-button" type="submit">
                Αποθήκευση
              </button>
              <button className="secondary-button danger" formAction={deleteStudentAction} type="submit">
                Διαγραφή
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Μαθήματα</h2>
          <p>Κάθε μάθημα έχει ΑΑ, ανήκει σε τμήμα και συνδέεται με έναν εκπαιδευτικό.</p>
        </div>

        <form action={upsertCourseAction} className="admin-form grid-form">
          <input name="aa" placeholder="ΑΑ" required />
          <input name="name" placeholder="Μάθημα" required />
          <select name="classId" required>
            {classes.map((classRecord) => (
              <option key={classRecord.id} value={classRecord.id}>
                {classRecord.name} ({classRecord.schoolYear.name})
              </option>
            ))}
          </select>
          <select name="teacherId" defaultValue="">
            <option value="">Εκπαιδευτικός</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.am} - {teacher.surname} {teacher.name}
              </option>
            ))}
          </select>
          <label className="check-field">
            <input name="isNoCourse" type="checkbox" />
            ΚΕΝΟ
          </label>
          <button className="primary-button" type="submit">
            Προσθήκη μαθήματος
          </button>
        </form>

        <div className="admin-table">
          {courses.map((course) => (
            <form action={upsertCourseAction} className="admin-row editable-row" key={course.id}>
              <input name="id" type="hidden" value={course.id} />
              <input name="aa" defaultValue={course.aa} required />
              <input name="name" defaultValue={course.name} required />
              <select name="classId" defaultValue={course.classId}>
                {classes.map((classRecord) => (
                  <option key={classRecord.id} value={classRecord.id}>
                    {classRecord.name} ({classRecord.schoolYear.name})
                  </option>
                ))}
              </select>
              <select name="teacherId" defaultValue={course.teachers[0]?.teacherId ?? ""}>
                <option value="">Χωρίς εκπαιδευτικό</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.am} - {teacher.surname} {teacher.name}
                  </option>
                ))}
              </select>
              <label className="check-field">
                <input name="isNoCourse" type="checkbox" defaultChecked={course.isNoCourse} />
                ΚΕΝΟ
              </label>
              <span>{course.class.name}</span>
              <button className="secondary-button" type="submit">
                Αποθήκευση
              </button>
              <button className="secondary-button danger" formAction={deleteCourseAction} type="submit">
                Διαγραφή
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Πρόγραμμα</h2>
          <p>Ορίζεται ποια μαθήματα έχει κάθε τμήμα ανά ημέρα και ώρα. Μία ώρα μπορεί να έχει περισσότερα από ένα μαθήματα.</p>
        </div>

        <form action={setScheduleSlotAction} className="admin-form grid-form">
          <select name="classId" required>
            {classes.map((classRecord) => (
              <option key={classRecord.id} value={classRecord.id}>
                {classRecord.name} ({classRecord.schoolYear.name})
              </option>
            ))}
          </select>
          <select name="day" defaultValue="MONDAY">
            {weekDays.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
          <select name="hour" defaultValue="1">
            {schoolHours.map((hour) => (
              <option key={hour.hour} value={hour.hour}>
                {hour.label}
              </option>
            ))}
          </select>
          <select name="courseIds" multiple required>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.class.name}: {course.aa} - {course.name}
              </option>
            ))}
          </select>
          <button className="primary-button" type="submit">
            Ορισμός ώρας
          </button>
        </form>

        <div className="admin-table">
          {scheduleSlots.map((slot) => (
            <form action={deleteScheduleSlotAction} className="admin-row schedule-admin-row" key={slot.id}>
              <input name="id" type="hidden" value={slot.id} />
              <strong>{slot.course.class.name}</strong>
              <span>{slot.course.class.schoolYear.name}</span>
              <span>{weekDayLabel(slot.day)}</span>
              <span>{schoolHours.find((hour) => hour.hour === slot.hour)?.label}</span>
              <span>{slot.course.name}</span>
              <button className="secondary-button danger" type="submit">
                Αφαίρεση
              </button>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
