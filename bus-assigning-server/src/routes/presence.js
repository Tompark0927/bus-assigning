// bus-assigning-server/src/routes/presence.js
// 드라이버 프레즌스(ping) 라우트

function getDriverId(req) {
  const did =
    req.headers['x-driver-id'] ||
    req.body?.driver_id ||
    req.cookies?.driver_id;
  if (!did) return null;
  const n = Number(did);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function presenceRoutes(fastify) {
  // ping: 드라이버 앱이 주기적으로 호출
  fastify.post('/ping', async (req, reply) => {
    try {
      const driverId = getDriverId(req);
      if (!driverId) {
        return reply.code(400).send({ error: 'driver_id 필요' });
      }

      const { lat = null, lng = null } = req.body || {};

      // 먼저 기존 드라이버 조회/업데이트 시도
      const { rows: existing } = await fastify.pg.query(
        `UPDATE drivers 
         SET last_seen = NOW(), last_lat = $2, last_lng = $3
         WHERE id = $1
         RETURNING id, name, role, last_seen`,
        [driverId, lat, lng]
      );

      if (existing.length > 0) {
        // 기존 드라이버 업데이트 성공
        return reply.send({ ok: true, driver: existing[0] });
      } else {
        // 드라이버가 없으면 자동 생성 (UPSERT)
        try {
          const { rows: created } = await fastify.pg.query(
            `INSERT INTO drivers (id, name, role, last_seen, last_lat, last_lng)
             VALUES ($1, $2, 'driver', NOW(), $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               last_seen = NOW(), last_lat = $3, last_lng = $4
             RETURNING id, name, role, last_seen`,
            [driverId, `Driver ${driverId}`, lat, lng]
          );
          
          return reply.send({ ok: true, driver: created[0] });
        } catch (insertErr) {
          req.log.error({ err: insertErr, driverId }, 'driver upsert failed');
          return reply.code(500).send({ error: 'driver creation failed' });
        }
      }

    } catch (err) {
      req.log.error({ err }, 'presence ping error');
      return reply.code(500).send({ error: 'internal' });
    }
  });
}

export default presenceRoutes;