# Σχολικό CRM

Προσαρμοζόμενο σύστημα διαχείρισης παρουσιών και απουσιών για τάμπλετ τάξεων, εκπαιδευτικούς, διαχειριστές, υπεύθυνους τμημάτων και γονείς.

## Τρέχουσα υλοποίηση

- Εφαρμογή Next.js και TypeScript
- Μοντέλο δεδομένων PostgreSQL με Prisma
- Login ανά ρόλο: admin, εκπαιδευτικός, τάμπλετ τάξης, γονέας
- Διαχείριση σχολικών ετών, τμημάτων, εκπαιδευτικών, γονέων, μαθητών, μαθημάτων και προγράμματος
- Εισαγωγή δεδομένων από Excel
- Απουσιολόγιο, υπογραφές, αναφορές, dashboard, εκτυπώσεις και πύλη γονέα

## Τοπική εγκατάσταση

Χρησιμοποίησε Node.js 20 ή νεότερο. Προτείνεται Node 22 LTS.

1. Εγκατάσταση εξαρτήσεων:

   ```bash
   npm install
   ```

2. Αντιγραφή του `.env.example` σε `.env` και ενημέρωση του `DATABASE_URL`.

3. Δημιουργία Prisma client:

   ```bash
   npm run prisma:generate
   ```

4. Δημιουργία πινάκων βάσης δεδομένων:

   ```bash
   npm run prisma:migrate
   ```

5. Εισαγωγή δοκιμαστικών δεδομένων:

   ```bash
   npm run db:seed
   ```

   Για καθαρή βάση χωρίς demo δεδομένα, δημιούργησε μόνο admin:

   ```bash
   ADMIN_PASSWORD="ένας-ισχυρός-κωδικός" npm run db:bootstrap-admin
   ```

6. Εκκίνηση εφαρμογής:

   ```bash
   npm run dev
   ```

## Δωρεάν online δοκιμή με Vercel και Neon

1. Ανέβασε το project σε GitHub.
2. Δημιούργησε δωρεάν PostgreSQL βάση στο Neon.
3. Στο Vercel κάνε Import το GitHub repo.
4. Στο Vercel, πρόσθεσε τα Environment Variables:

   ```text
   DATABASE_URL=το connection string από Neon
   NEXTAUTH_SECRET=ένα μεγάλο τυχαίο secret
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=ένας ισχυρός αρχικός κωδικός
   EMAIL_FROM=attendance@example.com
   ```

5. Το `vercel-build` θα τρέξει αυτόματα:

   ```bash
   prisma migrate deploy
   npm run db:bootstrap-admin
   next build
   ```

6. Μετά το deploy, μπες με τον admin χρήστη και κάνε import το Excel από τη σελίδα διαχείρισης.

Για πραγματικά δεδομένα μαθητών/γονέων, χρησιμοποίησε το online περιβάλλον μόνο με κλειστή πρόσβαση και ισχυρό admin κωδικό.

## Επόμενα βήματα

- Κανόνες και αποστολή πραγματικών email
- Πιο αναλυτικά reports ανά περίοδο
- Ρόλοι και δικαιώματα ανά σχολική μονάδα
