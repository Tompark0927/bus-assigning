-- db/seed.demo.sql
-- 목적: 로컬에서 즉시 페이지를 확인/동작시켜보기 위한 풍부한 샘플.
-- 운영에서는 절대 사용하지 말 것.

-- 기사
INSERT INTO drivers (name, phone, active, role) VALUES
  ('김철수', '+821011111111', TRUE, 'driver'),
  ('박영희', '+821022222222', TRUE, 'driver'),
  ('이민수', '+821033333333', TRUE, 'driver'),
  ('관리자', '+821000000000', TRUE, 'admin')
ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, active = TRUE, role = EXCLUDED.role;

-- 오늘/내일 일부 시프트 (야간 허용)
INSERT INTO shifts (service_date, route_id, start_time, end_time) VALUES
  (CURRENT_DATE, '1번', '06:00:00', '13:00:00'),
  (CURRENT_DATE, '2번', '13:00:00', '20:00:00'),
  (CURRENT_DATE, '3번', '20:30:00', '01:30:00'),
  (CURRENT_DATE + 1, '1번', '06:00:00', '13:00:00')
ON CONFLICT (service_date, route_id, start_time, end_time) DO NOTHING;

-- 확정/대기 배정
WITH s AS (
  SELECT id, route_id, start_time FROM shifts WHERE service_date = CURRENT_DATE
)
INSERT INTO assignments (shift_id, driver_id, status, confirmed_at)
SELECT s.id,
       CASE WHEN s.route_id='1번' AND s.start_time='06:00:00' THEN (SELECT id FROM drivers WHERE name='김철수')
            WHEN s.route_id='2번' AND s.start_time='13:00:00' THEN (SELECT id FROM drivers WHERE name='박영희')
            ELSE NULL END,
       CASE WHEN s.route_id IN ('1번','2번') THEN 'CONFIRMED'::assignment_status ELSE 'PLANNED'::assignment_status END,
       CASE WHEN s.route_id IN ('1번','2번') THEN now() - interval '30 minutes' ELSE NULL END
FROM s
ON CONFLICT (shift_id) DO NOTHING;

-- 샘플 호출 + 토큰 (대기 중 시프트 대상)
WITH unassigned AS (
  SELECT s.id FROM shifts s
  JOIN assignments a ON a.shift_id = s.id
  WHERE s.service_date = CURRENT_DATE AND a.status = 'PLANNED'
  LIMIT 1
)
INSERT INTO calls (shift_id, policy, state, expires_at)
SELECT id, 'FIRST_WINS', 'OPEN', now() + interval '30 minutes'
FROM unassigned
ON CONFLICT (shift_id) DO NOTHING;

WITH active_call AS (
  SELECT c.id AS call_id, s.service_date 
  FROM calls c JOIN shifts s ON s.id = c.shift_id 
  WHERE c.state = 'OPEN' LIMIT 1
)
INSERT INTO call_tokens (call_id, driver_id, token, status, ttl)
SELECT ac.call_id, d.id, encode(gen_random_bytes(32), 'hex'), 'PENDING', now() + interval '30 minutes'
FROM active_call ac
JOIN drivers d ON d.active = TRUE AND d.role = 'driver'
ON CONFLICT (call_id, driver_id) DO NOTHING;

-- 이벤트 로그 예시
INSERT INTO events (type, actor, payload)
VALUES ('system_init','system', jsonb_build_object('ts',now(),'message','demo seed loaded'))
ON CONFLICT DO NOTHING;
