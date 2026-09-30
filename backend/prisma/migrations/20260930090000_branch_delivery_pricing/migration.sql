-- Delivery pricing rules a restaurant can actually express (TZ 11).
--
-- Before this, a branch had one flat "deliveryPrice" and a hard radius. That
-- covers "free delivery" (price 0) and "we deliver within 5 km", but not the
-- most common Tashkent arrangement: free nearby, charged further out.
--
-- All three are nullable, and NULL means "rule not in use", so every existing
-- branch keeps its current flat pricing with no backfill.
ALTER TABLE "branches" ADD COLUMN "freeDeliveryRadiusM" INTEGER;
ALTER TABLE "branches" ADD COLUMN "freeDeliveryFrom"    INTEGER;
ALTER TABLE "branches" ADD COLUMN "deliveryPricePerKm"  INTEGER;
