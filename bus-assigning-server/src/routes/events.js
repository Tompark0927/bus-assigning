// src/routes/events.js
// SSE 라우트: Fastify v4, 이중 응답/헤더 재전송 방지 버전

/**
 * 사용법:
 * - server.js 에서 createEventBus(fastify)로 만든 fastify.bus 를 사용
 * - bus.addClient(res) 는 res.write(`data: ...\n\n`) 형태로 SSE 전송
 * - 이 라우트는 reply.send() 를 절대 호출하지 않음 (중요)
 */

export async function eventRoutes(fastify, opts = {}) {
  const bus = fastify.bus || opts.bus;

  fastify.get('/events', async (request, reply) => {
    // 버스가 없으면 503 반환 (이 경우에도 send는 단 한 번만)
    if (!bus || typeof bus.addClient !== 'function') {
      reply.code(503).send({ error: 'event bus not available' });
      return;
    }

    // SSE 헤더 설정 (헤더는 단 한 번만 씀)
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    // CORS 필요시 여기에 Access-Control-Allow-Origin 추가

    // 첫 더미 라인(주석)으로 스트림 오픈 알림
    try {
      reply.raw.write(': connected\n\n');
    } catch (e) {
      // 소켓이 이미 닫혀 있으면 조용히 종료
      try { reply.raw.end(); } catch {}
      return;
    }

    // Fastify 응답 라이프사이클에서 벗어나기 (이후 reply.send 금지)
    reply.hijack();

    // 클라이언트 등록: bus가 res.close 이벤트를 듣고 정리
    try {
      bus.addClient(reply.raw);
    } catch (e) {
      // 등록 실패 시 스트림 종료 (헤더는 이미 전송된 상태이므로 raw로만 종료)
      try { reply.raw.end(); } catch {}
      return;
    }
  });
}

// default export도 제공(서버의 유연 로더가 어느 쪽이든 인식)
export default eventRoutes;
