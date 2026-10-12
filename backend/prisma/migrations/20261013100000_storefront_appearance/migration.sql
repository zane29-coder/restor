-- Mini App appearance and the map-pin rule (TZ 48).
--
-- `accentColor` is the storefront's own accent; null keeps the tenant's
-- white-label colour, which stays with the platform's branding permission.
-- Everything is nullable or defaults off, so no storefront changes until a
-- restaurant saves these settings.

ALTER TABLE "storefront_settings"
    ADD COLUMN "accentColor" VARCHAR(9),
    ADD COLUMN "bannerUrl" VARCHAR(2048),
    ADD COLUMN "bannerTitle" VARCHAR(80),
    ADD COLUMN "bannerText" VARCHAR(160),
    ADD COLUMN "requireMapPin" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "storefront_settings" ADD CONSTRAINT "storefront_settings_accent_check"
    CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9A-Fa-f]{6}$');
