// src/routes/import-excel.js
import xlsx from 'xlsx';

/* ========= 유틸 ========= */
const pad2 = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const S = (v) => (v === null || v === undefined) ? '' : String(v);

/** "A/P" 정규화 */
function ap(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return (s === 'A' || s === 'P') ? s : '';
}

/** "HH:MM-HH:MM" → {start,end} */
function parseSpan(span) {
  const m = String(span || '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const sH = pad2(m[1]), sM = m[2], eH = pad2(m[3]), eM = m[4];
  return { start: `${sH}:${sM}`, end: `${eH}:${eM}` };
}

/** 엑셀 셀에서 day-of-month(1..31) 뽑기 */
function dayFromCell(cell) {
  if (!cell) return null;
  if (cell.t === 'd' && cell.v instanceof Date) {
    const d = cell.v.getDate();
    return (d >= 1 && d <= 31) ? d : null;
  }
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    if (Number.isInteger(cell.v) && cell.v >= 1 && cell.v <= 31) return cell.v;
    try {
      const p = xlsx.SSF.parse_date_code(cell.v);
      if (p && Number.isInteger(p.d) && p.d >= 1 && p.d <= 31) return p.d;
    } catch {}
  }
  if (typeof cell.v === 'string') {
    const only = cell.v.replace(/[^\d]/g, '').trim();
    const n = Number(only);
    if (Number.isInteger(n) && n >= 1 && n <= 31) return n;
  }
  return null;
}

function looksLikeKoreanName(v) {
  const s = S(v).trim();
  return /[가-힣]/.test(s) && s.length >= 2 && s.length <= 12;
}

/* ========= 워크시트 로딩 ========= */
function autoSelectSheetName(book) {
  return book.SheetNames.find(n => /배차|총괄|배정/i.test(n)) ?? book.SheetNames[0];
}

function loadSheetMatrixCells(ws) {
  const ref = ws['!ref'];
  if (!ref) return [];
  const r = xlsx.utils.decode_range(ref);
  const arr = [];
  for (let rr = r.s.r; rr <= r.e.r; rr++) {
    const row = [];
    for (let cc = r.s.c; cc <= r.e.c; cc++) {
      const addr = xlsx.utils.encode_cell({ r: rr, c: cc });
      row.push(ws[addr] || null);
    }
    arr.push(row);
  }
  const nonEmpty = (row) => row.some(c => c && S(c.v).trim() !== '');
  while (arr.length && !nonEmpty(arr[0])) arr.shift();
  while (arr.length && !nonEmpty(arr[arr.length - 1])) arr.pop();
  return arr;
}

/* ========= 구조 탐지 ========= */
function detectStructure(matrix) {
  if (!matrix.length) return { nameCol: -1, dayHeaderRow: -1, dayCols: [] };

  // 날짜 헤더
  let dayHeaderRow = -1, dayCols = [], best = -1;
  const scanRows = Math.min(matrix.length, 25);
  for (let r = 0; r < scanRows; r++) {
    const row = matrix[r] || [];
    const cols = [];
    let sc = 0;
    for (let c = 0; c < row.length; c++) {
      const d = dayFromCell(row[c]);
      if (d !== null) { sc++; cols.push(c); }
    }
    if (sc > best && sc >= 5) { best = sc; dayHeaderRow = r; dayCols = cols; }
  }

  // 이름 열
  let nameCol = -1, score = -1;
  const start = (dayHeaderRow >= 0 ? dayHeaderRow + 1 : 0);
  const end = Math.min(matrix.length, start + 40);
  const colCount = matrix.reduce((m, row) => Math.max(m, row.length), 0);
  for (let c = 0; c < colCount; c++) {
    let sc = 0;
    for (let r = start; r < end; r++) {
      const cell = matrix[r]?.[c];
      if (cell && looksLikeKoreanName(cell.v)) sc++;
    }
    if (sc > score) { score = sc; nameCol = c; }
  }

  if (dayHeaderRow >= 0 && nameCol >= 0) {
    dayCols = dayCols.filter(c => c > nameCol);
  }
  return { nameCol, dayHeaderRow, dayCols };
}

/* ========= 검증 리포트 ========= */
function makeKey({ date, route, start, end, driver }) {
  return `${date}|${route}|${start}|${end}|${driver}`;
}

