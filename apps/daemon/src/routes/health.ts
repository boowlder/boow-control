import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    name: 'boow-daemon',
    version: '0.1.0',
    ts: Date.now(),
  }));
}
