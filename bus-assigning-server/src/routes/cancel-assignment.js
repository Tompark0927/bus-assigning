// src/routes/cancel-assignment.js
import { sendCallNotification } from '../notify/fcm.js';
import crypto from 'crypto';

export async function cancelAssignmentRoute(fastify) {  // Add 'async' here
  fastify.post('/assignments/:id/cancel', async (req, reply) => {
    const { id } = req.params;
    const client = await fastify.pg.pool.connect();
    
    try {
      await client.query('BEGIN');

      // 1) 해당 assignment + shift 조회
      const { rows: arows } = await client.query(
        `SELECT a.id, a.shift_id, a.driver_id, a.status,
                s.service_date, s.route_id, s.start_time, s.end_time
           FROM assignments a
           JOIN shifts s ON s.id = a.shift_id
          WHERE a.id = $1
          FOR UPDATE`,
        [id]
      );
      
      if (arows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'assignment not found' });
      }
      
      const asg = arows[0];

      // 이미 열린 호출이 있는지 체크
      const { rows: exist } = await client.query(
        `SELECT id FROM calls WHERE shift_id=$1 AND state='OPEN' LIMIT 1`,
        [asg.shift_id]
      );
      
      if (exist.length) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'call already open' });
      }

      // 2) calls 생성
      const { rows: crows } = await client.query(
        `INSERT INTO calls (shift_id, policy, state, created_at, expires_at)
         VALUES ($1, 'FIRST_WINS', 'OPEN', now(), now() + interval '30 minutes')
         RETURNING id, shift_id, state, expires_at`,
        [asg.shift_id]
      );
      
      const call = crows[0];

      // 3) 호출 대상 기사들 선별 (휴무 우선, 연속근무 적은 순)
      const { rows: candidates } = await client.query(
        `SELECT d.id, d.name, d.fcm_token,
                COALESCE(ds.state, 'WORKING') as day_state,
                COALESCE(st.consecutive_work_days, 0) as streak
           FROM drivers d
      LEFT JOIN driver_states ds ON ds.driver_id = d.id AND ds.service_date = $1
      LEFT JOIN driver_streaks st ON st.driver_id = d.id
          WHERE d.active = true 
            AND d.fcm_token IS NOT NULL
            AND d.id != $2  -- 원래 배정된 기사는 제외
            AND COALESCE(ds.state, 'WORKING') != 'BLOCKED'
          ORDER BY 
            CASE WHEN COALESCE(ds.state, 'WORKING') = 'OFF' THEN 0 ELSE 1 END,  -- 휴무자 우선
            COALESCE(st.consecutive_work_days, 0) ASC  -- 연속근무 적은 순
          LIMIT 10`,  
        [asg.service_date, asg.driver_id]
      );

      // 4) 각 후보자에게 토큰 생성
      const tokens = [];
      for (const candidate of candidates) {
        const token = crypto.randomBytes(32).toString('hex');
        const ttl = new Date(call.expires_at); // 호출 만료시간과 동일
        
        await client.query(
          `INSERT INTO call_tokens (call_id, driver_id, token, status, ttl)
           VALUES ($1, $2, $3, 'PENDING', $4)`,
          [call.id, candidate.id, token, ttl]
        );
        
        tokens.push({
          driverId: candidate.id,
          name: candidate.name,
          token: token,
          fcmToken: candidate.fcm_token
        });
      }

      // 5) assignments 상태를 PLANNED로 변경
      await client.query(
        `UPDATE assignments SET status='PLANNED', confirmed_at=NULL WHERE id=$1`,
        [asg.id]
      );

      await client.query('COMMIT');

      // 6) FCM 알림 발송 (트랜잭션 외부)
      const notificationPromises = tokens.map(async (t) => {
        try {
          const landingUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/landing/${call.id}?token=${t.token}`;
          await sendCallNotification({
            fcmToken: t.fcmToken,
            title: '긴급 배차 호출',
            body: `${asg.route_id} ${asg.start_time}~${asg.end_time} 근무 가능하신가요?`,
            data: {
              callId: String(call.id),
              shiftId: String(asg.shift_id),
              token: t.token,
              url: landingUrl
            }
          });
          fastify.log.info(`Notification sent to ${t.name} (${t.driverId})`);
        } catch (notifError) {
          fastify.log.error({ err: notifError, driverId: t.driverId }, 'Failed to send notification');
        }
      });
      Promise.allSettled(notificationPromises); // fire-and-forget

      return reply.send({ ok: true, call_id: call.id, candidates: tokens.length });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      fastify.log.error(e, 'cancel-assignment error');
      return reply.code(500).send({ error: 'cancel failed', detail: String(e?.message || e) });
    } finally {
      client.release();
    }
  });
}