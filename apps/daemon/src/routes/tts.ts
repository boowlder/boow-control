import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// Voix locale, via Piper. Tourne sur le processeur, ne touche pas au GPU
// (le cerveau en a besoin) et ne sort pas de la machine.

const PIPER = process.env.BOOW_PIPER_BIN ?? path.join(os.homedir(), '.local', 'piper', 'piper');
const VOIX = process.env.BOOW_PIPER_VOICE ?? path.join(os.homedir(), '.local', 'piper', 'fr_FR-siwis-medium.onnx');
/** Au-delà, on tronque : personne n'écoute une réponse de dix minutes. */
const MAX_CARACTERES = 1600;

export function ttsDisponible(): boolean {
  return existsSync(PIPER) && existsSync(VOIX);
}

/**
 * Fait parler Piper. Le texte passe par l'entrée standard : Piper ne le prend
 * pas en argument, il le lit sur stdin puis écrit le WAV sur disque.
 */
function synthetiser(texte: string, sortie: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(PIPER, ['--model', VOIX, '--output_file', sortie]);
    let erreurs = '';
    const minuteur = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error('la synthèse a dépassé 60 s'));
    }, 60_000);

    p.stderr.on('data', (d) => {
      erreurs = (erreurs + d.toString()).slice(-1000);
    });
    p.on('error', (e) => {
      clearTimeout(minuteur);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(minuteur);
      if (code === 0) resolve();
      else reject(new Error(erreurs.trim().slice(-200) || `piper a quitté avec le code ${code}`));
    });

    p.stdin.write(texte);
    p.stdin.end();
  });
}

/** Nettoie le markdown pour une lecture fluide. */
function lisible(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, '. bloc de code. ')
    .replace(/`[^`]*`/g, '')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, 'lien')
    .replace(/[#*_>|~]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_CARACTERES);
}

export async function ttsRoutes(app: FastifyInstance): Promise<void> {
  // Permet au front de savoir s'il doit utiliser la voix locale ou celle du navigateur.
  app.get('/api/tts/status', async () => ({
    disponible: ttsDisponible(),
    moteur: 'piper',
    voix: path.basename(VOIX),
  }));

  app.post('/api/tts', async (req, reply) => {
    if (!ttsDisponible()) {
      return reply.code(503).send({ error: 'voix locale non installée' });
    }
    const { text } = (req.body ?? {}) as { text?: string };
    const texte = lisible(String(text ?? ''));
    if (!texte) return reply.code(400).send({ error: 'texte vide' });

    const sortie = path.join(os.tmpdir(), `boow-tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
    try {
      await synthetiser(texte, sortie);
      const wav = await readFile(sortie);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Cache-Control', 'no-store');
      return reply.send(wav);
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message.slice(0, 200) });
    } finally {
      void unlink(sortie).catch(() => {
        /* fichier déjà parti */
      });
    }
  });
}
