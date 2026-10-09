-- A refresh token may belong to a CUSTOMER, not only to a staff User (TZ 48).
--
-- Telegram Mini App sign-in has never worked. It upserts a Customer and then
-- issues a token pair with `userId = customer.id`, but "refresh_tokens.userId"
-- is a foreign key to "users" -- so every single sign-in failed with
--
--   Foreign key constraint violated: refresh_tokens_userId_fkey
--
-- which the API surfaced as a flat 400 "A referenced record does not exist".
-- Customers are deliberately NOT users: they hold no permissions and never
-- sign in to a staff surface. So the session has to be able to point at either.
--
-- Both columns are nullable with a CHECK that exactly one is set, rather than
-- a single polymorphic id plus a type column: this way the database still
-- enforces that a session points at a row that exists, and cascades when that
-- row is deleted. A polymorphic id cannot have a foreign key at all.

ALTER TABLE "refresh_tokens" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "refresh_tokens" ADD COLUMN "customerId" UUID;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE;

-- Exactly one owner. Without this, a row with both nulls would be a session
-- belonging to nobody that no revocation sweep could ever find.
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_one_owner"
  CHECK (num_nonnulls("userId", "customerId") = 1);

-- Mirrors the existing (userId, revokedAt) index: revoking every session for
-- one customer is the same query shape as for a user.
CREATE INDEX "refresh_tokens_customerId_revokedAt_idx"
  ON "refresh_tokens" ("customerId", "revokedAt");
