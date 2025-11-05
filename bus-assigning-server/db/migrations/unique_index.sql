-- migrations/unique_index.sql
-- 드라이버/시프트 유니크 인덱스 보강(있으면 건너뜀)

CREATE UNIQUE INDEX IF NOT EXISTS drivers_name_key
  ON drivers(name);

CREATE UNIQUE INDEX IF NOT EXISTS shifts_unique_key
  ON shifts(service_date, route_id, start_time, end_time);
