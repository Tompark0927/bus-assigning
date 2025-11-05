-- migrations/add_constraints.sql
-- drivers.name 유니크(없으면 추가)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='drivers_name_key') THEN
    ALTER TABLE drivers ADD CONSTRAINT drivers_name_key UNIQUE (name);
  END IF;
END $$;

-- assignments.shift_id 유니크(중복 정리 후 보강)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assignments_shift_unique') THEN
    -- 먼저 중복 제거
    DELETE FROM assignments a
    USING assignments b
    WHERE a.shift_id = b.shift_id
      AND a.id < b.id;

    ALTER TABLE assignments ADD CONSTRAINT assignments_shift_unique UNIQUE (shift_id);
  END IF;
END $$;
