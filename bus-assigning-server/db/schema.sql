-- db/schema.sql
-- =========================================
-- 버스 배차 시스템 스키마 (멱등적, 야간 시프트 허용)
-- =========================================

-- ===== EXTENSIONS =====
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== ENUMS =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_day_state') THEN
    CREATE TYPE driver_day_state  AS ENUM ('WORKING', 'OFF', 'BLOCKED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_status') THEN
    CREATE TYPE assignment_status AS ENUM ('PLANNED', 'CONFIRMED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'call_state') THEN
    CREATE TYPE call_state        AS ENUM ('OPEN', 'CLOSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'call_policy') THEN
    CREATE TYPE call_policy       AS ENUM ('FIRST_WINS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'token_status') THEN
    CREATE TYPE token_status      AS ENUM ('PENDING', 'RESPONDED', 'WON', 'LOST', 'EXPIRED', 'CANCELLED');
  END IF;
END $$;

-- ===== CORE TABLES =====
CREATE TABLE IF NOT EXISTS drivers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT UNIQUE,
  fcm_token  TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  role       TEXT NOT NULL DEFAULT 'user',
  last_seen  TIMESTAMPTZ,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- 이름 유니크 (없으면 추가)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_name_key') THEN
    ALTER TABLE drivers ADD CONSTRAINT drivers_name_key UNIQUE (name);
  END IF;
END $$;

-- 최근 접속 인덱스
CREATE INDEX IF NOT EXISTS ix_drivers_last_seen ON drivers(last_seen);

CREATE TABLE IF NOT EXISTS shifts (
  id               SERIAL PRIMARY KEY,
  service_date     DATE NOT NULL,
  route_id         TEXT NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  required_license TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT shifts_unique_key UNIQUE (service_date, route_id, start_time, end_time)
);
-- ⚠️ 야간 시프트 허용을 위해 시간 비교 제약을 두지 않는다(00:30 종료 등).

CREATE TABLE IF NOT EXISTS driver_states (
  driver_id    INT REFERENCES drivers(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  state        driver_day_state NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, service_date)
);

CREATE TABLE IF NOT EXISTS assignments (
  id           SERIAL PRIMARY KEY,
  shift_id     INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  driver_id    INT REFERENCES drivers(id) ON DELETE CASCADE,
  status       assignment_status NOT NULL DEFAULT 'PLANNED',
  confirmed_at TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT assignments_shift_unique UNIQUE (shift_id)
);

CREATE TABLE IF NOT EXISTS calls (
  id         SERIAL PRIMARY KEY,
  shift_id   INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  policy     call_policy NOT NULL DEFAULT 'FIRST_WINS',
  state      call_state  NOT NULL DEFAULT 'OPEN',
  created_by INT REFERENCES drivers(id),
  CONSTRAINT calls_shift_unique UNIQUE (shift_id)
);

CREATE TABLE IF NOT EXISTS call_tokens (
  id           SERIAL PRIMARY KEY,
  call_id      INT  NOT NULL REFERENCES calls(id)   ON DELETE CASCADE,
  driver_id    INT  NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  status       token_status NOT NULL DEFAULT 'PENDING',
  ttl          TIMESTAMP NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  responded_at TIMESTAMP,
  CONSTRAINT call_tokens_call_driver_unique UNIQUE (call_id, driver_id)
);

CREATE TABLE IF NOT EXISTS events (
  id       SERIAL PRIMARY KEY,
  ts       TIMESTAMP NOT NULL DEFAULT now(),
  type     TEXT NOT NULL,
  actor    TEXT NOT NULL,
  payload  JSONB,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS driver_streaks (
  driver_id             INT PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  last_off_date         DATE,
  consecutive_work_days INT NOT NULL DEFAULT 0,
  updated_at            TIMESTAMP NOT NULL DEFAULT now()
);

-- 로그인 코드 (SMS)
CREATE TABLE IF NOT EXISTS login_codes (
  phone      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  attempts   INT NOT NULL DEFAULT 0
);

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_shifts_service_date ON shifts(service_date);
CREATE INDEX IF NOT EXISTS idx_shifts_route_date   ON shifts(route_id, service_date);
CREATE INDEX IF NOT EXISTS idx_assignments_driver  ON assignments(driver_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status  ON assignments(status);
CREATE INDEX IF NOT EXISTS idx_calls_state         ON calls(state);
CREATE INDEX IF NOT EXISTS idx_calls_expires_at    ON calls(expires_at);
CREATE INDEX IF NOT EXISTS idx_call_tokens_status  ON call_tokens(status);
CREATE INDEX IF NOT EXISTS idx_call_tokens_ttl     ON call_tokens(ttl);
CREATE INDEX IF NOT EXISTS idx_events_ts           ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type         ON events(type);
CREATE INDEX IF NOT EXISTS idx_driver_states_date  ON driver_states(service_date);

-- ===== TRIGGERS =====
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_drivers_updated_at     ON drivers;
CREATE TRIGGER trg_drivers_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_assignments_updated_at ON assignments;
CREATE TRIGGER trg_assignments_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_driver_streaks_updated_at ON driver_streaks;
CREATE TRIGGER trg_driver_streaks_updated_at
  BEFORE UPDATE ON driver_streaks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION set_responded_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'RESPONDED' AND OLD.status = 'PENDING' THEN
    NEW.responded_at = now();
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_call_tokens_responded_at ON call_tokens;
CREATE TRIGGER trg_call_tokens_responded_at
  BEFORE UPDATE ON call_tokens
  FOR EACH ROW EXECUTE FUNCTION set_responded_at();

-- ===== CHECK CONSTRAINTS (논리 검증) =====
-- 만료 로직의 시맨틱 보장
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_call_expires'
  ) THEN
    ALTER TABLE calls ADD CONSTRAINT check_call_expires CHECK (expires_at > created_at);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_token_ttl'
  ) THEN
    ALTER TABLE call_tokens ADD CONSTRAINT check_token_ttl CHECK (ttl > created_at);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_consecutive_days'
  ) THEN
    ALTER TABLE driver_streaks ADD CONSTRAINT check_consecutive_days CHECK (consecutive_work_days >= 0);
  END IF;
END $$;

-- ===== VIEWS =====
CREATE OR REPLACE VIEW driver_summary AS
SELECT 
  d.id, d.name, d.phone, d.active,
  d.fcm_token IS NOT NULL AS has_device,
  ds.consecutive_work_days, ds.last_off_date,
  COUNT(a.id) AS total_assignments,
  COUNT(CASE WHEN a.status = 'CONFIRMED' THEN 1 END) AS confirmed_assignments
FROM drivers d
LEFT JOIN driver_streaks ds ON ds.driver_id = d.id
LEFT JOIN assignments a     ON a.driver_id  = d.id
GROUP BY d.id, d.name, d.phone, d.active, ds.consecutive_work_days, ds.last_off_date;

CREATE OR REPLACE VIEW active_calls AS
SELECT 
  c.id, c.shift_id, c.state, c.expires_at,
  s.service_date, s.route_id, s.start_time, s.end_time,
  COUNT(ct.id)                                               AS total_tokens,
  COUNT(CASE WHEN ct.status = 'PENDING'   THEN 1 END)        AS pending_tokens,
  COUNT(CASE WHEN ct.status = 'RESPONDED' THEN 1 END)        AS responded_tokens
FROM calls c
JOIN shifts s      ON s.id = c.shift_id
LEFT JOIN call_tokens ct ON ct.call_id = c.id
WHERE c.state = 'OPEN' AND c.expires_at >= now()
GROUP BY c.id, c.shift_id, c.state, c.expires_at, s.service_date, s.route_id, s.start_time, s.end_time;

-- ===== MAINTENANCE =====
CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS TABLE(cleaned_calls INT, cleaned_tokens INT, cleaned_login_codes INT) AS $$
DECLARE call_count INT; token_count INT; code_count INT;
BEGIN
  UPDATE calls SET state = 'CLOSED' WHERE state = 'OPEN' AND expires_at < now();
  GET DIAGNOSTICS call_count = ROW_COUNT;

  UPDATE call_tokens SET status = 'EXPIRED' WHERE status = 'PENDING' AND ttl < now();
  GET DIAGNOSTICS token_count = ROW_COUNT;

  DELETE FROM login_codes WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS code_count = ROW_COUNT;

  RETURN QUERY SELECT call_count, token_count, code_count;
END; $$ LANGUAGE plpgsql;
-

-- assignments 테이블에 취소 관련 컬럼 추가
ALTER TABLE assignments 
ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

