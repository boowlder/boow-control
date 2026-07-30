import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

const ROOTS = [path.join(os.homedir(), 'projects'), path.join(os.homedir(), 'work')];

function inScope(p: string): boolean {
  const r = path.resolve(p);
  return ROOTS.some((root) => r === root || r.startsWith(root + path.sep));
}

interface Entry {
  name: string;
  path: string;
  dir: boolean;
  size?: number;
  mtime?: number;
}

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files', async (req, reply) => {
    const q = (req.query as { path?: string }).path;
    if (!q) {
      return {
        path: null,
        parent: null,
        roots: ROOTS,
        entries: ROOTS.map((r) => ({ name: path.basename(r), path: r, dir: true }) as Entry),
      };
    }
    const target = path.resolve(q);
    if (!inScope(target)) {
      reply.code(403);
      return { error: 'hors périmètre' };
    }
    try {
      const names = await readdir(target);
      const settled = await Promise.all(
        names
          .filter((n) => !n.startsWith('.'))
          .map(async (n): Promise<Entry | null> => {
            const full = path.join(target, n);
            try {
              const s = await stat(full);
              return { name: n, path: full, dir: s.isDirectory(), size: s.size, mtime: s.mtimeMs };
            } catch {
              return null;
            }
          }),
      );
      const entries = settled
        .filter((e): e is Entry => e !== null)
        .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
      const parentDir = path.dirname(target);
      return { path: target, parent: inScope(parentDir) ? parentDir : null, roots: ROOTS, entries };
    } catch {
      reply.code(404);
      return { error: 'introuvable' };
    }
  });

  // L'arbre plat d'un dossier de travail, pour la mention @ du composeur.
  // Jamais le lourd (node_modules, .git, dist…), plafonné : une mention veut
  // dix propositions à l'écran, pas un inventaire.
  app.get('/api/files/arbre', async (req, reply) => {
    const q = (req.query as { path?: string }).path;
    if (!q) {
      reply.code(400);
      return { error: 'path requis' };
    }
    const racine = path.resolve(q);
    if (!inScope(racine)) {
      reply.code(403);
      return { error: 'hors périmètre' };
    }
    const EXCLUS = new Set(['node_modules', 'dist', 'build', '.git', '.venv', '__pycache__', 'target', '.next']);
    const MAX = 2000;
    const fichiers: string[] = [];
    const marcher = async (dir: string, prof: number): Promise<void> => {
      if (fichiers.length >= MAX || prof > 8) return;
      let entrees;
      try {
        entrees = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entrees) {
        if (fichiers.length >= MAX) return;
        if (e.name.startsWith('.') || EXCLUS.has(e.name)) continue;
        const plein = path.join(dir, e.name);
        if (e.isDirectory()) await marcher(plein, prof + 1);
        else if (e.isFile()) fichiers.push(path.relative(racine, plein));
      }
    };
    await marcher(racine, 0);
    fichiers.sort();
    return { racine, fichiers, tronque: fichiers.length >= MAX };
  });

  // Sert le contenu brut d'un fichier (image…) du périmètre — pour l'aperçu inline.
  app.get('/api/files/raw', async (req, reply) => {
    const q = (req.query as { path?: string }).path;
    if (!q) {
      reply.code(400);
      return { error: 'path requis' };
    }
    const target = path.resolve(q);
    if (!inScope(target)) {
      reply.code(403);
      return { error: 'hors périmètre' };
    }
    try {
      const s = await stat(target);
      if (!s.isFile() || s.size > 30_000_000) {
        reply.code(413);
        return { error: 'fichier non servable' };
      }
      const mime = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
      reply.header('content-type', mime);
      reply.header('cache-control', 'private, max-age=3600');
      return reply.send(createReadStream(target));
    } catch {
      reply.code(404);
      return { error: 'introuvable' };
    }
  });
}
