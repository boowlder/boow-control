import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { checkSystem } from '../probes/services';
import { config } from '../config';
import { listerOutils } from '../outils/registre';
import { etatMcp } from '../outils/mcp';

// On n'ouvre l'explorateur que dans les dossiers de travail — jamais un chemin
// arbitraire venu du navigateur.
const RACINES = [path.join(os.homedir(), 'projects'), path.join(os.homedir(), 'work')];
const dansPerimetre = (p: string) =>
  RACINES.some((r) => p === r || p.startsWith(r + path.sep));

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/system/status', async () => checkSystem());

  // La boîte à outils des cerveaux locaux : outils natifs + serveurs MCP.
  app.get('/api/outils', async () => ({ outils: listerOutils(), mcp: etatMcp() }));

  app.get('/api/config', async () => ({
    ports: { daemon: config.daemonPort, web: config.webPort },
    endpoints: config.endpoints,
  }));

  // Ouvre le dossier contenant un fichier dans l'explorateur Windows. N'a de
  // sens que sur le PC (WSL) ; ailleurs (Tailscale, plus tard), le front ne
  // proposera pas le bouton. `explorer.exe /select,` surligne le fichier.
  app.post('/api/system/reveler', async (req, reply) => {
    const brut = (req.body as { path?: string } | undefined)?.path;
    if (typeof brut !== 'string' || !brut) {
      reply.code(400);
      return { error: 'path requis' };
    }
    const cible = path.resolve(brut.replace(/^~/, os.homedir()));
    if (!dansPerimetre(cible)) {
      reply.code(403);
      return { error: 'hors périmètre' };
    }
    try {
      const infos = await stat(cible).catch(() => null);
      const explorer = '/mnt/c/Windows/explorer.exe';
      const gagnant = await new Promise<string>((resolve) => {
        // wslpath traduit /home/... en \\wsl.localhost\... pour l'explorateur.
        execFile('/usr/bin/wslpath', ['-w', cible], (err, out) => {
          if (err) return resolve('');
          const winPath = out.trim();
          // Un fichier : on le surligne ; un dossier : on l'ouvre.
          const args = infos?.isDirectory() ? [winPath] : ['/select,', winPath];
          execFile(explorer, args, () => resolve(winPath));
        });
      });
      if (!gagnant) {
        reply.code(500);
        return { error: 'explorateur indisponible' };
      }
      return { ok: true };
    } catch (e) {
      reply.code(500);
      return { error: (e as Error).message };
    }
  });
}
