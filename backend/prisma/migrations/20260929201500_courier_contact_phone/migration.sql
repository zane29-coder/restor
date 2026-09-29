-- The number customers ring at the door, editable by the courier themselves.
--
-- Deliberately separate from "users"."phone", which is the login key and is
-- unique per tenant: a courier correcting a contact number must not be able to
-- change their own credentials, nor collide with another employee's login.
-- NULL means "fall back to the login phone", so every existing courier keeps
-- working without a backfill.
ALTER TABLE "couriers" ADD COLUMN "contactPhone" VARCHAR(20);
