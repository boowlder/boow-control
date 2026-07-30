import type { FastifyInstance } from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Dossier de dépôt — dans le périmètre autorisé (~/work), donc lisible par les agents. */
const UPLOAD_DIR = path.join(os.homedir(), 'work', 'boow-uploads');
const MAX = 25_000_000; // 25 Mo

/** Dépôt de fichiers / images depuis le PC. Corps binaire brut, nom en query. */
export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/upload', async (req, reply) => {
    const raw = String((req.query as { name?: string }).name ?? 'fichier');
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'fichier';
    const body = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      reply.code(400);
      return { error: 'corps vide' };
    }
    if (body.length > MAX) {
      reply.code(413);
      return { error: 'fichier trop volumineux (max 25 Mo)' };
    }
    try {
      await mkdir(UPLOAD_DIR, { recursive: true });
      const dest = path.join(UPLOAD_DIR, `${Date.now().toString(36)}-${safe}`);
      await writeFile(dest, body);
      return { path: dest, name: safe, size: body.length };
    } catch (e) {
      reply.code(500);
      return { error: (e as Error).message };
    }
  });
}
