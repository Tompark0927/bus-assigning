// bus-assigning-server/src/utils/call-scheduler.js
/**
 * 만료된 호출 정리 + 급한 시프트 재호출 + streak 갱신
 * - 라우트 등록용(plugin)과 타이머 시작을 분리해서
 *   "listen 이후 라우트 추가" 에러를 원천 차단
 */
import fp from 'fastify-plugin';

export class CallScheduler {
  constructor(fastify) {
    this.fastify = fastify;
    this.cleanupInterval = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const sweepMs = Number(process.env.CALL_SWEEP_INTERVAL_MS || 2 * 60 * 1000); // 2분
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCalls().catch(err =>
        this.fastify.log.error(err, 'cleanup-expired-calls error')
      );
    }, sweepMs);

    this.fastify.log.info('Call scheduler started');
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.isRunning = false;
    this.fastify.log.info('Call scheduler stopped');
  }

  // ── 메인 청소 루틴 ────────────────────────────────────────────────
  async cleanupExpiredCalls() {
    const client = await this.fastify.pg.pool.connect();
    try {
      await client.query('BEGIN');

      // 1) 만료된 호출들 잠금 조회
      const { rows: expiredCalls } = await client.query(
        `SELECT c.id, c.shift_id, s.service_date, s.route_id, s.start_time, s.end_time
           FROM calls c
           JOIN shifts s ON s.id = c.shift_id
          WHERE c.state = 'OPEN' AND c.expires_at < now()
          FOR UPDATE`
      );

      if (expiredCalls.length === 0) {
        await client.query('COMMIT');
        return;
      }

      const callIds = expiredCalls.map(c => c.id);

      // 2) 만료 토큰 EXPIRED
      await client.query(
        `UPDATE call_tokens 
            SET status = 'EXPIRED' 
          WHERE call_id = ANY($1::int[]) AND status = 'PENDING'`,
        [callIds]
      );

      // 3) 호출 CLOSED
      await client.query(
        `UPDATE calls 
            SET state = 'CLOSED' 
          WHERE id = ANY($1::int[])`,
        [callIds]
      );

      // 4) 이벤트 로그
      for (const call of expiredCalls) {
        await client.query(
          `INSERT INTO events(type, actor, payload)
           VALUES ('call_expired', 'system', $1)`,
          [JSON.stringify({
            callId: call.id,
            shiftId: call.shift_id,
            route: call.route_id,
            time: `${call.start_time}-${call.end_time}`
          })]
        );
      }

      await client.query('COMMIT');

      this.fastify.log.info(`Cleaned up ${expiredCalls.length} expired calls`);

      // 5) 급한 시프트는 재호출 시도
      await this.handleUrgentReCalls(expiredCalls);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async handleUrgentReCalls(expiredCalls) {
    const client = await this.fastify.pg.pool.connect();
    try {
      for (const call of expiredCalls) {
        const shiftStart = new Date(`${call.service_date} ${call.start_time}`);
        const hoursUntilStart = (shiftStart - new Date()) / (1000 * 60 * 60);

        if (hoursUntilStart > 0 && hoursUntilStart < 2) {
          const { rows: assignments } = await client.query(
            `SELECT status FROM assignments WHERE shift_id = $1`,
            [call.shift_id]
          );

          if (assignments.length && assignments[0].status === 'PLANNED') {
            await client.query(
              `INSERT INTO calls (shift_id, policy, state, created_at, expires_at)
               VALUES ($1, 'FIRST_WINS', 'OPEN', now(), now() + interval '15 minutes')
               ON CONFLICT (shift_id) DO UPDATE 
                 SET state = 'OPEN', 
                     expires_at = now() + interval '15 minutes',
                     created_at = now()`,
              [call.shift_id]
            );
            this.fastify.log.warn(`Re-created urgent call for shift ${call.shift_id} (${call.route_id} ${call.start_time})`);
          }
        }
      }
    } catch (error) {
      this.fastify.log.error(error, 'urgent-recall error');
    } finally {
      client.release();
    }
  }

  // 매일 자정 실행 권장(관리자 수동 실행 라우트로도 제공)
  async updateDriverStreaks() {
    const client = await this.fastify.pg.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: streakData } = await client.query(`
        WITH recent_work AS (
          SELECT DISTINCT a.driver_id, s.service_date
            FROM assignments a
            JOIN shifts s ON s.id = a.shift_id
           WHERE a.status = 'CONFIRMED'
             AND s.service_date >= CURRENT_DATE - interval '30 days'
           ORDER BY a.driver_id, s.service_date
        ),
        streaks AS (
          SELECT driver_id,
                 COUNT(*) as consecutive_days
            FROM (
              SELECT driver_id, service_date,
                     service_date - (ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY service_date))::integer * interval '1 day' as grp
                FROM recent_work
                WHERE service_date <= CURRENT_DATE - interval '1 day'
            ) grouped
           WHERE grp = (
             SELECT MAX(service_date - (ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY service_date))::integer * interval '1 day')
               FROM recent_work r2 
              WHERE r2.driver_id = grouped.driver_id
                AND r2.service_date <= CURRENT_DATE - interval '1 day'
           )
           GROUP BY driver_id, grp
        )
        SELECT driver_id, consecutive_days FROM streaks
      `);

      for (const { driver_id, consecutive_days } of streakData) {
        await client.query(
          `INSERT INTO driver_streaks (driver_id, consecutive_work_days, last_off_date)
           VALUES ($1, $2, CASE WHEN $2 = 0 THEN CURRENT_DATE - interval '1 day' ELSE NULL END)
           ON CONFLICT (driver_id) 
           DO UPDATE SET consecutive_work_days = EXCLUDED.consecutive_work_days,
                         last_off_date = EXCLUDED.last_off_date`,
          [driver_id, consecutive_days]
        );
      }

      await client.query('COMMIT');
      this.fastify.log.info(`Updated streaks for ${streakData.length} drivers`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * ✅ 라우트 등록용 플러그인 (listen 이전에 fastify.register(...) 로만 호출)
 *  - 여기서는 라우트만 정의 (타이머 시작 금지)
 */
 export const callSchedulerRoutes = fp(async function callSchedulerRoutes(fastify) {
     // fastify-plugin으로 루트에 데코레이트 승격
     if (!fastify.hasDecorator('scheduler')) {
       fastify.decorate('scheduler', new CallScheduler(fastify));
     }
  
     // 관리자 수동 실행 라우트
     fastify.post('/admin/cleanup-calls', async (req, reply) => {
       try {
         await fastify.scheduler.cleanupExpiredCalls();
         return { ok: true, message: 'Cleanup completed' };
       } catch (error) {
         fastify.log.error(error);
         return reply.code(500).send({ error: 'Cleanup failed', detail: error.message });
       }
     });
  
     fastify.post('/admin/update-streaks', async (req, reply) => {
       try {
         await fastify.scheduler.updateDriverStreaks();
        return { ok: true, message: 'Streaks updated' };
       } catch (error) {
         fastify.log.error(error);
         return reply.code(500).send({ error: 'Streak update failed', detail: error.message });
       }
     });
   }, {
     name: 'callSchedulerRoutes'   // 의존성 관리에도 유용
   });

/**
 * ✅ 타이머 시작 (listen 이후에만 호출)
 *  - 라우트 등록을 절대 수행하지 않음
 */
export async function startCallScheduler(fastify) {
  // decorator는 이미 callSchedulerRoutes에서 추가되었으므로 확인만 함
  if (!fastify.scheduler) {
    fastify.log.error('Scheduler decorator not found! Make sure callSchedulerRoutes is registered first.');
    return;
  }
  
  fastify.scheduler.start();

  const cleanup = () => fastify.scheduler.stop();
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

// (구버전 호환 래퍼)
export async function setupCallScheduler(fastify) {
  return startCallScheduler(fastify);
}
