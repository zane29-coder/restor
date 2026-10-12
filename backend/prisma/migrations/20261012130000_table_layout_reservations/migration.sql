-- Floor plan and table reservations (TZ 20).
--
-- Layout: a table's centre on its zone's plan, in plan units of a 1000 x 625
-- canvas, so the plan scales to any screen. Null until someone places it; the
-- admin lays unplaced tables out in a grid until then, so no backfill.
--
-- Reservations snapshot the guest's name and phone rather than linking a
-- customer: most bookings come by phone from someone who has never ordered.

ALTER TABLE "tables"
    ADD COLUMN "layoutX" INTEGER,
    ADD COLUMN "layoutY" INTEGER,
    ADD COLUMN "shape" VARCHAR(10) NOT NULL DEFAULT 'SQUARE';

ALTER TABLE "tables" ADD CONSTRAINT "tables_shape_check"
    CHECK ("shape" IN ('SQUARE', 'ROUND', 'RECT'));

CREATE TYPE "ReservationStatus" AS ENUM ('BOOKED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

CREATE TABLE "table_reservations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "tableId" UUID,
    "guestName" VARCHAR(120) NOT NULL,
    "guestPhone" VARCHAR(20) NOT NULL,
    "partySize" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 120,
    "status" "ReservationStatus" NOT NULL DEFAULT 'BOOKED',
    "note" VARCHAR(500),
    "seatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "table_reservations_party_check" CHECK ("partySize" > 0),
    CONSTRAINT "table_reservations_duration_check" CHECK ("durationMinutes" BETWEEN 15 AND 720)
);

CREATE INDEX "table_reservations_tenantId_branchId_startsAt_idx" ON "table_reservations"("tenantId", "branchId", "startsAt");
CREATE INDEX "table_reservations_tableId_startsAt_idx" ON "table_reservations"("tableId", "startsAt");

ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
