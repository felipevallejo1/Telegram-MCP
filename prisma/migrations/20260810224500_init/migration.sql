-- Fictional MediControl demonstration schema. All timestamps are stored in UTC.
PRAGMA foreign_keys=OFF;

CREATE TABLE "Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birthDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Patient_email_key" ON "Patient"("email");

CREATE TABLE "Specialty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL
);
CREATE UNIQUE INDEX "Specialty_slug_key" ON "Specialty"("slug");

CREATE TABLE "Specialist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "licenseLabel" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Specialist_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Specialist_specialtyId_idx" ON "Specialist"("specialtyId");
CREATE INDEX "Specialist_city_idx" ON "Specialist"("city");

CREATE TABLE "AvailabilitySlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "specialistId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    CONSTRAINT "AvailabilitySlot_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AvailabilitySlot_specialistId_startsAt_key" ON "AvailabilitySlot"("specialistId", "startsAt");
CREATE INDEX "AvailabilitySlot_specialistId_status_startsAt_idx" ON "AvailabilitySlot"("specialistId", "status", "startsAt");

CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "Specialist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Appointment_patientId_createdAt_idx" ON "Appointment"("patientId", "createdAt");
CREATE INDEX "Appointment_specialistId_createdAt_idx" ON "Appointment"("specialistId", "createdAt");
CREATE INDEX "Appointment_slotId_idx" ON "Appointment"("slotId");
CREATE UNIQUE INDEX "Appointment_one_booked_per_slot" ON "Appointment"("slotId") WHERE "status" = 'BOOKED';

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegramUpdateId" TEXT NOT NULL,
    "requestedByChatIdHash" TEXT NOT NULL,
    "promptSummary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "codexSessionId" TEXT,
    "verificationSummary" TEXT,
    "notionUrl" TEXT,
    "notionStatus" TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE UNIQUE INDEX "AgentRun_telegramUpdateId_key" ON "AgentRun"("telegramUpdateId");

PRAGMA foreign_keys=ON;
