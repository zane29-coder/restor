-- A daily revenue goal per branch, for the dashboard's branch ranking.
--
-- Nullable, and NULL means "no goal": every existing branch shows its takings
-- without a target bar until the owner sets one. Minor units, like all money.
ALTER TABLE "branches" ADD COLUMN "dailyRevenueTarget" INTEGER;
