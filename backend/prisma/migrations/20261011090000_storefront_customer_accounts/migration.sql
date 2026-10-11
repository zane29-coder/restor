-- The customer side of the Telegram Mini App (TZ 48).
--
-- 1. A RESTOR-wide customer account. Until now a customer existed only inside
--    one restaurant, so ordering from three restaurants meant typing a name,
--    phone and address three times. The account holds those once; each
--    restaurant keeps its own "customers" row (CRM, loyalty, history) and
--    links to it through "accountId". Restaurants never read the account:
--    they learn a person's details from the orders placed with them.
-- 2. Saved addresses, favourites and an inbox on that account.
-- 3. Curated recommendations ("Sizga yoqishi mumkin", "Yana nimadir kerakmi?").
-- 4. Per-restaurant checkout settings: which payment options, cutlery, door.
-- 5. Marketing campaigns, kept as rows for the history screen and the limit.
-- 6. New columns: portion size, default modifier, public promo codes, and the
--    order fields the checkout collects (payment intent, courier note,
--    cutlery, leave-at-door, intercom).
--
-- Additive only: no existing column changes meaning and no data is rewritten.

-- CreateEnum
CREATE TYPE "PortionUnit" AS ENUM ('G', 'ML', 'PCS');
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "RecommendationPlacement" AS ENUM ('PRODUCT_DETAIL', 'CART');
CREATE TYPE "CustomerNotificationType" AS ENUM (
  'ORDER_RECEIVED', 'ORDER_ACCEPTED', 'ORDER_PREPARING', 'ORDER_READY',
  'ORDER_ON_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED',
  'PAYMENT_RECEIVED', 'PAYMENT_FAILED',
  'NEW_PRODUCT', 'PROMOTION', 'PROMO_CODE', 'SERVICE'
);
CREATE TYPE "NotificationCategory" AS ENUM ('TRANSACTIONAL', 'MARKETING', 'SERVICE');
CREATE TYPE "CampaignKind" AS ENUM ('NEW_PRODUCT', 'PROMOTION', 'PROMO_CODE', 'ANNOUNCEMENT');

-- ---------------------------------------------------------------------------
-- Columns on existing tables
-- ---------------------------------------------------------------------------

ALTER TABLE "customers" ADD COLUMN "accountId" UUID;

ALTER TABLE "products"
  ADD COLUMN "portionSize" INTEGER,
  ADD COLUMN "portionUnit" "PortionUnit";

-- Half a portion is meaningless: "450" of what, or "g" of how much.
ALTER TABLE "products"
  ADD CONSTRAINT "products_portion_pair"
  CHECK (("portionSize" IS NULL) = ("portionUnit" IS NULL));

ALTER TABLE "products"
  ADD CONSTRAINT "products_portion_positive"
  CHECK ("portionSize" IS NULL OR "portionSize" > 0);

ALTER TABLE "modifiers" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "orders"
  ADD COLUMN "addressIntercom" VARCHAR(20),
  ADD COLUMN "courierComment" VARCHAR(500),
  ADD COLUMN "cutleryCount" INTEGER,
  ADD COLUMN "leaveAtDoor" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paymentMethod" "PaymentMethod",
  ADD COLUMN "paymentProvider" VARCHAR(32);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_cutlery_range"
  CHECK ("cutleryCount" IS NULL OR "cutleryCount" BETWEEN 0 AND 50);

