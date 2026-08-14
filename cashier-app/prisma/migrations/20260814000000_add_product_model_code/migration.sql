-- Adds a required, unique Product.modelCode WITHOUT any risk of data loss.
-- This migration only ever UPDATEs existing rows (no INSERT/DELETE anywhere
-- below), so the number of products and every other column are structurally
-- guaranteed to be unchanged by this file.
--
-- Step 1: add the column as nullable first — purely additive, zero risk.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "modelCode" TEXT;

-- Step 2: backfill ONLY the rows that actually need a code:
--   - modelCode IS NULL
--   - modelCode is an empty/blank string
--   - modelCode duplicates another product's (the first occurrence, ordered
--     by id, keeps its existing code; every later duplicate is treated as
--     "needs a new code" below)
-- Existing valid, unique modelCodes are never touched.
DO $$
DECLARE
  rec RECORD;
  next_num INTEGER;
  candidate TEXT;
BEGIN
  -- Start numbering right after the highest existing MODEL-NNN code, so this
  -- never collides with codes already assigned (including by a prior partial
  -- run of this same migration, since every statement here is idempotent).
  SELECT COALESCE(MAX(substring("modelCode" from 'MODEL-(\d+)')::INTEGER), 0) + 1
    INTO next_num
    FROM "Product"
    WHERE "modelCode" ~ '^MODEL-\d+$';

  -- Duplicates: keep the first occurrence (lowest id) untouched; clear the
  -- rest so they fall into the "needs a new code" loop below.
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY "modelCode" ORDER BY id) AS rn
    FROM "Product"
    WHERE "modelCode" IS NOT NULL AND btrim("modelCode") <> ''
  )
  UPDATE "Product" p
  SET "modelCode" = NULL
  FROM ranked r
  WHERE p.id = r.id AND r.rn > 1;

  -- Assign a fresh, collision-checked MODEL-XXX code to every row still
  -- missing one, in a stable order (by id) so the result is deterministic.
  FOR rec IN
    SELECT id FROM "Product"
    WHERE "modelCode" IS NULL OR btrim("modelCode") = ''
    ORDER BY id
  LOOP
    LOOP
      candidate := 'MODEL-' || LPAD(next_num::TEXT, 3, '0');
      next_num := next_num + 1;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Product" WHERE "modelCode" = candidate);
    END LOOP;
    UPDATE "Product" SET "modelCode" = candidate WHERE id = rec.id;
  END LOOP;
END $$;

-- Step 3: every product now has a non-empty, unique modelCode — safe to
-- enforce it. If the backfill above somehow missed a case, these two
-- statements fail loudly with a normal Postgres error and the whole
-- migration (including step 1) rolls back atomically — nothing is left
-- half-applied, and no --accept-data-loss style override is involved.
ALTER TABLE "Product" ALTER COLUMN "modelCode" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Product_modelCode_key" ON "Product"("modelCode");
