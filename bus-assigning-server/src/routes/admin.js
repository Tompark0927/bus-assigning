// bus-assigning-server/src/routes/admin.js
// 관리자용 API 라우터 (ESM)
import jwt from "jsonwebtoken";

/** 관리자 권한 체크 */
function requireAdmin(req, reply) {
  try {
    const h = req.headers.authorization || "";
    const [, token] = h.split(" ");
    if (!token) {
      reply.code(401).send({ error: "토큰 필요" });
      return null;
    }
    const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
    const user = jwt.verify(token, JWT_SECRET);

    // admin 권한만 OK
    if (!user || user.role !== "admin") {
      reply.code(403).send({ error: "관리자 권한 필요" });
      return null;
    }
    return user;
  } catch {
    reply.code(401).send({ error: "유효하지 않은 토큰" });
    return null;
  }
}

export default async function adminRoutes(fastify) {
  /** 대시보드(요약) */
  fastify.get("/admin/dashboard", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const client = await fastify.pg.pool.connect();
    try {
      const [activeCalls, activeDrivers, todayCompleted] = await Promise.all([
        client.query(`
          SELECT COUNT(*)::int AS cnt
          FROM calls
          WHERE state='OPEN' AND expires_at > NOW()
        `),
        client.query(`
          SELECT COUNT(*)::int AS cnt
          FROM drivers
          WHERE active=true AND role='driver' AND last_seen > NOW() - INTERVAL '1 hour'
        `),
        client.query(`
          SELECT COUNT(*)::int AS cnt
          FROM calls
          WHERE state='CLOSED' AND created_at::date = CURRENT_DATE
        `),
      ]);

      // 최근 활동 10건
      const recent = await client.query(`
        SELECT * FROM (
          SELECT 
            'call_created' AS type,
            'system' AS actor,
            c.created_at AS ts,
            json_build_object('route_id', s.route_id, 'call_id', c.id) AS data
          FROM calls c
          JOIN shifts s ON s.id = c.shift_id
          WHERE c.created_at > NOW() - INTERVAL '2 hours'
          UNION ALL
          SELECT
            'call_responded' AS type,
            d.name AS actor,
            ct.responded_at AS ts,
            json_build_object('route_id', s.route_id, 'call_id', c.id, 'driver_name', d.name) AS data
          FROM call_tokens ct
          JOIN calls c ON c.id = ct.call_id
          JOIN shifts s ON s.id = c.shift_id
          JOIN drivers d ON d.id = ct.driver_id
          WHERE ct.status='RESPONDED' AND ct.responded_at > NOW() - INTERVAL '2 hours'
          UNION ALL
          SELECT
            'shift_cancelled' AS type,
            d.name AS actor,
            a.cancelled_at AS ts,
            json_build_object('route_id', s.route_id, 'reason', a.cancelled_reason, 'driver_name', d.name) AS data
          FROM assignments a
          JOIN shifts s ON s.id = a.shift_id
          JOIN drivers d ON d.id = a.driver_id
          WHERE a.cancelled_at > NOW() - INTERVAL '2 hours'
        ) t
        ORDER BY ts DESC
        LIMIT 10
      `);

      return reply.send({
        stats: {
          openCalls: activeCalls.rows[0]?.cnt ?? 0,
          activeDrivers: activeDrivers.rows[0]?.cnt ?? 0,
          completedCallsToday: todayCompleted.rows[0]?.cnt ?? 0,
        },
        recentActivity: recent.rows,
      });
    } finally {
      client.release();
    }
  });

  /** 호환용: /admin/dashboard-overview (간단 숫자만) */
  fastify.get("/admin/dashboard-overview", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const client = await fastify.pg.pool.connect();
    try {
      const [activeDrivers, totalShifts, confirmedShifts, openCalls] = await Promise.all([
        client.query(`
          SELECT COUNT(*)::int AS cnt
          FROM drivers
          WHERE active=true AND role='driver' AND last_seen > NOW() - INTERVAL '1 hour'
        `),
        client.query(`
          SELECT COUNT(*)::int AS cnt
          FROM shifts
          WHERE service_date = CURRENT_DATE
        `),
        client.query(`
          SELECT COUNT(*)::int AS cnt
          FROM assignments a
          JOIN shifts s ON s.id = a.shift_id
          WHERE s.service_date = CURRENT_DATE AND a.status='CONFIRMED'
        `),
        client.query(`
          SELECT COUNT(*)::int AS cnt
          FROM calls
          WHERE state='OPEN' AND expires_at > NOW()
        `),
      ]);

      return reply.send({
        activeDrivers: activeDrivers.rows[0]?.cnt ?? 0,
        totalShifts: totalShifts.rows[0]?.cnt ?? 0,
        confirmedShifts: confirmedShifts.rows[0]?.cnt ?? 0,
        openCalls: openCalls.rows[0]?.cnt ?? 0,
      });
    } finally {
      client.release();
    }
  });

  /** 호출관리 목록 */
  fastify.get("/admin/calls", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const client = await fastify.pg.pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT 
          c.id,
          c.state,
          c.created_at,
          c.expires_at,
          s.service_date,
          s.route_id,
          s.start_time,
          s.end_time,
          COUNT(ct.id)::int AS total_tokens,
          COUNT(CASE WHEN ct.status='RESPONDED' THEN 1 END)::int AS responded_tokens,
          COUNT(CASE WHEN ct.status='PENDING' THEN 1 END)::int AS pending_tokens,
          wd.name AS winner_name
        FROM calls c
        JOIN shifts s ON s.id = c.shift_id
        LEFT JOIN call_tokens ct ON ct.call_id = c.id
        LEFT JOIN call_tokens wct ON wct.call_id = c.id AND wct.status='WON'
        LEFT JOIN drivers wd ON wd.id = wct.driver_id
        WHERE c.created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY c.id, s.service_date, s.route_id, s.start_time, s.end_time, wd.name
        ORDER BY c.created_at DESC
        LIMIT 100
      `);
      return reply.send(rows);
    } finally {
      client.release();
    }
  });

  /** 기사관리 목록 */
  fastify.get("/admin/drivers", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const client = await fastify.pg.pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT 
          d.id, d.name, d.phone, d.role, d.active, d.last_seen, d.created_at,
          COALESCE(ds.state, 'WORKING') AS today_status,
          COUNT(CASE WHEN s.service_date = CURRENT_DATE AND a.status='CONFIRMED' THEN 1 END)::int AS today_confirmed_shifts
        FROM drivers d
        LEFT JOIN driver_states ds ON ds.driver_id = d.id AND ds.service_date = CURRENT_DATE
        LEFT JOIN assignments a ON a.driver_id = d.id
        LEFT JOIN shifts s ON s.id = a.shift_id
        GROUP BY d.id, ds.state
        ORDER BY d.last_seen DESC NULLS LAST, d.name
      `);
      return reply.send(rows);
    } finally {
      client.release();
    }
  });

  /** 긴급 호출 생성 (관리자 발신) */
  fastify.post("/admin/create-emergency-call", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;

    const { shiftId, expiryMinutes = 10 } = req.body || {};
    if (!shiftId) return reply.code(400).send({ error: "shiftId 필요" });

    const client = await fastify.pg.pool.connect();
    try {
      await client.query("BEGIN");

      // 중복 OPEN 호출 방지
      const existing = await client.query(
        `SELECT id FROM calls WHERE shift_id=$1 AND state='OPEN' LIMIT 1`,
        [shiftId]
      );
      if (existing.rowCount > 0) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "이미 진행중인 호출이 있습니다" });
      }

      // 호출 생성
      const callIns = await client.query(
        `INSERT INTO calls (shift_id, expires_at, created_by)
         VALUES ($1, NOW() + INTERVAL '${expiryMinutes} minutes', $2)
         RETURNING id, expires_at`,
        [shiftId, admin.id]
      );
      const callId = callIns.rows[0].id;

      // 활성 드라이버에게 토큰 발송
      const active = await client.query(`
        SELECT id FROM drivers
        WHERE active=true AND role='driver' AND last_seen > NOW() - INTERVAL '2 hours'
      `);

      for (const row of active.rows) {
        const token = Math.random().toString(36).slice(2);
        await client.query(
          `INSERT INTO call_tokens (call_id, driver_id, token, status, ttl)
           VALUES ($1, $2, $3, 'PENDING', NOW() + INTERVAL '${expiryMinutes} minutes')`,
          [callId, row.id, token]
        );
      }

      await client.query("COMMIT");
      return reply.send({
        ok: true,
        callId,
        expiresAt: callIns.rows[0].expires_at,
        tokensCreated: active.rowCount,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      fastify.log.error(e, "create-emergency-call error");
      return reply.code(500).send({ error: "call creation failed" });
    } finally {
      client.release();
    }
  });
}
