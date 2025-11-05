-- db/scripts/cleanup_duplicates.sql
BEGIN;

-- 1) 드라이버 '동명이인'에 접미사 (2), (3), ...
WITH ranked AS (
  SELECT
    d.id,
    d.name AS base_name,
    ROW_NUMBER() OVER (PARTITION BY d.name ORDER BY d.id) AS rn
  FROM drivers d
)
UPDATE drivers AS t
SET name = t.name || ' (' || r.rn || ')'
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1
  -- 이미 " (숫자)" 접미사가 붙어 있는 이름은 건드리지 않음
  AND t.name !~ ' \\([0-9]+\\)$';

-- 2) 시프트 중복 제거: (service_date, route_id, start_time, end_time) 키 기준
WITH dupe AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY service_date, route_id, start_time, end_time
      ORDER BY id
    ) AS rn
  FROM shifts
)
DELETE FROM shifts s
USING dupe d
WHERE s.id = d.id
  AND d.rn > 1;

COMMIT;

-- (선택) 확인용 쿼리
-- SELECT name, COUNT(*) FROM drivers GROUP BY name ORDER BY 2 DESC, 1;
-- SELECT service_date, route_id, start_time, end_time, COUNT(*) c
-- FROM shifts GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;
