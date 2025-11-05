// bus-assigning-server/server.js
import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyPostgres from '@fastify/postgres';
import fastifyStatic from '@fastify/static';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ❌ (삭제) import authRoutes from './routes/auth.js';
// ❌ (삭제) import driverRoutes from './routes/driver.js';
// ❌ (삭제) import adminRoutes from './routes/admin.js';

import { createEventBus } from './src/lib/events.js';
import { callSchedulerRoutes, startCallScheduler } from './src/utils/call-scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/busapp';

console.log('DB URL in server:', DATABASE_URL.replace(/:[^@]+@/, ':***@'));

// ── Fastify ──
const fastify = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } },
    level: process.env.LOG_LEVEL || 'info',
  },
  disableRequestLogging: false,
});

// reply.double-send 가드
fastify.addHook('onRequest', async (req, reply) => {
  const orig = reply.send.bind(reply);
  reply.send = (payload) => {
    if (reply.sent) {
      req.log.warn({ tag: 'DOUBLE_SEND', method: req.method, url: req.url }, 'double send prevented');
      return reply;
    }
    return orig(payload);
  };
});

// 공통 에러핸들러
fastify.setErrorHandler((err, req, reply) => {
  if (!reply.sent) {
    req.log.error({ err }, 'unhandled error');
    reply.code(err.statusCode || 500).send({ error: 'internal', message: err.message });
  } else {
    req.log.error({ err }, 'error after reply sent (ignored)');
  }
});

// ── 플러그인 등록 ──
await fastify.register(fastifyCookie);
await fastify.register(fastifyMultipart, {
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10MB
});
await fastify.register(fastifyPostgres, { connectionString: DATABASE_URL });

// static: public 폴더가 있을 때만 /admin/* 경로로 노출
const publicRoot = path.join(process.cwd(), 'public');
if (fs.existsSync(publicRoot)) {
  await fastify.register(fastifyStatic, {
    root: publicRoot,
    prefix: '/admin/',       // /admin/ 경로로 정적서빙
    decorateReply: true,     // reply.sendFile 사용
  });
} else {
  fastify.log.warn(`"root" path "${publicRoot}" not found (static disabled)`);
}

// ✅ 관리자 패널 HTML (public/admin-panel.html이 존재해야 함)
fastify.get('/admin', (req, reply) => {
  if (typeof reply.sendFile !== 'function') {
    return reply.type('text/plain').send('Static plugin not enabled');
  }
  return reply.sendFile('admin-panel.html');
});

// ── 이벤트 버스/데코레이트 ──
const bus = createEventBus(fastify);
fastify.decorate('bus', bus);

// ── 헬스체크 ──
fastify.get('/health', async () => ({ ok: true }));

// ── 스케줄러 라우트 먼저 등록 ──
try {
  await fastify.register(callSchedulerRoutes);
  fastify.log.info('callSchedulerRoutes registered successfully');
} catch (err) {
  fastify.log.error({ err }, 'Failed to register callSchedulerRoutes');
}

// ── 동적 라우트 로더 (src/routes/*.js) ──
async function safeRegisterRoute(relPath, baseOpts = {}, nameHints = []) {
  const abs = new URL(relPath, import.meta.url);
  const routePath = abs.href;
  try {
    const mod = await import(routePath);
    const fn =
      (mod && typeof mod.default === 'function' && mod.default) ||
      nameHints.map((k) => mod?.[k]).find((f) => typeof f === 'function') ||
      (typeof mod === 'function' ? mod : null);

    if (!fn) {
      fastify.log.warn({ routePath, exports: Object.keys(mod || {}) }, 'no compatible export to register (skipped)');
      return;
    }
    await fastify.register(fn, baseOpts);
    fastify.log.info({ routePath }, 'route registered');
  } catch (err) {
    fastify.log.warn({ routePath, err: String(err?.message || err) }, 'route load failed (skipped)');
  }
}

// ── 실제 라우트들 등록 (src 하위만 사용) ──
await safeRegisterRoute('./src/routes/presence.js', { prefix: '/presence' }, ['presenceRoutes','presenceRoute']);
await safeRegisterRoute('./src/routes/admin.js', {}, ['adminRoutes']);
await safeRegisterRoute('./src/routes/driver.js', {}, ['driverRoutes']);
await safeRegisterRoute('./src/routes/accept-call.js', {}, ['acceptCallRoute','acceptCallRoutes']);
await safeRegisterRoute('./src/routes/cancel-assignment.js', {}, ['cancelAssignmentRoute','cancelAssignmentRoutes']);
await safeRegisterRoute('./src/routes/auth.js', { prefix: '/auth' }, ['authRoutes']);
await safeRegisterRoute('./src/routes/import-excel.js', {}, ['importExcelRoute','importExcelRoutes']);
await safeRegisterRoute('./src/routes/import-to-schedule.js', {}, ['importToScheduleRoutes']);
await safeRegisterRoute('./src/routes/schedule-editor.js', {}, ['scheduleEditorRoutes']);
await safeRegisterRoute('./src/routes/demo.js', {}, ['demoRoute','demoRoutes']);
await safeRegisterRoute('./src/routes/register-device.js', {}, ['registerDeviceRoute','registerDeviceRoutes']);
await safeRegisterRoute('./src/routes/events.js', {}, ['eventRoutes','eventsApiRoutes']);

// 라우트 프린트 & 리슨
fastify.get('/__debug/routes', async () => fastify.printRoutes());
await fastify.ready();
console.log(fastify.printRoutes());

await fastify.listen({ port: PORT, host: HOST });
fastify.log.info(`Server started successfully on http://${HOST}:${PORT}`);

// ✅ 타이머/주기작업은 listen 이후 시작
startCallScheduler(fastify);

// 종료 핸들러
async function close() {
  try {
    fastify.log.info('Shutting down gracefully...');
    bus?.stop?.();
    await fastify.close();
    process.exit(0);
  } catch (e) {
    fastify.log.error(e, 'Error during shutdown');
    process.exit(1);
  }
}
process.on('SIGINT', close);
process.on('SIGTERM', close);

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
