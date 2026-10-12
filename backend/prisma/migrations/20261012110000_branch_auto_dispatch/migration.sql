-- Auto-dispatch per branch.
--
-- When on, a delivery order that becomes READY is handed to the free courier
-- the suggestions already rank first (least loaded, then nearest). Off for
-- every existing branch, so nothing changes until an owner turns it on.
ALTER TABLE "branches" ADD COLUMN "autoDispatch" BOOLEAN NOT NULL DEFAULT false;
