// src/routes/demo.js
function toISODateOrNull(x) {
  // 허용: 'YYYY-MM-DD' | JS Date 문자열 | epoch(ms) | 'CURRENT_DATE'
  if (!x || x === 'CURRENT_DATE') return null;
  const s = String(x);

  // 이미 ISO(YYYY-MM-DD)면 그대로
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // epoch number?
  if (/^\d{10,13}$/.test(s)) {
    const d = new Date(Number(s.length === 13 ? Number(s) : Number(s) * 1000));
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }

  // 일반 문자열 → Date 파싱 시도
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);

  return null;
}

export  async function demoRoute(fastify) {
  // 데모 메인 페이지
  fastify.get('/demo', async (request, reply) => {
    const db = await fastify.pg.pool.connect();
    try {
      // 날짜 파라미터 처리(견고하게)
      const isoDate = toISODateOrNull(request.query.date);
      const targetDate = isoDate || new Date().toISOString().slice(0, 10);
      const displayDate = isoDate ? targetDate : '오늘';
      const isToday = !isoDate;

      fastify.log.info(`Demo page requested for date: ${isoDate || new Date()}`);

      // 기사 목록
      const { rows: drivers } = await db.query(
        `SELECT id, name, phone, active, fcm_token IS NOT NULL as has_device
         FROM drivers WHERE active = true ORDER BY name`
      );

      // 해당 날짜의 모든 시프트 조회(ISO만 사용)
      const { rows: shifts } = await db.query(
        `SELECT s.id, s.service_date, s.route_id, s.start_time, s.end_time,
                a.id as assignment_id, a.driver_id, a.status as assignment_status,
                d.name as driver_name,
                c.id as call_id, c.state as call_state, c.expires_at
         FROM shifts s
         LEFT JOIN assignments a ON a.shift_id = s.id
         LEFT JOIN drivers d ON d.id = a.driver_id
         LEFT JOIN calls c ON c.shift_id = s.id AND c.state = 'OPEN'
         WHERE s.service_date = $1::date
         ORDER BY s.start_time, s.route_id`,
        [targetDate]
      );

      if (shifts.length === 0) {
        const { rows: availableDates } = await db.query(`
          SELECT DISTINCT service_date, COUNT(*) as shift_count
          FROM shifts 
          WHERE service_date >= CURRENT_DATE - INTERVAL '7 days'
            AND service_date <= CURRENT_DATE + INTERVAL '7 days'
          GROUP BY service_date ORDER BY service_date DESC LIMIT 5
        `);

        if (availableDates.length > 0) {
          const dateLinks = availableDates.map(d => 
            `<a href="/demo?date=${d.service_date}" style="margin: 5px; padding: 8px 12px; background: #17a2b8; color: white; text-decoration: none; border-radius: 4px;">
              ${d.service_date} (${d.shift_count}건)
            </a>`
          ).join(' ');

          const noDataHTML = `<!DOCTYPE html><html lang="ko">
          <head><meta charset="UTF-8"><title>버스 배차 시스템</title>
          <style>body{font-family:system-ui,sans-serif;padding:20px;background:#f8f9fa}.container{max-width:800px;margin:0 auto}.card{background:white;padding:30px;border-radius:8px;text-align:center;box-shadow:0 2px 4px rgba(0,0,0,0.1)}.btn{display:inline-block;padding:10px 20px;margin:5px;background:#007bff;color:white;text-decoration:none;border-radius:4px}</style></head>
          <body><div class="container"><div class="card">
          <h1>버스 배차 시스템</h1><h3>${displayDate} (${targetDate}) 운행 데이터가 없습니다</h3>
          <p>다음 날짜에 데이터가 있습니다:</p><div style="margin:20px 0">${dateLinks}</div>
          <p>새로운 배차 데이터를 입력하세요:</p>
          <a href="/schedule" class="btn">배차 직접 편집</a>
          <a href="/upload" class="btn" style="background:#28a745">엑셀 파일 업로드</a>
          <a href="/demo/data-overview" class="btn" style="background:#6c757d">전체 데이터 현황</a>
          </div></div></body></html>`;
          
          return reply.header('Content-Type', 'text/html; charset=utf-8').send(noDataHTML);
        }
      }

      // 시프트별 상태 분석
      const shiftStats = {
        total: shifts.length,
        confirmed: shifts.filter(s => s.assignment_status === 'CONFIRMED').length,
        planned: shifts.filter(s => s.assignment_status === 'PLANNED').length,
        openCalls: shifts.filter(s => s.call_state === 'OPEN').length
      };

      const createShiftRow = (shift) => {
        const callBadge = shift.call_id ? `<span style="color:#dc3545">OPEN</span>` : '-';
        const statusLabel = shift.assignment_status || '-';
        const who = shift.driver_name || '-';
        const actions = shift.assignment_id
          ? `<form method="post" action="/assignments/${shift.assignment_id}/cancel" style="display:inline"><button>호출 열기</button></form>`
          : '-';
        return `<tr>
          <td>#${shift.id}</td>
          <td>${shift.service_date}</td>
          <td>${shift.route_id}</td>
          <td>${shift.start_time}~${shift.end_time}</td>
          <td>${who}</td>
          <td>${statusLabel}</td>
          <td>${callBadge}</td>
          <td>${actions}</td>
        </tr>`;
      };

      const shiftsHTML = shifts.length ? 
        shifts.map(shift => createShiftRow(shift)).join('') :
        '<tr><td colspan="8" style="text-align:center;color:#666;">해당 날짜에 운행이 없습니다.</td></tr>';

      const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"/>
      <title>버스 배차 시스템 - ${displayDate}</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css">
      <style>
        body{font-family:system-ui,sans-serif;padding:20px;background:#f8f9fa}
        .container{max-width:1000px;margin:0 auto}
        table{width:100%;border-collapse:collapse;margin-top:10px}
        th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}
        th{background:#f8f9fa}
      </style></head><body>
      <div class="container">
        <h1>버스 배차 시스템 - ${displayDate} (${isToday ? '오늘' : targetDate})</h1>
        <div>총 ${shiftStats.total}건 | 확정 ${shiftStats.confirmed}건 | 대기 ${shiftStats.planned}건 | 호출 ${shiftStats.openCalls}건</div>
        <table><thead><tr><th>시프트</th><th>날짜</th><th>노선</th><th>시간</th><th>배정 기사</th><th>상태</th><th>호출</th><th>액션</th></tr></thead>
        <tbody>${shiftsHTML}</tbody></table>
        <p><a href="/demo/data-overview">전체 데이터 현황 보기</a> | <a href="/upload">엑셀 업로드</a></p>
      </div></body></html>`;

      return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
    } finally {
      db.release();
    }
  });

  // 데이터 현황 페이지(기존과 동일)
  fastify.get('/demo/data-overview', async (_request, reply) => {
    const db = await fastify.pg.pool.connect();
    try {
      const { rows: stats } = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM drivers WHERE active = true) as active_drivers,
          (SELECT COUNT(*) FROM shifts) as total_shifts,
          (SELECT COUNT(*) FROM assignments WHERE status = 'CONFIRMED') as confirmed_assignments,
          (SELECT COUNT(DISTINCT service_date) FROM shifts) as total_days,
          (SELECT MIN(service_date) FROM shifts) as earliest_date,
          (SELECT MAX(service_date) FROM shifts) as latest_date
      `);

      const { rows: dailyStats } = await db.query(`
        SELECT 
          service_date,
          COUNT(*) as shift_count,
          COUNT(CASE WHEN a.status = 'CONFIRMED' THEN 1 END) as confirmed_count,
          COUNT(CASE WHEN a.status = 'PLANNED' THEN 1 END) as planned_count,
          COUNT(CASE WHEN c.state = 'OPEN' THEN 1 END) as open_calls
        FROM shifts s
        LEFT JOIN assignments a ON a.shift_id = s.id
        LEFT JOIN calls c ON c.shift_id = s.id AND c.state = 'OPEN'
        WHERE s.service_date >= CURRENT_DATE - INTERVAL '14 days'
          AND s.service_date <= CURRENT_DATE + INTERVAL '14 days'
        GROUP BY service_date ORDER BY service_date DESC
      `);

      const { rows: routeStats } = await db.query(`
        SELECT route_id, COUNT(*) as total_shifts, COUNT(DISTINCT service_date) as active_days
        FROM shifts GROUP BY route_id ORDER BY total_shifts DESC
      `);

      const stat = stats[0];
      
      const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
      <title>데이터 현황 - 버스 배차 시스템</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:20px;background:#f8f9fa}
        .container{max-width:1200px;margin:0 auto}
        .card{background:white;border-radius:8px;padding:20px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
        .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px}
        .stat-item{background:#f8f9fa;padding:15px;border-radius:6px;text-align:center}
        .stat-number{font-size:24px;font-weight:bold;color:#007bff}
        .stat-label{font-size:14px;color:#666;margin-top:5px}
        table{width:100%;border-collapse:collapse;margin-top:15px}
        th,td{padding:10px;text-align:left;border-bottom:1px solid #eee}
        th{background:#f8f9fa;font-weight:600}
        .btn{display:inline-block;padding:8px 16px;background:#007bff;color:white;text-decoration:none;border-radius:4px}
        .date-link{color:#007bff;text-decoration:none}
        .date-link:hover{text-decoration:underline}
      </style></head><body>
      <div class="container">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h1>데이터 현황</h1>
          <div><a href="/demo" class="btn">데모 페이지</a> <a href="/upload" class="btn" style="background:#28a745">엑셀 업로드</a></div>
        </div>

        <div class="card">
          <h3>전체 통계</h3>
          <div class="stats-grid">
            <div class="stat-item"><div class="stat-number">${stat.active_drivers}</div><div class="stat-label">활성 기사</div></div>
            <div class="stat-item"><div class="stat-number">${stat.total_shifts}</div><div class="stat-label">총 시프트</div></div>
            <div class="stat-item"><div class="stat-number">${stat.confirmed_assignments}</div><div class="stat-label">확정 배정</div></div>
            <div class="stat-item"><div class="stat-number">${stat.total_days}</div><div class="stat-label">운행 일수</div></div>
          </div>
          <p style="margin-top:15px;color:#666;text-align:center">데이터 기간: ${stat.earliest_date} ~ ${stat.latest_date}</p>
        </div>

        <div class="card">
          <h3>최근 2주간 일별 현황</h3>
          <table><thead><tr><th>날짜</th><th>총 시프트</th><th>확정 배정</th><th>대기 배정</th><th>긴급 호출</th><th>액션</th></tr></thead>
          <tbody>${dailyStats.map(day => `
            <tr>
              <td><a href="/demo?date=${day.service_date}" class="date-link">${day.service_date}</a></td>
              <td>${day.shift_count}</td>
              <td style="color:#28a745">${day.confirmed_count}</td>
              <td style="color:#ffc107">${day.planned_count}</td>
              <td style="color:#dc3545">${day.open_calls}</td>
              <td><a href="/demo?date=${day.service_date}" class="btn" style="padding:4px 8px;font-size:12px">보기</a></td>
            </tr>`).join('')}
          </tbody></table>
        </div>

        <div class="card">
          <h3>노선별 시프트 수</h3>
          <table><thead><tr><th>노선</th><th>총 시프트</th><th>운행 일수</th></tr></thead>
          <tbody>
            ${routeStats.map(r => `<tr><td>${r.route_id}</td><td>${r.total_shifts}</td><td>${r.active_days}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div></body></html>`;

      return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
    } finally {
      db.release();
    }
  });
}
