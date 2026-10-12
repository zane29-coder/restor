-- A standing staff note per customer ("piyozsiz", "domofon ishlamaydi").
-- Nullable; existing customers simply have none.
ALTER TABLE "customers" ADD COLUMN "notes" VARCHAR(1000);
