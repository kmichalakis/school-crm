DATA
students (id, name, surname, class_id, parent_id)
users (id, username, password, class_id)
parents (id, name, surname, email, phone, username, password)
classes (id, name, year) [here year can be A, B, C]
teachers (id, name, surname, username, password, admin[BOOL], class_id)
courses (id, name, class_id, teacher_id[])
schedule (id, course_id, day, hour) [day=1..5, hour=1..7]
absences (id, schedule_id, student_id)

YEAR
The Data should also incorporate in some way the year, since we want this to work seemlesly each year, but also, have records of past years. Ideally, we want a button that creates a new year where the students of year A are promoted to year B, B to C and C are removed, while we add the new students of year A

TECHNOLOGY
The platform is available from a website. We want it responsive, since it will be accessed by tablets, phones and or digital boards. The server will be set in a hosting service.

FUNCTIONALITY
The user can access a specific class. The username/password is stored in the tablet of each class (there will be a dedicated tablet per class), so that the student responsible for the asbence sheets can load the website and start setting the absences of the specific hour.
When opening the page, the specific class (which can be infered from the user) is loaded with the students and the specific course (based on the current time). 
(Day 1: Monday, Day 2: Tuesday ...)
(Hour 1: 8:00-8:45, Hour 2: 8:50-9:35, Hour 3: 9:45-10:30, Hour 4: 10:40-11:25, Hour 5: 11:35-12:20, Hour 6: 12:25-13:10, Hour 7: 13:15-13:55)
The student sees on the page the course which is currently on schedule, but can always change the schedule (or set a different course because of a unexpected change in the schedule). They can also change the hour they want to edit (for example, it is the 3rd hour, but want to do a change in the 2nd hour). The student can set absences but cannot confirm (sign).  A teacher can choose the hour, change the course for that hour, set absences (like the students) but can also confirm absence changes (which cannot be done by the student). Confirming is like signing the absebce sheet for that course.
Some courses have multiple teachers (for example when a class is divided in two and at the same hour two different classes are taught). Both teachers can sign at an hour which shares courses.
The users that have admin rights can change the absences of every teacher, while the non admin teachers can only change their courses. 
In case of an absent teacher, since any teacher can change the hour and set a different course, they can set it to "NO COURSE" and sign (either adding absences or not, according to their discresion)

EXCUSED ABSENCE
Some teachers are responsible to keep track of the absences of a class. This is stored as a class_id in the DB. Those teachers have a specific admin page where they can see the absences in total, per day, per week etc. They can also define if a specific absence (a few hours, a whole day, a few days) are tagged as excused. They can also remove/fix stored absences of their class (even of other teachers)


REPORTS
Each class has reports exports. The responsible teacher can access the reports of their class. The admin of all classed. The reports can be filtered by dates and/or students. The export can be pdf or an xls

PARENT VIEW
The parents can log in and see the absences of their child. Again they can filter by date. A simple report to be printed can be exported.

EMAILING
There should be some cases where emailing a parent about absences. The criteria should be editable by the admin. Example: when a child is absent at the first hour (or the last hour), an email can inform the parent.

UI
Minimal, white background, simple buttons and interface
