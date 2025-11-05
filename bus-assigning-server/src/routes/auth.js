// bus-assigning-server/src/routes/auth.js
// 로그인(문자 코드) + JWT 발급 플러그인
// - SMS_MODE=console: 콘솔에 코드 출력 + devCode 반환(개발 편의)
// - 쿨다운 3분 / 만료 5분
// - verify 성공 시 코드 삭제
// - 응답에 driver.role 포함 (관리자 분기용)

import jwt from "jsonwebtoken";

// ── 유틸 ─────────────────────────────────────────────────────────────
function makeCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizeE164(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return null;
  return `+${digits}`;
}

async function buildTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) return null;
  const twilio = (await import("twilio")).default;
  return { client: twilio(sid, token), from };
}

// ── 플러그인 본체 ────────────────────────────────────────────────────
export async function authRoutes(fastify) {
  const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
  const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
  const SMS_MODE = (process.env.SMS_MODE || "console").toLowerCase() === "twilio" ? "twilio" : "console";
  const DEBUG_AUTH = String(process.env.DEBUG_AUTH || "0") === "1";

  fastify.log.info({ SMS_MODE }, "authRoutes starting with SMS mode");

  // 인증 미들웨어
  fastify.decorate("authenticate", async (req, reply) => {
    try {
      const h = req.headers.authorization || "";
      const [, token] = h.split(" ");
      if (!token) return reply.code(401).send({ error: "토큰 필요" });
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      return reply.code(401).send({ error: "유효하지 않은 토큰" });
    }
  });

  // ① 인증번호 요청
  fastify.post("/request-code", async (req, reply) => {
    const { name, phone } = req.body || {};
    if (!name || !phone) return reply.code(400).send({ error: "이름/전화번호 필요" });

    const e164 = normalizeE164(phone);
    if (!e164) return reply.code(400).send({ error: "전화번호 형식 오류" });

    // 3분 쿨다운
    const cd = await fastify.pg.query(
      `SELECT created_at
         FROM login_codes
        WHERE phone=$1 AND created_at > NOW() - interval '3 minutes'
        LIMIT 1`,
      [e164]
    );
    if (cd.rows.length) {
      const remain = 180 - Math.floor((Date.now() - new Date(cd.rows[0].created_at).getTime()) / 1000);
      return reply.code(429).send({ error: `재요청은 ${Math.max(remain, 1)}초 후 가능합니다` });
    }

    const code = makeCode();

    // drivers upsert (특정 번호는 admin, 나머지는 driver)
    const isAdmin = e164 === '+821080097964'; // 박준우님을 관리자로 설정
    const defaultRole = isAdmin ? 'admin' : 'driver';
    
    const upsertDriver = await fastify.pg.query(
      `INSERT INTO drivers (name, phone, role, last_seen)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (phone) DO UPDATE
       SET name=EXCLUDED.name, role=EXCLUDED.role, last_seen=NOW()
       RETURNING id, name, phone, role`,
      [name.trim(), e164, defaultRole]
    );

    // login_codes upsert (5분 만료)
    const upsertCode = await fastify.pg.query(
      `INSERT INTO login_codes (phone, name, code, expires_at, created_at)
       VALUES ($1,$2,$3, NOW() + interval '5 minutes', NOW())
       ON CONFLICT (phone) DO UPDATE
       SET name=EXCLUDED.name,
           code=EXCLUDED.code,
           expires_at=EXCLUDED.expires_at,
           created_at=EXCLUDED.created_at
       RETURNING phone, name, code, expires_at, created_at`,
      [e164, name.trim(), code]
    );

    // 디버그: 실제로 들어갔는지 확인
    const verifyRow = await fastify.pg.query(
      `SELECT phone, code, expires_at, created_at
         FROM login_codes WHERE phone=$1 LIMIT 1`,
      [e164]
    );

    try {
      if (SMS_MODE === "twilio") {
        const tw = await buildTwilio();
        if (!tw) {
          console.log(`[SMS-FALLBACK→console] to=${e164}, code=${code}`);
          const payload = { success: true, message: "인증번호 전송(콘솔)", devCode: code };
          if (DEBUG_AUTH) payload._debug = { driver: upsertDriver.rows[0], upsertCodeRowCount: upsertCode.rowCount, verifyRow: verifyRow.rows[0] || null };
          return reply.send(payload);
        }
        await tw.client.messages.create({
          from: tw.from,
          to: e164,
          body: `[버스배차앱] 인증번호: ${code} (5분 유효)`,
        });
        const payload = { success: true, message: "인증번호 전송" };
        if (DEBUG_AUTH) payload._debug = { driver: upsertDriver.rows[0], upsertCodeRowCount: upsertCode.rowCount, verifyRow: verifyRow.rows[0] || null };
        return reply.send(payload);
      } else {
        // console 모드
        console.log(`[SMS-MOCK] to=${e164}, code=${code} (5분 유효)`);
        const payload = { success: true, message: "인증번호 전송(콘솔)", devCode: code };
        if (DEBUG_AUTH) payload._debug = { driver: upsertDriver.rows[0], upsertCodeRowCount: upsertCode.rowCount, verifyRow: verifyRow.rows[0] || null };
        return reply.send(payload);
      }
    } catch (err) {
      console.error("인증번호 발송 실패:", err?.message || err);
      return reply.code(500).send({ error: "인증번호 발송 실패" });
    }
  });

  // ② 인증번호 검증 → JWT 발급, 코드 삭제
  fastify.post("/verify-code", async (req, reply) => {
    const { name, phone, code } = req.body || {};
    
    try {
      req.log?.info({ phone, code }, "verify-code start");

      const e164 = normalizeE164(phone);
      if (!name || !phone || !code || !e164) {
        return reply.code(400).send({ error: "이름/전화/코드 필요" });
      }

      // Debug: Check what's actually in the database
      const debugCheck = await fastify.pg.query(
        `SELECT phone, code, expires_at, created_at FROM login_codes ORDER BY created_at DESC LIMIT 5`
      );
      req.log?.info({ allCodes: debugCheck.rows }, "all recent codes in DB");

      const r = await fastify.pg.query(
        `SELECT code, expires_at, created_at FROM login_codes WHERE phone=$1 LIMIT 1`,
        [e164]
      );
      req.log?.info({ rRows: r.rows, searchPhone: e164 }, "login_codes rows for phone");

      if (!r.rows.length) {
        return reply.code(400).send({ error: "인증번호를 먼저 요청하세요" });
      }

      const row = r.rows[0];
      const now = Date.now();
      const expiresTime = new Date(row.expires_at).getTime();
      
      req.log?.info({ 
        now, 
        expiresTime, 
        expired: expiresTime < now,
        receivedCode: code,
        storedCode: row.code,
        codeMatch: row.code === String(code)
      }, "code verification details");

      if (expiresTime < now) {
        return reply.code(400).send({ error: "인증번호가 만료되었습니다" });
      }
      if (row.code !== String(code)) {
        return reply.code(400).send({ error: "인증번호가 올바르지 않거나 만료되었습니다." });
      }

      // ✅ 코드 검증 성공 → 기사 정보 조회
      const driverResult = await fastify.pg.query(
        `SELECT id, name, phone, role, active, created_at
         FROM drivers WHERE phone = $1 LIMIT 1`,
        [e164]
      );

      if (!driverResult.rows.length) {
        return reply.code(400).send({ error: "사용자 정보를 찾을 수 없습니다" });
      }

      const driver = driverResult.rows[0];

      // ✅ JWT 토큰 생성
      const token = jwt.sign(
        {
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          role: driver.role,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      // ✅ 사용된 코드 삭제
      await fastify.pg.query(`DELETE FROM login_codes WHERE phone = $1`, [e164]);

      // ✅ 마지막 접속 시간 업데이트
      await fastify.pg.query(
        `UPDATE drivers SET last_seen = NOW() WHERE id = $1`,
        [driver.id]
      );

      req.log?.info({ driverId: driver.id, role: driver.role }, "login successful, token generated");

      // ✅ 성공 응답 (토큰 + 기사 정보)
      return reply.send({
        success: true,
        token,
        driver: {
          id: driver.id,
          name: driver.name,
          phone: driver.phone,
          role: driver.role,
          active: driver.active,
        },
        message: "로그인 성공",
      });

    } catch (err) {
      req.log?.error({ err }, "verify-code error");
      return reply.code(500).send({ error: "서버 오류", detail: err.message });
    }
  });

  // ③ 세션 확인
  fastify.get("/me", { preHandler: [fastify.authenticate] }, async (req) => {
    return { user: req.user };
  });
}

export default authRoutes;