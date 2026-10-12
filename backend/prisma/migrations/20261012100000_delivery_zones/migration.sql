-- Drawn delivery zones (TZ 11).
--
-- A branch with active zones delivers only inside them, each with its own
-- tariff; a branch without zones keeps its radius rules. Nothing existing
-- changes until an owner draws a zone, so no backfill.
--
-- The polygon is JSONB ([[lat, lng], ...]) rather than PostGIS: the only
-- question ever asked is "which zone contains this point", answered in
-- application code for a handful of zones per branch, and PostGIS would be a
-- new extension on every server for that.

CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "color" VARCHAR(9) NOT NULL DEFAULT '#FF6B00',
    "polygon" JSONB NOT NULL,
    "deliveryPrice" INTEGER NOT NULL DEFAULT 0,
    "minOrderAmount" INTEGER,
    "freeDeliveryFrom" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_zones_price_check" CHECK ("deliveryPrice" >= 0)
);

CREATE INDEX "delivery_zones_tenantId_branchId_idx" ON "delivery_zones"("tenantId", "branchId");

ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
