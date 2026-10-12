-- Inventory: batches with use-by dates, purchase orders sent to suppliers by
-- Telegram, and stock-take acts (TZ 29-31).
--
-- Batches are not a table: a RECEIPT movement carries the batch's use-by date
-- and code, and what is left of each batch is estimated first-in first-out
-- from the current level. Stock leaves through automatic consumption, which
-- cannot know which batch a cook reached for, so a stored per-batch balance
-- would be a guess dressed up as a figure.
--
-- Every new column is nullable or defaulted; nothing existing changes.

ALTER TABLE "stock_items"
    ADD COLUMN "category" VARCHAR(60),
    ADD COLUMN "sku" VARCHAR(40);

ALTER TABLE "suppliers" ADD COLUMN "telegramChatId" VARCHAR(64);

CREATE TYPE "SupplierOrderStatus" AS ENUM ('SENT', 'RECEIVED', 'CANCELLED');

CREATE TABLE "supplier_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "SupplierOrderStatus" NOT NULL DEFAULT 'SENT',
    "lines" JSONB NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "expectedAt" TIMESTAMP(3),
    "telegramStatus" VARCHAR(20) NOT NULL DEFAULT 'NO_CHAT',
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_orders_total_check" CHECK ("total" >= 0)
);

CREATE UNIQUE INDEX "supplier_orders_tenantId_number_key" ON "supplier_orders"("tenantId", "number");
CREATE INDEX "supplier_orders_tenantId_branchId_createdAt_idx" ON "supplier_orders"("tenantId", "branchId", "createdAt");

ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_movements"
    ADD COLUMN "expiresAt" TIMESTAMP(3),
    ADD COLUMN "batchCode" VARCHAR(40),
    ADD COLUMN "supplierOrderId" UUID;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplierOrderId_fkey"
    FOREIGN KEY ("supplierOrderId") REFERENCES "supplier_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stock_takes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "note" VARCHAR(500),
    "lines" JSONB NOT NULL,
    "itemsCount" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL,
    "shortageValue" INTEGER NOT NULL DEFAULT 0,
    "surplusValue" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_takes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_takes_tenantId_branchId_createdAt_idx" ON "stock_takes"("tenantId", "branchId", "createdAt");

ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
