-- db/verify_status.sql
-- 필수 객체 진단 스크립트 (여러 SELECT에서 재사용 가능하도록 TEMP 테이블 사용)
-- 사용: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify_status.sql

BEGIN;

-- 0) 목록 테이블들 생성
DROP TABLE IF EXISTS tmp_required_tables;
CREATE TEMP TABLE tmp_required_tables(name TEXT PRIMARY KEY);
INSERT INTO tmp_required_tables(name) VALUES
  ('drivers'),('shifts'),('assignments'),('calls'),('call_tokens'),
  ('driver_states'),('driver_streaks'),('events'),('login_codes');

DROP TABLE IF EXISTS tmp_required_columns;
CREATE TEMP TABLE tmp_required_columns(tbl TEXT, col TEXT, PRIMARY KEY(tbl,col));
INSERT INTO tmp_required_columns(tbl,col) VALUES
  ('drivers','name'),
  ('drivers','phone'),
  ('drivers','active'),
  ('drivers','role'),
  ('drivers','last_seen'),
  ('shifts','service_date'),
  ('shifts','route_id'),
  ('shifts','start_time'),
  ('shifts','end_time'),
  ('assignments','shift_id'),
  ('assignments','driver_id'),
  ('assignments','status'),
  ('calls','shift_id'),
  ('calls','state'),
  ('calls','expires_at'),
  ('call_tokens','call_id'),
  ('call_tokens','driver_id'),
  ('call_tokens','token'),
  ('call_tokens','status'),
  ('call_tokens','ttl');

DROP TABLE IF EXISTS tmp_required_constraints;
CREATE TEMP TABLE tmp_required_constraints(name TEXT PRIMARY KEY);
INSERT INTO tmp_required_constraints(name) VALUES
  ('drivers_name_key'),
  ('shifts_unique_key'),
  ('assignments_shift_unique'),
  ('check_call_expires'),
  ('check_token_ttl'),
  ('check_consecutive_days');

DROP TABLE IF EXISTS tmp_required_indexes;
CREATE TEMP TABLE tmp_required_indexes(name TEXT PRIMARY KEY);
INSERT INTO tmp_required_indexes(name) VALUES
  ('ix_drivers_last_seen'),
  ('idx_shifts_service_date'),
  ('idx_shifts_route_date'),
  ('idx_assignments_driver'),
  ('idx_assignments_status'),
  ('idx_calls_state'),
  ('idx_calls_expires_at'),
  ('idx_call_tokens_status'),
  ('idx_call_tokens_ttl'),
  ('idx_events_ts'),
  ('idx_events_type'),
  ('idx_driver_states_date');

DROP TABLE IF EXISTS tmp_required_functions;
CREATE TEMP TABLE tmp_required_functions(name TEXT PRIMARY KEY);
INSERT INTO tmp_required_functions(name) VALUES
  ('touch_updated_at'), ('set_responded_at'), ('cleanup_expired_data');

DROP TABLE IF EXISTS tmp_required_triggers;
CREATE TEMP TABLE tmp_required_triggers(tbl TEXT, trg TEXT, PRIMARY KEY(tbl,trg));
INSERT INTO tmp_required_triggers(tbl,trg) VALUES
  ('drivers','trg_drivers_updated_at'),
  ('assignments','trg_assignments_updated_at'),
  ('driver_streaks','trg_driver_streaks_updated_at'),
  ('call_tokens','trg_call_tokens_responded_at');

COMMIT;

-- 1) 테이블
SELECT 'TABLE' AS kind, t.name AS object,
       CASE WHEN c.relname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM tmp_required_tables t
LEFT JOIN pg_class c ON c.relname = t.name AND c.relkind = 'r'
ORDER BY 1,2;

-- 2) 컬럼
SELECT 'COLUMN' AS kind, rc.tbl||'.'||rc.col AS object,
       CASE WHEN col.column_name IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM tmp_required_columns rc
LEFT JOIN information_schema.columns col
  ON col.table_name = rc.tbl AND col.column_name = rc.col
ORDER BY 2;

-- 3) 제약
SELECT 'CONSTRAINT' AS kind, r.name AS object,
       CASE WHEN con.conname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM tmp_required_constraints r
LEFT JOIN pg_constraint con ON con.conname = r.name
ORDER BY 2;

-- 4) 인덱스
SELECT 'INDEX' AS kind, r.name AS object,
       CASE WHEN i.relname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM tmp_required_indexes r
LEFT JOIN pg_class i ON i.relname = r.name AND i.relkind = 'i'
ORDER BY 2;

-- 5) 함수
SELECT 'FUNCTION' AS kind, r.name AS object,
       CASE WHEN p.proname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM tmp_required_functions r
LEFT JOIN pg_proc p ON p.proname = r.name
ORDER BY 2;

-- 6) 트리거
SELECT 'TRIGGER' AS kind, r.tbl||'.'||r.trg AS object,
       CASE WHEN t.tgname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM tmp_required_triggers r
LEFT JOIN pg_trigger t ON t.tgname = r.trg AND NOT t.tgisinternal
ORDER BY 2;

-- 7) enums
SELECT 'ENUM' AS kind, n.nspname||'.'||t.typname AS object, 'OK' AS status
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE t.typname IN ('driver_day_state','assignment_status','call_state','call_policy','token_status')
ORDER BY 2;

-- 8) 확장
SELECT 'EXTENSION' AS kind, e.extname AS object, 'OK' AS status
FROM pg_extension e
WHERE e.extname IN ('pgcrypto')
ORDER BY 2;
