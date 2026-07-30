import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Le serveur d'empreintes (embeddings) — la mémoire de recherche des projets.
//
// Un llama-server dédié, sur le PROCESSEUR (`-ngl 0`, zéro mémoire vidéo : la
// carte reste au cerveau et aux jeux). Le daemon le lance à la demande et le
// garde chaud ; il meurt avec le daemon. Modèle léger (Qwen3-Embedding-0.6B),
// chargé en ~4 s, vecteurs de dimension 1024.

const BIN = process.env.BOOW_LLAMA_BIN ?? path.join(os.homedir(), 'llama.cpp', 'build', 'bin', 'llama-server');
const MODELE =
  process.env.BOOW_EMBED_MODEL ?? path.join(os.homedir(), 'models', 'qwen3-embedding-0.6b-f16.gguf');
const PORT = Number(process.env.BOOW_EMBED_PORT ?? 8082);
const BASE = `http://127.0.0.1:${PORT}`;

export function embeddingsDisponible(): boolean {
  return existsSync(BIN) && existsSync(MODELE);
}

let proc: ChildProcess | undefined;
let pret: Promise<void> | undefined;

function demarrer(): Promise<void> {
  if (pret) return pret;
  proc = spawn(
    BIN,
    [
      '--model', MODELE,
      '--embeddings',
      '--pooling', 'last',
      '-ngl', '0', // tout sur le processeur
      '--host', '127.0.0.1',
      '--port', String(PORT),
      '--ctx-size', '2048',
    ],
    { stdio: 'ignore' },
  );
  proc.on('exit', () => {
    proc = undefined;
    pret = undefined;
  });

  pret = new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const sonde = async () => {
      if (Date.now() - t0 > 60_000) return reject(new Error('serveur d’empreintes trop long à démarrer'));
      try {
        const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return resolve();
      } catch {
        /* pas encore prêt */
      }
      setTimeout(sonde, 1500);
    };
    sonde();
  });
  return pret;
}

/**
 * Empreintes d'un lot de textes. Démarre le serveur au premier appel.
 * L1/L2 : on renvoie les vecteurs bruts ; la normalisation se fait au calcul
 * de similarité.
 */
export async function empreintes(textes: string[]): Promise<number[][]> {
  if (!textes.length) return [];
  await demarrer();
  const r = await fetch(`${BASE}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: textes }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`empreintes HTTP ${r.status}`);
  const j = (await r.json()) as { data: { embedding: number[]; index: number }[] };
  // On respecte l'ordre d'entrée (l'API renvoie un champ index).
  const out: number[][] = new Array(textes.length);
  for (const d of j.data) out[d.index] = d.embedding;
  return out;
}

export function arreterEmbeddings(): void {
  proc?.kill();
  proc = undefined;
  pret = undefined;
}
