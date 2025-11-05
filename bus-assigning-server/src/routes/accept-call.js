// src/routes/accept-call.js

// 공통 헬퍼
function requireLogin(req, reply) {
  const driverId = Number(req.cookies?.driver_id || 0);
  if (!driverId) {
    reply.code(401).send({ error: 'login required' });
    return null;
  }
  return driverId;
}

// tie-break 점수: OFF(휴무)이면 +10, 연속근무일수만큼 페널티
function tieBreakScore({ isOff, consecutive }) {
  return (isOff ? 10 : 0) - (Number(consecutive) || 0);
}

// 랜딩 페이지
export async function landingRoute(fastify) {
  fastify.get('/landing/:callId', async (req, reply) => {
    const callId = Number(req.params.callId);
    const token = String(req.query?.token || '');

    const db = await fastify.pg.pool.connect();
    try {
      const { rows } = await db.query(
        `SELECT c.id, c.shift_id, c.state, c.expires_at,
                s.service_date, s.route_id, s.start_time, s.end_time
           FROM calls c
           JOIN shifts s ON s.id=c.shift_id
          WHERE c.id=$1`,
        [callId]
      );
      
      if (!rows.length) {
        return reply.code(404).send('존재하지 않는 호출입니다.');
      }
      
      const c = rows[0];
      const closed = (c.state !== 'OPEN') || (new Date(c.expires_at) < new Date());
      const expiresLabel = new Date(c.expires_at).toLocaleString('ko-KR');

      const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>호출 참여</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:20px;line-height:1.6;background:#f8f9fa}
.container{max-width:500px;margin:0 auto}
h1{margin:0 0 20px;color:#333;text-align:center}
.card{border:1px solid #ddd;border-radius:12px;padding:20px;margin-bottom:16px;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
.info-row{margin:8px 0;padding:8px;background:#f8f9fa;border-radius:6px}
.info-row strong{color:#0066cc}
.btn{display:inline-block;padding:12px 20px;border-radius:8px;border:none;font-weight:600;cursor:pointer;text-decoration:none;transition:all 0.2s}
.btn-primary{background:#28a745;color:white}
.btn-primary:hover{background:#218838}
.btn-secondary{background:#6c757d;color:white;margin-left:8px}
.btn-secondary:hover{background:#545b62}
.btn:disabled{background:#ccc;cursor:not-allowed}
.status{display:inline-block;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:600}
.status.open{background:#d4edda;color:#155724}
.status.closed{background:#f8d7da;color:#721c24}
#msg{margin-top:15px;padding:10px;border-radius:6px}
.success{background:#d4edda;color:#155724;border:1px solid #c3e6cb}
.error{background:#f8d7da;color:#721c24;border:1px solid #f5c6cb}
small{color:#666}
</style>
</head>
<body>
  <div class="container">
    <h1>🚌 긴급 배차 호출</h1>
    
    <div class="card">
      <div class="info-row"><strong>호출번호:</strong> #${c.id}</div>
      <div class="info-row"><strong>노선:</strong> ${c.route_id}</div>
      <div class="info-row"><strong>운행일:</strong> ${c.service_date}</div>
      <div class="info-row"><strong>시간:</strong> ${c.start_time} ~ ${c.end_time}</div>
      <div class="info-row"><strong>마감시간:</strong> ${expiresLabel}</div>
      <div class="info-row">
        <strong>상태:</strong> 
        <span class="status ${c.state.toLowerCase()}">${c.state === 'OPEN' ? '접수중' : '마감'}</span>
      </div>
    </div>

    <div class="card">
      <div style="text-align:center">
        <button class="btn btn-primary" ${closed || !token ? 'disabled' : ''} onclick="accept()">
          제가 하겠습니다!
        </button>
        <button class="btn btn-secondary" onclick="cancelMine()">내 수락 취소</button>
      </div>
      
      <div id="msg"></div>
      
      <div style="margin-top:15px;text-align:center">
        <small>※ 선착순 + 공정배정으로 최종 배정자가 결정됩니다</small>
      </div>
    </div>
  </div>

<script>
async function accept(){
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '처리중...';
  
  try {
    const res = await fetch('/calls/${c.id}/accept?token=${encodeURIComponent(token)}', { method:'POST' });
    const data = await res.text();
    const msgEl = document.getElementById('msg');
    if (res.ok) {
      msgEl.innerHTML = '<div class="success">✅ 수락 완료! 배정 결과를 기다려주세요.</div>';
    } else {
      msgEl.innerHTML = '<div class="error">❌ ' + (data || '수락 실패') + '</div>';
      btn.disabled = false;
      btn.textContent = '제가 하겠습니다!';
    }
  } catch (e) {
    document.getElementById('msg').innerHTML = '<div class="error">❌ 네트워크 오류: ' + e.message + '</div>';
    btn.disabled = false;
    btn.textContent = '제가 하겠습니다!';
  }
}

async function cancelMine(){
  if (!confirm('내 수락을 취소하시겠습니까?')) return;
  try {
    const res = await fetch('/calls/${c.id}/cancel', { method:'POST' });
    const data = await res.text();
    const msgEl = document.getElementById('msg');
    if (res.ok) {
      msgEl.innerHTML = '<div class="success">✅ 수락 취소 완료 (호출은 계속 진행됩니다)</div>';
    } else {
      msgEl.innerHTML = '<div class="error">❌ ' + (data || '취소 실패') + '</div>';
    }
  } catch (e) {
    document.getElementById('msg').innerHTML = '<div class="error">❌ 네트워크 오류: ' + e.message + '</div>';
  }
}
</script>
</body></html>`;
      
      return reply.header('Content-Type','text/html; charset=utf-8').send(html);
    } finally {
      db.release();
    }
  });
}

// 수락/취소 라우트
export default async function acceptCallRoute(fastify, opts) {
  const _bus = fastify.bus; // bus는 fastify.decorate로 이미 올려둔 거 사용
  // 수락: POST /calls/:callId/accept?token=xxxxx
  fastify.post('/calls/:callId/accept', async (req, reply) => {
    const callId = Number(req.params.callId);
    const token = String(req.query?.token || '');
    const me = requireLogin(req, reply);
    if (!me) return;

    const db = await fastify.pg.pool.connect();
    try {
      await db.query('BEGIN');

      // 1) 토큰 검증
      const { rows: tokenRows } = await db.query(
        `SELECT ct.id, ct.driver_id, ct.status, ct.ttl, 
                c.state, c.expires_at, c.shift_id,
                s.service_date, s.route_id, s.start_time, s.end_time
           FROM call_tokens ct
           JOIN calls c ON c.id = ct.call_id  
           JOIN shifts s ON s.id = c.shift_id
          WHERE ct.token = $1 AND ct.call_id = $2
          FOR UPDATE`,
        [token, callId]
      );

      if (!tokenRows.length) {
        await db.query('ROLLBACK');
        return reply.code(400).send({ error: 'invalid token' });
      }

      const tok = tokenRows[0];
      
      // 토큰 상태/유효성 검증
      if (tok.status !== 'PENDING' && tok.status !== 'RESPONDED') {
        await db.query('ROLLBACK');
        return reply.code(410).send({ error: 'token already used' });
      }
      if (new Date(tok.ttl) < new Date() || tok.state !== 'OPEN' || new Date(tok.expires_at) < new Date()) {
        await db.query('ROLLBACK');
        return reply.code(410).send({ error: 'call expired or closed' });
      }

      // 로그인 사용자와 토큰 소유자 일치 확인
      if (Number(tok.driver_id) !== me) {
        await db.query('ROLLBACK');
        return reply.code(403).send({ error: 'token not owned by current user' });
      }

      // 2) 토큰을 RESPONDED로 마킹
      await db.query(`UPDATE call_tokens SET status = 'RESPONDED' WHERE id = $1`, [tok.id]);

      // 3) 현재 배정 상황 체크
      const { rows: assignRows } = await db.query(
        `SELECT id, driver_id, status FROM assignments WHERE shift_id = $1 FOR UPDATE`,
        [tok.shift_id]
      );
      if (assignRows.length && assignRows[0].status === 'CONFIRMED') {
        await db.query(`UPDATE call_tokens SET status = 'LOST' WHERE id = $1`, [tok.id]);
        await db.query('COMMIT');

        // 이미 확정됨 알림
        _bus?.broadcast?.({
          type: 'call_closed',
          call_id: callId,
          reason: 'already_taken'
        });

        return reply.code(409).send({ error: 'already taken by someone else' });
      }

      // 4) 응답한 후보자들 tie-break
      const { rows: candidates } = await db.query(
        `SELECT ct.id, ct.driver_id,
                COALESCE(ds.state,'WORKING') as state,
                COALESCE(st.consecutive_work_days,0) as streak,
                ct.created_at
           FROM call_tokens ct
      LEFT JOIN driver_states ds ON ds.driver_id=ct.driver_id AND ds.service_date=$1
      LEFT JOIN driver_streaks st ON st.driver_id=ct.driver_id
          WHERE ct.call_id=$2 AND ct.status='RESPONDED'
          ORDER BY ct.created_at ASC`,  
        [tok.service_date, callId]
      );

      if (!candidates.length) {
        await db.query('ROLLBACK');
        return reply.code(500).send({ error: 'no candidates' });
      }

      let winner = null;
      let bestScore = -Infinity;
      for (const cand of candidates) {
        const score = tieBreakScore({ isOff: cand.state === 'OFF', consecutive: cand.streak });
        if (score > bestScore) { bestScore = score; winner = cand; }
      }

      // 5) 배정 반영
      if (winner) {
        // assignment upsert to winner
        await db.query(
          `INSERT INTO assignments (shift_id, driver_id, status, confirmed_at)
           VALUES ($1, $2, 'CONFIRMED', now())
           ON CONFLICT (shift_id) DO UPDATE
             SET driver_id = EXCLUDED.driver_id, status='CONFIRMED', confirmed_at=now()`,
          [tok.shift_id, winner.driver_id]
        );

        // 토큰 상태 업데이트
        await db.query(`UPDATE call_tokens SET status='LOST' WHERE call_id=$1 AND id<>$2 AND status='RESPONDED'`, [callId, winner.id]);
        await db.query(`UPDATE call_tokens SET status='WON' WHERE id=$1`, [winner.id]);

        // 호출 종료
        await db.query(`UPDATE calls SET state='CLOSED' WHERE id=$1`, [callId]);
      }

      await db.query('COMMIT');

      // 브로드캐스트(트랜잭션 밖)
      _bus?.broadcast?.({
        type: 'assignment_confirmed',
        call_id: callId,
        shift_id: tok.shift_id,
        route_id: tok.route_id,
        start_time: tok.start_time,
        end_time: tok.end_time,
        winner_driver_id: winner?.driver_id ?? null
      });
      _bus?.broadcast?.({
        type: 'call_closed',
        call_id: callId,
        shift_id: tok.shift_id
      });

      return reply.send({ ok: true, winner: winner?.driver_id ?? null });
    } catch (e) {
      await db.query('ROLLBACK');
      fastify.log.error(e, 'accept call error');
      return reply.code(500).send({ error: 'accept failed', detail: String(e?.message || e) });
    } finally {
      db.release();
    }
  });

  // 내 응답 취소 (응답했던 토큰을 다시 PENDING으로 되돌리는 정도)
  fastify.post('/calls/:callId/cancel', async (req, reply) => {
    const callId = Number(req.params.callId);
    const me = requireLogin(req, reply);
    if (!me) return;

    const db = await fastify.pg.pool.connect();
    try {
      const { rowCount } = await db.query(
        `UPDATE call_tokens SET status='PENDING'
           WHERE call_id=$1 AND driver_id=$2 AND status='RESPONDED'`,
        [callId, me]
      );
      if (!rowCount) return reply.code(404).send('취소할 응답이 없습니다');

      // 브로드캐스트
      const _bus = bus || fastify.bus;
      _bus?.broadcast?.({
        type: 'response_cancelled',
        call_id: callId,
        driver_id: me
      });

      return reply.send({ ok: true });
    } finally {
      db.release();
    }
  });
}
