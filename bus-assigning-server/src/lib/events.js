// src/lib/events.js
import { EventEmitter } from 'events';

/**
 * EventBus + Presence Sweep
 * - 컬럼이 없으면 스윕을 '조용히' 스킵
 * - 환경변수로 스윕 주기 조정/비활성화
 *   PRESENCE_SWEEP_INTERVAL_MS=0  -> 스윕 비활성화
 *   PRESENCE_SWEEP_INTERVAL_MS=30000 (기본)
 */
export async function createEventBus(fastify) {
  const ee = new EventEmitter();
  let sweepTimer = null;
  let closing = false;

  const intervalMs = Number(process.env.PRESENCE_SWEEP_INTERVAL_MS ?? 30000);
  const enabled = Number.isFinite(intervalMs) && intervalMs > 0;

  async function hasLastSeenColumn() {
    try {
      const { rows } = await fastify.pg.pool.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_name='drivers' AND column_name='last_seen'
        LIMIT 1
      `);
      return rows.length > 0;
    } catch (e) {
      fastify.log.debug(e, 'hasLastSeenColumn check failed');
      return false;
    }
  }

  async function presenceSweep() {
    if (closing) return;
    try {
      const ok = await hasLastSeenColumn();
      if (!ok) {
        fastify.log.debug('presence sweep skipped (drivers.last_seen missing)');
        return;
      }

      // 필요 시 오프라인 통계/이벤트 확장 가능
      const { rows } = await fastify.pg.pool.query(`
        SELECT COUNT(*)::int AS offline_cnt
        FROM drivers
        WHERE last_seen IS NOT NULL
          AND last_seen < (now() - interval '120 seconds')
      `);
      fastify.log.debug({ offline: rows[0]?.offline_cnt ?? 0 }, 'presence sweep ok');
    } catch (err) {
      fastify.log.error(err, 'presence sweep error');
    }
  }

  function broadcast(evt) {
    try { ee.emit('broadcast', evt); }
    catch (e) { fastify?.log?.error(e, 'broadcast failure'); }
  }

  function start() {
    if (!enabled) {
      fastify.log.info('Presence sweep is disabled (PRESENCE_SWEEP_INTERVAL_MS=0).');
      return;
    }
    if (!sweepTimer) {
      setTimeout(presenceSweep, 5000);            // 첫 스윕 지연
      sweepTimer = setInterval(presenceSweep, intervalMs);
      fastify.log.info(`Presence sweep started (every ${intervalMs} ms).`);
    }
  }

  function stop() {
    closing = true;
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
      fastify.log.info('Presence sweep stopped.');
    }
  }

  // Fastify lifecycle
  fastify.addHook?.('onClose', async () => stop());

  return { on: ee.on.bind(ee), off: ee.off?.bind(ee), broadcast, start, stop };
}
