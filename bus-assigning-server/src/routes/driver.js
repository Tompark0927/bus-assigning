// src/routes/driver.js
import jwt from "jsonwebtoken";

// 기사 권한 체크 미들웨어
function requireDriver(req, reply) {
  try {
    const h = req.headers.authorization || "";
    const [, token] = h.split(" ");
    if (!token) {
      reply.code(401).send({ error: "토큰 필요" });
      return null;
    }
    
    const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
    const user = jwt.verify(token, JWT_SECRET);
    
    if (!user || (user.role !== 'driver' && user.role !== 'admin')) {
      reply.code(403).send({ error: "기사 권한 필요" });
      return null;
    }
    
    return user;
  } catch {
    reply.code(401).send({ error: "유효하지 않은 토큰" });
    return null;
  }
}

export async function driverRoutes(fastify) {
  // 기사 상태 업데이트 (OFF/WORKING)
  fastify.put('/driver/update-state', async (req, reply) => {
    const driver = requireDriver(req, reply);
    if (!driver) return;

    const { state } = req.body || {};
    if (!state || !['OFF', 'WORKING'].includes(state)) {
      return reply.code(400).send({ error: 'state는 OFF 또는 WORKING이어야 합니다' });
    }

    const client = await fastify.pg.pool.connect();
    try {
      const today = new Date().toISOString().slice(0, 10);
      
      await client.query(`
        INSERT INTO driver_states (driver_id, service_date, state)
        VALUES ($1, $2, $3)
        ON CONFLICT (driver_id, service_date)
        DO UPDATE SET state = EXCLUDED.state
      `, [driver.id, today, state]);

      return reply.send({ ok: true, state });
    } finally {
      client.release();
    }
  });

  // 내 시프트 조회
  fastify.get('/driver/my-shifts', async (req, reply) => {
    const driver = requireDriver(req, reply);
    if (!driver) return;

    const client = await fastify.pg.pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT 
          s.id,
          s.service_date,
          s.route_id,
          s.start_time,
          s.end_time,
          a.status,
          a.confirmed_at
        FROM assignments a
        JOIN shifts s ON s.id = a.shift_id
        WHERE a.driver_id = $1 
          AND s.service_date >= CURRENT_DATE - INTERVAL '7 days'
          AND s.service_date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY s.service_date DESC, s.start_time DESC
      `, [driver.id]);

      return reply.send(rows);
    } finally {
      client.release();
    }
  });

  // 사용 가능한 긴급 호출 조회
  fastify.get('/driver/available-calls', async (req, reply) => {
    const driver = requireDriver(req, reply);
    if (!driver) return;

    const client = await fastify.pg.pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT 
          c.id,
          c.expires_at,
          s.service_date,
          s.route_id,
          s.start_time,
          s.end_time
        FROM calls c
        JOIN shifts s ON s.id = c.shift_id
        JOIN call_tokens ct ON ct.call_id = c.id
        WHERE c.state = 'OPEN' 
          AND c.expires_at > NOW()
          AND ct.driver_id = $1
          AND ct.status = 'PENDING'
        ORDER BY c.created_at DESC
      `, [driver.id]);

      return reply.send(rows);
    } finally {
      client.release();
    }
  });

  // 호출 응답 (수락)
  // fastify.post('/calls/:callId/accept', async (req, reply) => {
  //   const driver = requireDriver(req, reply);
  //   if (!driver) return;

  //   const { callId } = req.params;
  //   const client = await fastify.pg.pool.connect();
    
  //   try {
  //     await client.query('BEGIN');

  //     // 해당 호출의 토큰 확인
  //     const { rows: tokenRows } = await client.query(`
  //       SELECT ct.*, c.shift_id, c.state
  //       FROM call_tokens ct
  //       JOIN calls c ON c.id = ct.call_id
  //       WHERE ct.call_id = $1 AND ct.driver_id = $2 AND ct.status = 'PENDING'
  //       FOR UPDATE
  //     `, [callId, driver.id]);

  //     if (tokenRows.length === 0) {
  //       await client.query('ROLLBACK');
  //       return reply.code(404).send({ error: '응답할 수 있는 호출을 찾을 수 없습니다' });
  //     }

  //     const token = tokenRows[0];
      
  //     if (token.state !== 'OPEN') {
  //       await client.query('ROLLBACK');
  //       return reply.code(400).send({ error: '이미 종료된 호출입니다' });
  //     }

  //     // 토큰 상태를 RESPONDED로 변경
  //     await client.query(`
  //       UPDATE call_tokens 
  //       SET status = 'RESPONDED', response_at = NOW()
  //       WHERE call_id = $1 AND driver_id = $2
  //     `, [callId, driver.id]);

  //     await client.query('COMMIT');
  //     return reply.send({ ok: true, message: '호출에 응답했습니다' });

  //   } catch (e) {
  //     await client.query('ROLLBACK').catch(() => {});
  //     throw e;
  //   } finally {
  //     client.release();
  //   }
  // });

  // 호출 응답 (거절)
  fastify.post('/calls/:callId/decline', async (req, reply) => {
    const driver = requireDriver(req, reply);
    if (!driver) return;

    const { callId } = req.params;
    const client = await fastify.pg.pool.connect();
    
    try {
      await client.query(`
        UPDATE call_tokens 
        SET status = 'DECLINED', response_at = NOW()
        WHERE call_id = $1 AND driver_id = $2 AND status = 'PENDING'
      `, [callId, driver.id]);

      return reply.send({ ok: true, message: '호출을 거절했습니다' });
    } finally {
      client.release();
    }
  });

  // 기본 today-state 엔드포인트 (기존 호환성)
  fastify.get('/driver/today-state', async (req, reply) => {
    const driver = requireDriver(req, reply);
    if (!driver) return;

    const client = await fastify.pg.pool.connect();
    try {
      const today = new Date().toISOString().slice(0, 10);
      
      const { rows } = await client.query(`
        SELECT COALESCE(state, 'WORKING') as day_state 
        FROM driver_states 
        WHERE driver_id = $1 AND service_date = $2
      `, [driver.id, today]);

      return reply.send({
        state: rows[0]?.day_state || 'WORKING'
      });

    } finally {
      client.release();
    }
  });

  // Enhanced today status - 기존 today-state는 그대로 두고 새로운 엔드포인트 추가
  fastify.get('/driver/today-status-detailed', async (req, reply) => {
    const driver = requireDriver(req, reply);
    if (!driver) return;

    const client = await fastify.pg.pool.connect();
    try {
      const today = new Date().toISOString().slice(0, 10);
      
      // 오늘의 시프트 정보와 상태를 한번에 조회
      const { rows } = await client.query(`
        SELECT 
          s.id as shift_id,
          s.service_date,
          s.route_id,
          s.start_time,
          s.end_time,
          a.id as assignment_id,
          a.status as assignment_status,
          a.confirmed_at,
          COALESCE(ds.state, 'WORKING') as day_state,
          -- 오전/오후 판단 로직
          CASE 
            WHEN s.start_time < '13:00:00' THEN '오전반'
            WHEN s.start_time >= '13:00:00' THEN '오후반'
            ELSE '기타'
          END as shift_type,
          -- 진행중인 호출이 있는지 체크
          c.id as active_call_id,
          c.expires_at as call_expires_at
        FROM assignments a
        JOIN shifts s ON s.id = a.shift_id AND s.service_date = $2
        LEFT JOIN driver_states ds ON ds.driver_id = a.driver_id AND ds.service_date = $2
        LEFT JOIN calls c ON c.shift_id = s.id AND c.state = 'OPEN'
        WHERE a.driver_id = $1
      `, [driver.id, today]);

      // 명시적 휴무 상태도 확인
      const { rows: stateRows } = await client.query(`
        SELECT COALESCE(state, 'WORKING') as day_state 
        FROM driver_states 
        WHERE driver_id = $1 AND service_date = $2
      `, [driver.id, today]);

      const shiftData = rows[0];
      const dayState = stateRows[0]?.day_state || 'WORKING';
      
      // 상태 결정 로직
      let currentStatus;
      let statusDetail = '';
      
      if (shiftData) {
        // 시프트가 있는 경우
        currentStatus = shiftData.shift_type;
        statusDetail = `${shiftData.route_id}번 버스 ${shiftData.start_time}~${shiftData.end_time}`;
        
        if (shiftData.assignment_status === 'PLANNED') {
          statusDetail += ' (배정 대기중)';
        }
      } else if (dayState === 'OFF') {
        // 명시적 휴무
        currentStatus = '휴무';
        statusDetail = '오늘은 휴무입니다';
      } else {
        // 시프트 없음 = 자동 휴무
        currentStatus = '휴무';
        statusDetail = '배정된 시프트가 없습니다';
      }

      return reply.send({
        status: currentStatus,
        detail: statusDetail,
        hasShift: !!shiftData,
        shiftInfo: shiftData ? {
          id: shiftData.shift_id,
          assignmentId: shiftData.assignment_id,
          routeId: shiftData.route_id,
          startTime: shiftData.start_time,
          endTime: shiftData.end_time,
          shiftType: shiftData.shift_type,
          assignmentStatus: shiftData.assignment_status,
          canCancel: shiftData.assignment_status === 'CONFIRMED'
        } : null,
        activeCall: shiftData?.active_call_id ? {
          id: shiftData.active_call_id,
          expiresAt: shiftData.call_expires_at
        } : null
      });

    } finally {
      client.release();
    }
  });

  // 시프트 취소 요청 (사유 포함)
  fastify.post('/driver/cancel-my-shift', async (req, reply) => {
    const driver = requireDriver(req, reply);
    if (!driver) return;

    const { assignmentId, reason } = req.body || {};
    
    if (!assignmentId) {
      return reply.code(400).send({ error: 'assignmentId 필요' });
    }
    
    if (!reason || reason.trim().length < 2) {
      return reply.code(400).send({ error: '취소 사유를 입력해주세요 (최소 2자)' });
    }

    const client = await fastify.pg.pool.connect();
    
    try {
      await client.query('BEGIN');

      // 1) 해당 assignment가 본인 것인지, 취소 가능한 상태인지 확인
      const { rows: arows } = await client.query(`
        SELECT a.id, a.shift_id, a.driver_id, a.status,
               s.service_date, s.route_id, s.start_time, s.end_time
        FROM assignments a
        JOIN shifts s ON s.id = a.shift_id
        WHERE a.id = $1 AND a.driver_id = $2
        FOR UPDATE
      `, [assignmentId, driver.id]);
      
      if (arows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: '취소할 수 있는 배정을 찾을 수 없습니다' });
      }
      
      const assignment = arows[0];
      
      if (assignment.status !== 'CONFIRMED') {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: '확정된 배정만 취소할 수 있습니다' });
      }

      // 2) 이미 열린 호출이 있는지 체크
      const { rows: exist } = await client.query(`
        SELECT id FROM calls WHERE shift_id=$1 AND state='OPEN' LIMIT 1
      `, [assignment.shift_id]);
      
      if (exist.length) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: '이미 진행중인 호출이 있습니다' });
      }

      // 3) assignments 테이블에 cancelled_reason 컬럼이 있는지 확인 후 추가
      try {
        await client.query(`
          ALTER TABLE assignments 
          ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
          ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP
        `);
      } catch (e) {
        // 이미 존재하는 경우 무시
      }

      // 4) assignment 상태를 PLANNED로 변경하고 사유 기록
      await client.query(`
        UPDATE assignments 
        SET status = 'PLANNED', 
            confirmed_at = NULL,
            cancelled_reason = $2,
            cancelled_at = NOW()
        WHERE id = $1
      `, [assignmentId, reason.trim()]);

      await client.query('COMMIT');

      // 취소 성공 후 긴급 호출 생성은 별도 엔드포인트나 관리자가 수동으로 처리
      return reply.send({ 
        ok: true, 
        message: '시프트 취소 요청이 접수되었습니다. 관리자가 확인 후 긴급 호출을 발송합니다.'
      });

    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      fastify.log.error(e, 'cancel-my-shift error');
      return reply.code(500).send({ error: 'cancel failed', detail: String(e?.message || e) });
    } finally {
      client.release();
    }
  });
}

export default driverRoutes;