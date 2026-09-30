-- Online payments through Subo (TZ 35, 36).
--
-- Subo aggregates Atmos, Click and Payme behind one hosted checkout, so from
-- the till's point of view it is a single tender. Which provider actually
-- settled the charge is not known until the customer picks one on the checkout
-- page, so "provider" is nullable and filled in when the payment completes.
ALTER TYPE "PaymentMethod" ADD VALUE 'SUBO';

-- The checkout session is stored so a customer who closed the tab can be sent
-- back to the same one. Starting a second charge for the same order is the
-- failure mode this prevents.
ALTER TABLE "payments" ADD COLUMN "provider"          VARCHAR(32);
ALTER TABLE "payments" ADD COLUMN "checkoutUrl"       VARCHAR(2048);
ALTER TABLE "payments" ADD COLUMN "checkoutExpiresAt" TIMESTAMP(3);

-- Provider credentials are per tenant, not per platform: every restaurant has
-- its own Subo merchant account, and money must land with whoever sold the
-- food. The key is encrypted at rest (AES-256-GCM) exactly like a bot token.
CREATE TABLE "payment_provider_configs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "apiKeyEncrypted" TEXT,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_provider_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_provider_configs_tenantId_provider_key"
    ON "payment_provider_configs"("tenantId", "provider");

ALTER TABLE "payment_provider_configs"
    ADD CONSTRAINT "payment_provider_configs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
