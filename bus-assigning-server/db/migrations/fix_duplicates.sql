-- db/migrations/fix_duplicates.sql
-- 같은 이름의 드라이버가 복수 존재할 때 가장 작은 id로 이관 후 나머지 삭제

BEGIN;

-- 1) 중복 이름/대표 id 목록 생성
CREATE TEMP TABLE tmp_dup AS
SELECT name, MIN(id) AS keep_id, ARRAY_AGG(id) AS all_ids
FROM drivers
GROUP BY name
HAVING COUNT(*) > 1;

-- 중복 없으면 조기 종료
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tmp_dup) THEN
    RAISE NOTICE 'no duplicates found in drivers.name';
  END IF;
END
$do$ LANGUAGE plpgsql;

-- 2) id → 대표 id 매핑 테이블
CREATE TEMP TABLE tmp_to_fix AS
SELECT d.name, d.keep_id, UNNEST(d.all_ids) AS id
FROM tmp_dup d;

-- 3) 참조 테이블들에서 대표 id로 이관
UPDATE assignments a
SET driver_id = tf.keep_id
FROM tmp_to_fix tf
WHERE a.driver_id = tf.id
  AND a.driver_id <> tf.keep_id;

UPDATE driver_states ds
SET driver_id = tf.keep_id
FROM tmp_to_fix tf
WHERE ds.driver_id = tf.id
  AND ds.driver_id <> tf.keep_id;

UPDATE driver_streaks st
SET driver_id = tf.keep_id
FROM tmp_to_fix tf
WHERE st.driver_id = tf.id
  AND st.driver_id <> tf.keep_id;

UPDATE call_tokens ct
SET driver_id = tf.keep_id
FROM tmp_to_fix tf
WHERE ct.driver_id = tf.id
  AND ct.driver_id <> tf.keep_id;

-- 4) 대표 아닌 중복 행 삭제
DELETE FROM drivers d
USING tmp_dup k
WHERE d.name = k.name
  AND d.id <> k.keep_id;

COMMIT;

-- (선택) 결과 확인
-- SELECT name, COUNT(*) FROM drivers GROUP BY name HAVING COUNT(*) > 1;
