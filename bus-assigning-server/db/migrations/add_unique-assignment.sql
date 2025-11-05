-- migrations/add_unique_assignment.sql
-- shift_id 단일 배정 보장(중복 정리 포함)
DELETE FROM assignments a
USING assignments b
WHERE a.shift_id = b.shift_id
  AND a.id < b.id;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assignments_shift_unique') THEN
    ALTER TABLE assignments ADD CONSTRAINT assignments_shift_unique UNIQUE (shift_id);
  END IF;
END $$;
