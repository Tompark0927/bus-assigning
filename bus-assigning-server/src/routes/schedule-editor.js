// src/routes/schedule-editor.js
export async function scheduleEditorRoutes(fastify) {  // Add 'async' here
  const pad2 = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

  // GET /schedule : 편집 화면
  fastify.get('/schedule', async (req, reply) => {
    const now = new Date();
    const year = Number(req.query.year || now.getFullYear());
    const month = Number(req.query.month || (now.getMonth() + 1));
    const am = String(req.query.am || '06:00-13:00');
    const pm = String(req.query.pm || '13:00-20:00');
    const routeId = String(req.query.route || '기본');

    const last = new Date(year, month, 0).getDate();

    // 드라이버 목록 불러오기(없어도 화면은 뜸)
    let drivers = [];
    try {
      const { rows } = await fastify.pg.pool.query(
        `SELECT name FROM drivers WHERE active IS DISTINCT FROM false ORDER BY name`
      );
      drivers = rows.map((r) => r.name);
    } catch {
      drivers = [];
    }

    // 헤더 HTML
    let daysHead = '';
    for (let d = 1; d <= last; d += 1) {
      daysHead += `<th class="sticky">${d}</th>`;
    }

    // 바디(행) HTML
    const buildRow = (name) => {
      let cells = '';
      for (let d = 1; d <= last; d += 1) {
        cells += (
          `<td>` +
          `<select>` +
          `<option value=""></option>` +
          `<option value="A">A</option>` +
          `<option value="P">P</option>` +
          `</select>` +
          `</td>`
        );
      }
      return (
        `<tr>` +
        `<td class="name"><input value="${name || ''}" placeholder="이름" style="width:150px"></td>` +
        cells +
        `</tr>`
      );
    };

    let bodyHtml = '';
    if (drivers.length === 0) {
      bodyHtml = buildRow('');
    } else {
      for (const nm of drivers) bodyHtml += buildRow(nm);
    }

    const html =
      '<!doctype html>' +
      '<meta charset="utf-8">' +
      `<style>
        body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; padding:16px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 6px; text-align: center; }
        th.sticky { position: sticky; top: 0; background: #f7f7f7; z-index: 2; }
        td.name { text-align: left; min-width: 160px; }
        select { padding: 2px 4px; }
        .toolbar { display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
        .btn { padding:6px 10px; border:1px solid #888; background:#fff; cursor:pointer; }
        .btn:hover { background:#f0f0f0; }
        .note { color:#666; font-size:12px; }
      </style>` +
      `<h2>배차 편집 (엑셀형)</h2>` +
      `<form id="frm" class="toolbar">
        <label>연: <input type="number" name="year" value="${year}" style="width:90px"></label>
        <label>월: <input type="number" name="month" value="${month}" style="width:70px"></label>
        <label>노선: <input name="route_id" value="${routeId}" style="width:140px"></label>
        <label>오전: <input name="am" value="${am}" style="width:110px" placeholder="06:00-13:00"></label>
        <label>오후: <input name="pm" value="${pm}" style="width:110px" placeholder="13:00-20:00"></label>
        <button type="button" class="btn" id="btn-set-month">해당 연/월로 표 만들기</button>
        <button type="button" class="btn" id="btn-add-row">기사 행 추가</button>
        <button type="button" class="btn" id="btn-save">저장</button>
        <span class="note">셀 값: A=오전, P=오후, 빈칸=휴무</span>
      </form>` +
      `<table id="grid">
        <thead>
          <tr>
            <th class="sticky">기사명</th>
            ${daysHead}
          </tr>
        </thead>
        <tbody id="tbody">
          ${bodyHtml}
        </tbody>
      </table>` +
      `<script>
        const tbody = document.getElementById('tbody');

        document.getElementById('btn-add-row').onclick = () => {
          const tr = document.createElement('tr');
          const nameTd = document.createElement('td');
          nameTd.className = 'name';
          nameTd.innerHTML = '<input placeholder="이름" style="width:150px">';
          tr.appendChild(nameTd);

          const last = ${last};
          for (let i = 0; i < last; i++) {
            const td = document.createElement('td');
            td.innerHTML = '<select><option value=""></option><option value="A">A</option><option value="P">P</option></select>';
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        };

        document.getElementById('btn-set-month').onclick = () => {
          const f = document.getElementById('frm');
          const y = f.year.value;
          const m = f.month.value;
          const am = f.am.value;
          const pm = f.pm.value;
          const r = f.route_id.value;
          const qs = new URLSearchParams({year: y, month: m, am: am, pm: pm, route: r}).toString();
          location.href = '/schedule?' + qs;
        };

        document.getElementById('btn-save').onclick = async () => {
          const f = document.getElementById('frm');
          const year = Number(f.year.value);
          const month = Number(f.month.value);
          const route_id = f.route_id.value || '기본';
          const am = f.am.value || '06:00-13:00';
          const pm = f.pm.value || '13:00-20:00';

          const rows = [];
          for (const tr of tbody.querySelectorAll('tr')) {
            const name = tr.querySelector('td.name input').value.trim();
            if (!name) continue;
            const days = [];
            const selects = tr.querySelectorAll('td select');
            for (let i = 0; i < selects.length; i++) {
              const v = (selects[i].value || '').trim().toUpperCase(); // '', 'A', 'P'
              days.push(v);
            }
            rows.push({ name, days });
          }

          const payload = { year, month, route_id, am, pm, rows };
          const res = await fetch('/schedule/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const js = await res.json();
          if (res.ok) {
            alert('저장 성공: shifts=' + js.stats.shiftCreates + ', assignments=' + js.stats.importedAssign);
            location.href = '/demo?date=' + year + '-' + String(month).padStart(2, '0') + '-01';
          } else {
            alert('저장 실패: ' + JSON.stringify(js));
            console.error(js);
          }
        };
      </script>`;

    reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // POST /schedule/save : 저장
  fastify.post('/schedule/save', async (req, reply) => {
    const { year, month, route_id, am, pm, rows } = req.body || {};
    if (!year || !month || !Array.isArray(rows)) {
      return reply.code(400).send({ error: 'bad payload' });
    }

    const parseSpan = (s) => {
      const m = String(s || '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const sH = String(m[1]).padStart(2, '0');
      const sM = m[2];
      const eH = String(m[3]).padStart(2, '0');
      const eM = m[4];
      return { start: `${sH}:${sM}`, end: `${eH}:${eM}` };
    };

    const amSpan = parseSpan(am);
    const pmSpan = parseSpan(pm);
    if (!amSpan || !pmSpan) {
      return reply.code(400).send({ error: 'bad time span' });
    }

    const last = new Date(year, month, 0).getDate();
    const stat = { driverUpserts: 0, shiftCreates: 0, importedAssign: 0 };

    const db = await fastify.pg.pool.connect();
    try {
      await db.query('BEGIN');

      for (const r of rows) {
        const name = String(r.name || '').trim();
        if (!name) continue;

        // driver upsert (name 기준)
        const { rows: dr } = await db.query(
          `INSERT INTO drivers(name, active)
           VALUES ($1, true)
           ON CONFLICT (name) DO UPDATE SET active=true
           RETURNING id`,
          [name]
        );
        const driverId = dr[0].id;
        stat.driverUpserts++;

        for (let i = 0; i < Math.min(r.days.length, last); i++) {
          const day = i + 1;
          const v = (r.days[i] || '').toUpperCase();
          if (!v) continue;
          const span = v === 'A' ? amSpan : v === 'P' ? pmSpan : null;
          if (!span) continue;

          const serviceDate = iso(year, month, day);
          const { rows: sIns } = await db.query(
            `INSERT INTO shifts(service_date, route_id, start_time, end_time)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (service_date, route_id, start_time, end_time) DO NOTHING
             RETURNING id`,
            [serviceDate, route_id || '기본', `${span.start}:00`, `${span.end}:00`]
          );
          let shiftId;
          if (sIns.length) {
            shiftId = sIns[0].id;
            stat.shiftCreates++;
          } else {
            const { rows: sSel } = await db.query(
              `SELECT id FROM shifts WHERE service_date=$1 AND route_id=$2 AND start_time=$3 AND end_time=$4`,
              [serviceDate, route_id || '기본', `${span.start}:00`, `${span.end}:00`]
            );
            shiftId = sSel[0]?.id;
          }
          if (!shiftId) continue;

          await db.query(
            `INSERT INTO assignments(shift_id, driver_id, status, confirmed_at)
             VALUES ($1,$2,'CONFIRMED', now())
             ON CONFLICT (shift_id) DO UPDATE
               SET driver_id=EXCLUDED.driver_id, status='CONFIRMED', confirmed_at=now()`,
            [shiftId, driverId]
          );
          stat.importedAssign++;
        }
      }

      await db.query('COMMIT');
      return reply.send({ ok: true, stats: stat });
    } catch (e) {
      await db.query('ROLLBACK');
      fastify.log.error(e, 'schedule save error');
      return reply.code(500).send({ error: 'save failed', detail: String(e?.message || e) });
    } finally {
      db.release();
    }
  });
}