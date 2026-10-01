-- Inventory (TZ 29-31).
--
-- Stock is held AT A BRANCH, never pooled per tenant: flour in Chilonzor
-- cannot be used by Yunusobod, and one shared figure would let a branch sell a
-- dish it has no ingredients for.
--
-- Quantities are NUMERIC(14,3), not double precision. Deducting 0.1 kg three
-- hundred times has to come to exactly 30 kg, and binary floats do not.

CREATE TYPE "StockUnit" AS ENUM ('KG', 'G', 'L', 'ML', 'PCS');

CREATE TYPE "StockMovementType" AS ENUM (
    'RECEIPT', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN'
);

CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20),
    "contact" VARCHAR(200),
    "comment" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "unit" "StockUnit" NOT NULL DEFAULT 'PCS',
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minQuantity" DECIMAL(14,3),
    "costPerUnit" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- Append-only ledger. The running total on stock_items is derived from these,
-- so a level can always be explained and a disagreement is itself a finding.
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "costPerUnit" INTEGER,
    "supplierId" UUID,
    "orderId" UUID,
    "comment" VARCHAR(500),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- A product with no rows here is simply not stock-tracked, which is the
-- incremental path: cost the ten busiest dishes without modelling the menu.
CREATE TABLE "product_ingredients" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppliers_tenantId_name_key" ON "suppliers"("tenantId", "name");
CREATE INDEX "suppliers_tenantId_isActive_idx" ON "suppliers"("tenantId", "isActive");

CREATE UNIQUE INDEX "stock_items_branchId_name_key" ON "stock_items"("branchId", "name");
CREATE INDEX "stock_items_tenantId_branchId_idx" ON "stock_items"("tenantId", "branchId");

CREATE INDEX "stock_movements_stockItemId_createdAt_idx" ON "stock_movements"("stockItemId", "createdAt");
CREATE INDEX "stock_movements_tenantId_createdAt_idx" ON "stock_movements"("tenantId", "createdAt");
CREATE INDEX "stock_movements_orderId_idx" ON "stock_movements"("orderId");

CREATE UNIQUE INDEX "product_ingredients_productId_stockItemId_key" ON "product_ingredients"("productId", "stockItemId");
CREATE INDEX "product_ingredients_stockItemId_idx" ON "product_ingredients"("stockItemId");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockItemId_fkey"
    FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_stockItemId_fkey"
    FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