function buildVerifyHTML(verify) {
  const { okCount, expectedCount, dbCount, missing, extras } = verify;
  const missRows = missing.slice(0, 20).map(k => `<li>${k}</li>`).join('');
  const extraRows = extras.slice(0, 20).map(k => `<li>${k}</li>`).join('');
  return `
  <div class="card" style="background:#fff;border-radius:8px;padding:16px;margin-top:16px">
    <h3>정합성 검증 결과</h3>
    <p><strong>엑셀 기준 예상 배정:</strong> ${expectedCount}건, <strong>DB 실제 배정:</strong> ${dbCount}건</p>
    <p><strong>정확 일치:</strong> ${okCount}건</p>
    <div style="display:flex; gap:24px; flex-wrap:wrap">
      <div style="flex:1; min-width:280px">
        <h4>엑셀에는 있는데 DB에 없는 항목 (상위 20)</h4>
        <ol>${missRows || '<li>없음</li>'}</ol>
      </div>
      <div style="flex:1; min-width:280px">
        <h4>DB에는 있는데 엑셀에 없는 항목 (상위 20)</h4>
        <ol>${extraRows || '<li>없음</li>'}</ol>
      </div>
    </div>
  </div>`;
}

/* ========= 미리보기 HTML ========= */
function buildPreviewHTML(preview, verifyHTML) {
  const { original, summary, grouped } = preview;

  const sample = original.sampleDrivers.map(d => `
    <div class="driver-row">
      <span class="driver-name">${d.name}</span>
      ${d.shifts.map(s => `<span class="shift-cell ${s.value === 'A' ? 'shift-A' : s.value === 'P' ? 'shift-P' : 'shift-rest'}">${s.value || '휴'}</span>`).join('')}
      <span style="margin-left: 10px; color: #666; font-size: 12px;">...</span>
    </div>
  `).join('');

  const groupedHTML = Object.keys(grouped).slice(0, 7).map(date => {
    const rows = grouped[date].map(r => `
      <tr>
        <td>${r.route_id}</td>
        <td>${r.start_time}~${r.end_time}</td>
        <td>${r.driver_name || '-'}</td>
        <td>${r.status}</td>
      </tr>`).join('');
    return `<h4>${date}</h4>
      <table><thead><tr><th>노선</th><th>시간</th><th>기사</th><th>상태</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:#666">데이터 없음</td></tr>'}</tbody></table>`;
  }).join('');

  return `
    <div class="preview-section">
      <div class="preview-title">업로드 미리보기</div>
      <div class="excel-preview">
        <h4>엑셀 샘플 (최대 5명, 7일)</h4>
        ${sample || '<p style="color:#666">샘플 없음</p>'}
      </div>
      <div style="margin-top:12px">
        <h4>DB 반영 결과 (일자별 일부)</h4>
        ${groupedHTML}
      </div>
      ${verifyHTML || ''}
      <div class="stats" style="margin-top:12px">
        <div class="stat-item"><strong>총 날짜:</strong> ${summary.totalDates}</div>
        <div class="stat-item"><strong>총 배정 건수:</strong> ${summary.totalAssignments}</div>
        <div class="stat-item"><strong>고유 기사 수:</strong> ${summary.uniqueDrivers}</div>
      </div>
    </div>
  `;
}

