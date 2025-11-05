-- db/seed.min.sql
-- 목적: 운영/스테이징에서 불필요한 더미 데이터를 남기지 않기 위한 '빈에 가까운' 시드.
-- 실행해도 실데이터를 오염시키지 않는다.

-- 1) 선택: 운영 초기 접근 계정으로 사용할 '관리자 역할' 드라이버 1명 생성
--   - 앱 구조상 별도 users 테이블이 없으므로 drivers.role 을 활용
INSERT INTO drivers (name, phone, active, role)
VALUES ('관리자', '+821000000000', TRUE, 'admin')
ON CONFLICT (name) DO UPDATE SET phone = EXCLUDED.phone, role = EXCLUDED.role, active = TRUE;

-- 2) 최소 무해성: 어떤 배차/호출/토큰/배정도 넣지 않는다.
--    엑셀 업로드(import)나 실제 앱 흐름에서 데이터가 생성되도록 둔다.

-- 3) (선택) presence 기능을 켜려면 last_seen 을 NULL 로 두어도 무방.
--    첫 앱 접속시 /presence/ping 으로 갱신됨.
