import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { FastifyInstance } from 'fastify';

// L'oreille locale : le micro du composeur, transcrit sur la machine et jamais
// ailleurs. Réutilise le venv faster-whisper déjà installé (CPU, int8) — pas de
// GPU, la carte reste au cerveau. Le modèle est chargé UNE fois dans un worker
// Python persistant : une dictée courte revient alors en 1-2 s, pas 7.

const PY = process.env.BOOW_WHISPER_PY ?? path.join(os.homedir(), '.hermes', 'whisper-venv', 'bin', 'python');
const WORKER = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'oreille', 'worker.py');

export function oreilleDisponible(): boolean {
  return existsSync(PY) && existsSync(WORKER);
}

// ── Le worker persistant ─────────────────────────────────────────────────────
interface Worker {
  proc: ChildProcessWithoutNullStreams;
  pret: Promise<void>;
  /** Une transcription à la fois : le tuyau stdin/stdout est partagé. */
  file: Promise<unknown>;
  resoudre?: (r: Resultat) => void;
}
interface Resultat {
  texte?: string;
  langue?: string;
  erreur?: string;
}

let worker: Worker | undefined;

function demarrer(): Worker {
  const proc = spawn(PY, [WORKER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const w: Worker = { proc, pret: Promise.resolve(), file: Promise.resolve() };

  const rl = readline.createInterface({ input: proc.stdout });
  w.pret = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('le modèle a mis trop de temps à charger')), 60_000);
    rl.once('line', (l) => {
      clearTimeout(t);
      try {
        if ((JSON.parse(l) as { pret?: boolean }).pret) resolve();
        else reject(new Error('worker: réponse inattendue au démarrage'));
      } catch {
        reject(new Error('worker: démarrage illisible'));
      }
    });
  });

  // Après la ligne « prêt », chaque ligne est le résultat d'une transcription.
  rl.on('line', (l) => {
    if (!w.resoudre) return;
    const r = w.resoudre;
    w.resoudre = undefined;
    try {
      r(JSON.parse(l) as Resultat);
    } catch {
      r({ erreur: 'réponse illisible du worker' });
    }
  });

  const mourir = () => {
    if (worker === w) worker = undefined;
    if (w.resoudre) {
      w.resoudre({ erreur: 'worker arrêté' });
      w.resoudre = undefined;
    }
  };
  proc.on('exit', mourir);
  proc.on('error', mourir);
  return w;
}

function obtenirWorker(): Worker {
  if (!worker || worker.proc.killed) worker = demarrer();
  return worker;
}

/** Transcrit un fichier audio. Les appels sont sérialisés sur le worker. */
function transcrire(fichier: string): Promise<Resultat> {
  const w = obtenirWorker();
  const tour = w.file.then(async () => {
    await w.pret;
    return new Promise<Resultat>((resolve) => {
      const t = setTimeout(() => {
        if (w.resoudre) {
          w.resoudre = undefined;
          resolve({ erreur: 'transcription trop longue' });
        }
      }, 120_000);
      w.resoudre = (r) => {
        clearTimeout(t);
        resolve(r);
      };
      w.proc.stdin.write(`${fichier}\n`);
    });
  });
  // La file avance quoi qu'il arrive, sinon un échec la bloquerait à vie.
  w.file = tour.catch(() => undefined);
  return tour;
}

export function shutdownOreille(): void {
  worker?.proc.kill();
  worker = undefined;
}

// ── La route ─────────────────────────────────────────────────────────────────
export async function oreilleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/oreille/status', async () => ({ disponible: oreilleDisponible(), moteur: 'faster-whisper' }));

  app.post('/api/oreille', async (req, reply) => {
    if (!oreilleDisponible()) return reply.code(503).send({ error: 'oreille locale non installée' });
    const corps = req.body;
    if (!Buffer.isBuffer(corps) || corps.length === 0) {
      return reply.code(400).send({ error: 'audio attendu (corps binaire)' });
    }
    // Un garde-fou de taille : une dictée n'est pas un film.
    if (corps.length > 25 * 1024 * 1024) return reply.code(413).send({ error: 'audio trop lourd' });

    const tmp = path.join(os.tmpdir(), `boow-oreille-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.webm`);
    try {
      await writeFile(tmp, corps);
      const r = await transcrire(tmp);
      if (r.erreur) return reply.code(500).send({ error: r.erreur.slice(0, 200) });
      return { texte: r.texte ?? '' };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message.slice(0, 200) });
    } finally {
      void unlink(tmp).catch(() => {});
    }
  });
}
