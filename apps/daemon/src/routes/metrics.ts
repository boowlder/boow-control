import type { FastifyInstance } from 'fastify';
import os from 'node:os';

/** Télémétrie système de la machine hôte du daemon (CPU / RAM / uptime). */
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/metrics', async () => {
    const load = os.loadavg();
    const total = os.totalmem();
    const free = os.freemem();
    const cpus = os.cpus();
    return {
      host: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      daemonUptime: process.uptime(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model?.trim() ?? '',
      load1: load[0],
      load5: load[1],
      load15: load[2],
      memTotal: total,
      memFree: free,
      memUsed: total - free,
      nodeVersion: process.version,
      checkedAt: Date.now(),
    };
  });
}
