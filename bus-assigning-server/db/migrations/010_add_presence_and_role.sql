-- db/migrations/010_add_presence_and_role.sql

-- 1) drivers.role 컬럼 추가 (없을 때만)
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'drivers'
      AND column_name  = 'role'
  ) THEN
    ALTER TABLE public.drivers
      ADD COLUMN role text NOT NULL DEFAULT 'user';
  END IF;
END
$do$ LANGUAGE plpgsql;

-- 2) drivers.last_seen 컬럼 추가 (없을 때만)
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'drivers'
      AND column_name  = 'last_seen'
  ) THEN
    ALTER TABLE public.drivers
      ADD COLUMN last_seen timestamptz;
  END IF;
END
$do$ LANGUAGE plpgsql;

-- 3) 인덱스(존재하지 않을 때만)
CREATE INDEX IF NOT EXISTS ix_drivers_last_seen ON public.drivers(last_seen);

-- 4) 데이터 보정
UPDATE public.drivers SET role = 'driver' WHERE phone <> '+821080097964';
UPDATE public.drivers SET role = 'admin'  WHERE phone  = '+821080097964';

-- 5) 확인
SELECT id, name, phone, role FROM public.drivers;
