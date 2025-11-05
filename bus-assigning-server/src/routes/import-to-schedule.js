// src/routes/import-to-schedule.js
import fp from 'fastify-plugin';
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import util from 'util';

const pump = util.promisify(pipeline);

// A/P 값 유지
const keepAP = (v) => {
  const s = String(v || '').trim();
  if (['A', 'P', 'a', 'p'].includes(s)) return s.toUpperCase();
  return '';
};

// 셀 색상 추출
function getCellColor(ws, addr) {
  const cell = ws[addr];
  if (cell && cell.s && cell.s.fgColor && cell.s.fgColor.rgb) {
    return '#' + cell.s.fgColor.rgb.slice(-6); // ARGB → RGB
  }
  return '';
}

// 기사명 감지 (한글 포함 여부)
function isHangulName(s) {
  return /[가-힣]/.test(s || '');
}

async function importToSchedule(fastify) {
  // 충돌 방지: 미리보기 전용 경로
  fastify.post('/import/excel-preview', async (req, reply) => {
    const parts = req.parts();
    let filePath;

    for await (const part of parts) {
      if (part.file) {
        filePath = path.join(process.cwd(), 'upload.xlsx');
        await pump(part.file, fs.createWriteStream(filePath));
      }
    }

    if (!filePath) {
      return reply.code(400).send({ error: 'file missing' });
    }

    const wb = xlsx.readFile(filePath, { cellStyles: true });
    const ws = wb.Sheets['배차총괄'] || wb.Sheets[Object.keys(wb.Sheets)[0]];
    if (!ws) {
      return reply.code(400).send({ error: '시트를 찾을 수 없습니다' });
    }

    // 첫 행에서 날짜 범위 추출
    const range = xlsx.utils.decode_range(ws['!ref']);
    const headerRow = range.s.r + 1; // 경험상 2행이 날짜인 시트가 많음
    const days = [];
    for (let c = range.s.c + 2; c <= range.e.c; c++) {
      const cellAddr = xlsx.utils.encode_cell({ r: headerRow, c });
      const cellVal = ws[cellAddr] ? ws[cellAddr].v : '';
      if (!cellVal) continue;
      days.push({ col: c, label: String(cellVal).trim() });
    }

    // 기사명 행 파싱
    const drivers = [];
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const nameCell = ws[xlsx.utils.encode_cell({ r, c: range.s.c })];
      const name = nameCell ? String(nameCell.v).trim() : '';
      if (!isHangulName(name)) continue;

      const rowDays = [];
      const rowColors = [];
      for (let i = 0; i < days.length; i++) {
        const col = days[i].col;
        const cellAddr = xlsx.utils.encode_cell({ r, c: col });
        const cellVal = ws[cellAddr] ? ws[cellAddr].v : '';
        const color = getCellColor(ws, cellAddr);
        rowDays[i] = keepAP(cellVal);
        rowColors[i] = color;
      }
      drivers.push({ name, days: rowDays, colors: rowColors });
    }

    // HTML 미리보기
    let html = `
      <html><head><meta charset="utf-8"><title>배차표 미리보기</title>
      <style>
        table { border-collapse: collapse; }
        td, th { border: 1px solid #999; padding: 4px; text-align: center; }
      </style></head><body>
      <h2>배차표 미리보기</h2>
      <table><thead><tr><th>기사명</th>`;

    for (const d of days) {
      html += `<th>${d.label}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const dr of drivers) {
      html += `<tr><td>${dr.name}</td>`;
      for (let i = 0; i < days.length; i++) {
        const val = dr.days[i] || '';
        const color = dr.colors[i] || '';
        html += `<td style="background:${color}">${val}</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table></body></html>`;

    reply.type('text/html').send(html);
  });
}

export default fp(importToSchedule);