ALTER TABLE "promo_codes"
  ADD COLUMN "description" VARCHAR(500),
  ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Customer accounts (RESTOR-wide, NOT tenant-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "telegramId" VARCHAR(32),
    "firstName" VARCHAR(60),
    "lastName" VARCHAR(60),
    "phone" VARCHAR(20),
    "phoneVerifiedAt" TIMESTAMP(3),
    "email" VARCHAR(255),
    "birthDate" DATE,
    "gender" "Gender",
    "language" VARCHAR(10) NOT NULL DEFAULT 'uz',
    "telegramUsername" VARCHAR(64),
    "telegramFirstName" VARCHAR(64),
    "telegramLastName" VARCHAR(64),
    "telegramPhotoUrl" VARCHAR(2048),
    "notifyTelegram" BOOLEAN NOT NULL DEFAULT true,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- Global: a Telegram user id is the same person in every restaurant's bot.
CREATE UNIQUE INDEX "customer_accounts_telegramId_key" ON "customer_accounts"("telegramId");
-- Deliberately NOT unique: phones are unverified until an SMS check exists.
CREATE INDEX "customer_accounts_phone_idx" ON "customer_accounts"("phone");

CREATE TABLE "customer_account_addresses" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "label" VARCHAR(60),
    "address" VARCHAR(500) NOT NULL,
    "house" VARCHAR(20),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "apartment" VARCHAR(20),
    "entrance" VARCHAR(20),
    "floor" VARCHAR(20),
    "intercom" VARCHAR(20),
    "comment" VARCHAR(500),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_account_addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_account_addresses_accountId_idx" ON "customer_account_addresses"("accountId");

-- At most one default address per account. The service clears the old one in
-- the same transaction; this makes a race between two taps fail loudly
-- instead of leaving two "asosiy" addresses.
CREATE UNIQUE INDEX "customer_account_addresses_one_default"
  ON "customer_account_addresses"("accountId")
  WHERE "isDefault" AND "deletedAt" IS NULL;

ALTER TABLE "customer_account_addresses"
  ADD CONSTRAINT "customer_account_addresses_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One restaurant record per person per restaurant.
CREATE UNIQUE INDEX "customers_tenantId_accountId_key" ON "customers"("tenantId", "accountId");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Favourites
-- ---------------------------------------------------------------------------

CREATE TABLE "customer_favorites" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_favorites_accountId_productId_key" ON "customer_favorites"("accountId", "productId");
CREATE INDEX "customer_favorites_tenantId_accountId_idx" ON "customer_favorites"("tenantId", "accountId");

ALTER TABLE "customer_favorites"
  ADD CONSTRAINT "customer_favorites_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_favorites"
  ADD CONSTRAINT "customer_favorites_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_favorites"
  ADD CONSTRAINT "customer_favorites_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Marketing campaigns (before the inbox, which references them)
-- ---------------------------------------------------------------------------

CREATE TABLE "marketing_campaigns" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "CampaignKind" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "productId" UUID,
    "promoCodeId" UUID,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "telegramQueued" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "marketing_campaigns_tenantId_createdAt_idx" ON "marketing_campaigns"("tenantId", "createdAt");

ALTER TABLE "marketing_campaigns"
  ADD CONSTRAINT "marketing_campaigns_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns"
  ADD CONSTRAINT "marketing_campaigns_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns"
  ADD CONSTRAINT "marketing_campaigns_promoCodeId_fkey"
  FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_campaigns"
  ADD CONSTRAINT "marketing_campaigns_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------

CREATE TABLE "customer_notifications" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tenantId" UUID,
    "type" "CustomerNotificationType" NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "orderId" UUID,
    "productId" UUID,
    "campaignId" UUID,
    "readAt" TIMESTAMP(3),
    "deliveryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_notifications_accountId_createdAt_idx" ON "customer_notifications"("accountId", "createdAt");
CREATE INDEX "customer_notifications_accountId_readAt_idx" ON "customer_notifications"("accountId", "readAt");

ALTER TABLE "customer_notifications"
  ADD CONSTRAINT "customer_notifications_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notifications"
  ADD CONSTRAINT "customer_notifications_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_notifications"
  ADD CONSTRAINT "customer_notifications_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_notifications"
  ADD CONSTRAINT "customer_notifications_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_notifications"
  ADD CONSTRAINT "customer_notifications_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Recommendations
-- ---------------------------------------------------------------------------

CREATE TABLE "product_recommendations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "placement" "RecommendationPlacement" NOT NULL,
    "sourceProductId" UUID,
    "targetProductId" UUID,
    "targetCategoryId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_recommendations_tenantId_placement_sourceProductId_idx"
  ON "product_recommendations"("tenantId", "placement", "sourceProductId");

-- A line recommends a product OR a category, never both and never neither.
ALTER TABLE "product_recommendations"
  ADD CONSTRAINT "product_recommendations_one_target"
  CHECK (num_nonnulls("targetProductId", "targetCategoryId") = 1);

-- The cart list is restaurant-wide; only a product sheet has a source.
ALTER TABLE "product_recommendations"
  ADD CONSTRAINT "product_recommendations_cart_has_no_source"
  CHECK ("placement" <> 'CART' OR "sourceProductId" IS NULL);

ALTER TABLE "product_recommendations"
  ADD CONSTRAINT "product_recommendations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_recommendations"
  ADD CONSTRAINT "product_recommendations_sourceProductId_fkey"
  FOREIGN KEY ("sourceProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_recommendations"
  ADD CONSTRAINT "product_recommendations_targetProductId_fkey"
  FOREIGN KEY ("targetProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_recommendations"
  ADD CONSTRAINT "product_recommendations_targetCategoryId_fkey"
  FOREIGN KEY ("targetCategoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Storefront checkout settings
-- ---------------------------------------------------------------------------

CREATE TABLE "storefront_settings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cashEnabled" BOOLEAN NOT NULL DEFAULT true,
    "onlineProviders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cutleryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "leaveAtDoorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storefront_settings_tenantId_key" ON "storefront_settings"("tenantId");

-- Only providers Subo actually offers. A typo here would be an option on the
-- checkout screen that Subo rejects at the moment the customer pays.
ALTER TABLE "storefront_settings"
  ADD CONSTRAINT "storefront_settings_known_providers"
  CHECK ("onlineProviders" <@ ARRAY['ATMOS', 'CLICK', 'PAYME']::TEXT[]);

ALTER TABLE "storefront_settings"
  ADD CONSTRAINT "storefront_settings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
