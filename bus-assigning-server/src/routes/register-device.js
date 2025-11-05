// src/routes/register-device.js
export async function registerDeviceRoute(fastify) {
  fastify.post('/drivers/:driverId/device', async (req, reply) => {
    const { driverId } = req.params;
    const { fcmToken } = req.body || {};
    if (!fcmToken) return reply.code(400).send({ error: 'fcmToken required' });

    const client = await fastify.pg.pool.connect();
    try {
      const { rowCount } = await client.query(
        `UPDATE drivers SET fcm_token=$1 WHERE id=$2`,
        [fcmToken, driverId]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'driver not found' });
      return { ok: true };
    } finally {
      client.release();
    }
  });
}