/* ========= 라우트 ========= */
export async function importExcelRoute(fastify) {
  // 업로드 폼
  fastify.get('/upload', async (_req, reply) => {
    const html = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>배차총괄 엑셀 업로드</title>
<style>
body { font-family: system-ui, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #f8f9fa; }
.form-group { margin: 15px 0; }
label { display: inline-block; width: 120px; font-weight: bold; }
input, select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
input[type="file"] { width: 300px; }
input[type="number"], input[type="text"] { width: 150px; }
button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
button:hover { background: #0056b3; }
.note { color: #666; font-size: 14px; margin-top: 10px; line-height: 1.5; }
.card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
</style>
</head>
<body>
  <div class="card">
    <h1>배차총괄 엑셀 업로드</h1>
    <form method="post" action="/import/excel" enctype="multipart/form-data">
      <div class="form-group">
        <label>엑셀 파일:</label>
        <input type="file" name="file" accept=".xlsx,.xls" required />
      </div>
      <div class="form-group">
        <label>년도:</label>
        <input type="number" name="year" value="${new Date().getFullYear()}" required />
      </div>
      <div class="form-group">
        <label>월:</label>
        <input type="number" name="month" value="${new Date().getMonth() + 1}" min="1" max="12" required />
      </div>
      <div class="form-group">
        <label>노선명:</label>
        <input type="text" name="route_id" value="기본" required />
      </div>
      <div class="form-group">
        <label>오전 시간:</label>
        <input type="text" name="am" value="06:00-13:00" placeholder="06:00-13:00" required />
      </div>
      <div class="form-group">
        <label>오후 시간:</label>
        <input type="text" name="pm" value="13:00-20:00" placeholder="13:00-20:00" required />
      </div>
      <div class="form-group">
        <button type="submit">업로드 및 처리</button>
      </div>
    </form>
    <div class="note">
      <p><strong>엑셀 형식(권장):</strong> A열=형태, B열=기사명, C..=01~31, 날짜 셀은 숫자/문자/엑셀-날짜 모두 허용</p>
      <p>값: A=오전, P=오후, 빈칸=휴무</p>
    </div>
  </div>
  <p style="text-align: center; margin-top: 20px;">
    <a href="/demo" style="color: #007bff; text-decoration: none;">← 데모 페이지로 돌아가기</a>
  </p>
</body></html>`;
    reply.type('text/html; charset=utf-8').send(html);
  });

  // 업로드 처리: DB 저장 + 미리보기 + 정합성 검증
  fastify.post('/import/excel', async (req, reply) => {
    try {
      // ---- multipart 수집 ----
      let buffer = null;
      let routeId = '기본';
      let year = new Date().getFullYear();
      let month = new Date().getMonth() + 1;
      let amRange = '06:00-13:00';
      let pmRange = '13:00-20:00';

      for await (const part of req.parts()) {
        if (part.file) {
          const chunks = [];
          for await (const chunk of part.file) chunks.push(chunk);
          buffer = Buffer.concat(chunks);
        } else {
          const k = part.fieldname, v = String(part.value ?? '');
          if (k === 'route_id') routeId = v || '기본';
          else if (k === 'year') year = Number(v) || year;
          else if (k === 'month') month = Number(v) || month;
          else if (k === 'am') amRange = v || amRange;
          else if (k === 'pm') pmRange = v || pmRange;
        }
      }
      if (!buffer) return reply.code(400).send({ error: '파일이 없습니다' });

      // ---- 엑셀 로드 ----
      const book = xlsx.read(buffer, {
        type: 'buffer',
        cellDates: true,
        cellNF: true,
        cellText: true
      });
      const sheetName = autoSelectSheetName(book);
      const ws = book.Sheets[sheetName];
      if (!ws) return reply.code(400).send({ error: '시트를 찾을 수 없습니다' });

      const matrix = loadSheetMatrixCells(ws);
      const { nameCol, dayHeaderRow, dayCols } = detectStructure(matrix);

      if (nameCol < 0) return reply.code(400).send({ error: '기사명 열을 찾지 못했습니다' });
      if (dayHeaderRow < 0 || !dayCols.length) return reply.code(400).send({ error: '날짜 헤더를 찾지 못했습니다' });

      const lastDay = new Date(year, month, 0).getDate();
      const am = parseSpan(amRange);
      const pm = parseSpan(pmRange);
      if (!am || !pm) return reply.code(400).send({ error: '시간 형식이 올바르지 않습니다(예: 06:00-13:00)' });

      // ---- DB 반영 ----
      const client = await fastify.pg.pool.connect();
      const stats = { drivers: 0, shifts: 0, assignments: 0 };
      let processedDrivers = 0;

      try {
        await client.query('BEGIN');

        for (let r = dayHeaderRow + 1; r < matrix.length; r++) {
          const row = matrix[r] || [];
          const name = S(row[nameCol]?.v).trim();
          if (!name) continue;
          processedDrivers++;

          const { rows: dr } = await client.query(
            `INSERT INTO drivers(name, active)
             VALUES ($1, true)
             ON CONFLICT (name) DO UPDATE SET active = true
             RETURNING id`,
            [name]
          );
          const driverId = dr[0].id;
          stats.drivers++;

          for (let i = 0; i < dayCols.length; i++) {
            const col = dayCols[i];
            const dCell = matrix[dayHeaderRow]?.[col];
            const dd = dayFromCell(dCell);
            if (!Number.isInteger(dd) || dd < 1 || dd > 31 || dd > lastDay) continue;

            const flag = ap(row[col]?.v);
            if (!flag) continue;

            const serviceDate = iso(year, month, dd);
            const span = (flag === 'A') ? am : pm;

            const { rows: sIns } = await client.query(
              `INSERT INTO shifts (service_date, route_id, start_time, end_time)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (service_date, route_id, start_time, end_time) DO NOTHING
               RETURNING id`,
              [serviceDate, routeId, `${span.start}:00`, `${span.end}:00`]
            );

            let shiftId;
            if (sIns.length) {
              shiftId = sIns[0].id;
              stats.shifts++;
            } else {
              const { rows: sSel } = await client.query(
                `SELECT id FROM shifts WHERE service_date=$1 AND route_id=$2 AND start_time=$3 AND end_time=$4`,
                [serviceDate, routeId, `${span.start}:00`, `${span.end}:00`]
              );
              shiftId = sSel[0]?.id;
            }
            if (!shiftId) continue;

            await client.query(
              `INSERT INTO assignments (shift_id, driver_id, status, confirmed_at)
               VALUES ($1, $2, 'CONFIRMED', now())
               ON CONFLICT (shift_id) DO UPDATE
                 SET driver_id = EXCLUDED.driver_id, status = 'CONFIRMED', confirmed_at = now()`,
              [shiftId, driverId]
            );
            stats.assignments++;
          }
        }

        await client.query('COMMIT');

        // ---- 미리보기 + 검증 ----
        const { rows: previewRows } = await client.query(
          `SELECT s.service_date::date as service_date, s.route_id, s.start_time, s.end_time,
                  d.name as driver_name, a.status
           FROM shifts s
           JOIN assignments a ON a.shift_id = s.id
           JOIN drivers d ON d.id = a.driver_id
           WHERE EXTRACT(YEAR FROM s.service_date) = $1 
             AND EXTRACT(MONTH FROM s.service_date) = $2
             AND s.route_id = $3
           ORDER BY s.service_date, s.start_time, d.name`,
          [year, month, routeId]
        );

        // DB 집합
        const dbSet = new Set(previewRows.map(r => makeKey({
          date: r.service_date.toISOString().slice(0,10),
          route: r.route_id, start: r.start_time, end: r.end_time, driver: r.driver_name
        })));

        // 엑셀 예상 집합
        const expectedSet = new Set();
        for (let r = dayHeaderRow + 1; r < matrix.length; r++) {
          const row = matrix[r] || [];
          const driver = S(row[nameCol]?.v).trim();
          if (!driver) continue;
          for (let i = 0; i < dayCols.length; i++) {
            const col = dayCols[i];
            const dCell = matrix[dayHeaderRow]?.[col];
            const dd = dayFromCell(dCell);
            if (!Number.isInteger(dd) || dd < 1 || dd > 31 || dd > lastDay) continue;
            const flag = ap(row[col]?.v);
            if (!flag) continue;
            const serviceDate = iso(year, month, dd);
            const span = (flag === 'A') ? am : pm;
            expectedSet.add(makeKey({
              date: serviceDate, route: routeId,
              start: `${span.start}:00`, end: `${span.end}:00`,
              driver
            }));
          }
        }

        // 비교
        let okCount = 0;
        const missing = []; // in Excel but not in DB
        const extras = [];  // in DB but not in Excel

        expectedSet.forEach(k => { if (dbSet.has(k)) okCount++; else missing.push(k); });
        dbSet.forEach(k => { if (!expectedSet.has(k)) extras.push(k); });

        const verify = {
          okCount, expectedCount: expectedSet.size, dbCount: dbSet.size, missing, extras
        };
        const verifyHTML = buildVerifyHTML(verify);

        // 그룹 처리
        const grouped = {};
        for (const r of previewRows) {
          const key = r.service_date.toISOString().slice(0, 10);
          (grouped[key] = grouped[key] || []).push(r);
        }

        // 원본 샘플
        const original = {
          totalRows: Math.max(0, matrix.length - (dayHeaderRow + 1)),
          dayColumns: dayCols.length,
          sampleDrivers: []
        };
        for (let r = dayHeaderRow + 1; r < Math.min(matrix.length, dayHeaderRow + 6); r++) {
          const nm = S(matrix[r]?.[nameCol]?.v).trim();
          if (!nm) continue;
          const shifts = [];
          for (let i = 0; i < Math.min(dayCols.length, 7); i++) {
            const col = dayCols[i];
            shifts.push({ day: i + 1, value: ap(matrix[r][col]?.v) });
          }
          original.sampleDrivers.push({ name: nm, shifts });
        }

        const preview = {
          grouped,
          original,
          summary: {
            totalDates: Object.keys(grouped).length,
            totalAssignments: previewRows.length,
            uniqueDrivers: new Set(previewRows.map(r => r.driver_name)).size
          }
        };

        // ---- 응답 HTML ----
        const html = `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>업로드 완료</title>
<style>
body{font-family:system-ui,sans-serif;padding:20px;background:#f8f9fa}
.container{max-width:900px;margin:20px auto}
.success-box{background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:30px;margin-bottom:20px;text-align:center}
.success-icon{font-size:48px;color:#155724;margin-bottom:15px}
.success-title{color:#155724;font-size:24px;font-weight:700;margin-bottom:10px}
.stats{ text-align:left;background:#fff;border-radius:6px;padding:15px;margin:15px 0 }
.stat-item{ margin:6px 0;padding:4px;background:#f8f9fa;border-radius:4px }
.preview-section{ background:#fff;border-radius:8px;padding:20px;margin:20px 0 }
.preview-title{ font-size:18px;font-weight:700;margin-bottom:12px;color:#495057 }
.btn{display:inline-block;padding:12px 24px;background:#007bff;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin:5px}
.btn:hover{background:#0056b3}
.btn-success{background:#28a745}.btn-info{background:#17a2b8}
.shift-cell{display:inline-block;width:24px;height:24px;margin:2px;text-align:center;line-height:24px;border-radius:4px;font-size:12px;font-weight:700}
.shift-A{background:#d4edda;color:#155724}.shift-P{background:#cce5ff;color:#0056b3}.shift-rest{background:#e9ecef;color:#6c757d}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}
th,td{padding:8px;text-align:left;border-bottom:1px solid #dee2e6}th{background:#f8f9fa;font-weight:600}
.countdown{color:#666;font-size:14px;margin-top:15px}
</style></head><body>
<div class="container">
  <div class="success-box">
    <div class="success-icon">✅</div>
    <div class="success-title">업로드 완료!</div>
    <div class="stats">
      <div class="stat-item"><strong>시트:</strong> ${sheetName}</div>
      <div class="stat-item"><strong>년월/노선:</strong> ${year}-${pad2(month)} / ${routeId}</div>
      <div class="stat-item"><strong>처리된 기사(행 기준):</strong> ${processedDrivers}</div>
      <div class="stat-item"><strong>등록/업데이트된 기사:</strong> ${stats.drivers}</div>
      <div class="stat-item"><strong>생성된 시프트:</strong> ${stats.shifts}</div>
      <div class="stat-item"><strong>생성된 배정:</strong> ${stats.assignments}</div>
    </div>
    <div>
      <a href="/demo?date=${year}-${pad2(month)}-01" class="btn btn-success">해당 월 배차 보기</a>
      <a href="/demo" class="btn btn-info">오늘 배차 보기</a>
      <a href="/upload" class="btn">다른 파일 업로드</a>
      <a href="/demo/data-overview" class="btn" style="background:#6c757d">전체 현황</a>
    </div>
    <div class="countdown">3초 후 데모 페이지로 이동합니다...</div>
  </div>
  ${buildPreviewHTML(preview, buildVerifyHTML(verify))}
</div>
<script>
  setTimeout(()=>{ location.href = '/demo?date=${year}-${pad2(month)}-01'; }, 3000);
</script>
</body></html>`;
        return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
      } catch (e) {
        await fastify.pg.pool.query('ROLLBACK').catch(()=>{});
        fastify.log.error(e, 'excel import error');
        return reply.code(500).send({ error: 'import failed', detail: String(e?.message || e) });
      } finally {
        try { await fastify.pg.pool.query('COMMIT'); } catch {}
      }
    } catch (e) {
      fastify.log.error(e);
      return reply.code(500).send({ error: 'unexpected', detail: String(e?.message || e) });
    }
  });
}
