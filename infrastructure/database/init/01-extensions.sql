-- Runs once, when the Postgres data directory is first created.
--
-- `pgcrypto` provides gen_random_uuid(), which the order-number sequence uses
-- in its atomic INSERT … ON CONFLICT … RETURNING statement. Postgres 13+ has
-- gen_random_uuid() built in, but the extension is kept for older servers and
-- for the other crypto helpers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigram indexes for the "search by product or customer name" filters.
-- Without it, `name ILIKE '%lavash%'` is a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
