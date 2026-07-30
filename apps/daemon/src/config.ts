// Configuration centrale du daemon : ports + endpoints des services + binaires.
// Tout est surchargé par variables d'environnement (BOOW_*).

import os from 'node:os';
import path from 'node:path';

// Résout les binaires utilisateur (~/.local/bin : hermes, ddgs…) même quand le
// daemon est lancé depuis un shell non-login (qui ne source pas ~/.profile).
const userBin = path.join(os.homedir(), '.local', 'bin');
if (!(process.env.PATH ?? '').split(path.delimiter).includes(userBin)) {
  process.env.PATH = `${userBin}${path.delimiter}${process.env.PATH ?? ''}`;
}

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export const config = {
  daemonPort: num(process.env.BOOW_DAEMON_PORT, 8788),
  webPort: num(process.env.BOOW_WEB_PORT, 5180),
  // 0.0.0.0 par défaut : le relais localhost de WSL2 se bloque après un kill/restart
  // du listener ; binder toutes les interfaces le rend joignable via l'IP WSL et fiabilise
  // le forwarding localhost (cohérent avec Vite host:true). Réseau privé + contrôle d'origine.
  host: process.env.BOOW_HOST ?? '0.0.0.0',
  endpoints: {
    brain: process.env.BOOW_BRAIN_URL ?? 'http://localhost:8080/v1',
    brainModel: process.env.BOOW_BRAIN_MODEL ?? 'qwen3.6-35b',
    chromeCdp: process.env.BOOW_CHROME_CDP ?? 'http://localhost:9222',
  },
  bin: {
    claude: process.env.BOOW_CLAUDE_BIN ?? 'claude',
    hermes: process.env.BOOW_HERMES_BIN ?? 'hermes',
  },
  // Cerveaux locaux spécialisés (noms des sections de ~/models/router.ini).
  // Routés automatiquement par type de tâche, tous derrière le même endpoint
  // OpenAI : le routeur charge celui qu'on demande et décharge le précédent.
  brains: {
    coder: process.env.BOOW_BRAIN_CODER ?? process.env.BOOW_BRAIN_MODEL ?? 'qwen3.6-35b',
    vision: process.env.BOOW_BRAIN_VISION ?? 'qwen3-vl-8b',
    reasoning: process.env.BOOW_BRAIN_REASONING ?? 'qwen3-14b',
    fast: process.env.BOOW_BRAIN_FAST ?? 'qwen3-4b',
  },
  // Fenêtre de contexte (tokens) par modèle — reflète ~/models/router.ini.
  // Sert à la jauge du composeur et au seuil de compaction des sessions longues.
  brainCtx: {
    'qwen3.6-35b': 65536,
    'qwen3.6-35b-leger': 65536,
    'qwen3-vl-8b': 32768,
    'qwen3-14b': 32768,
    'qwen3-4b': 16384,
  } as Record<string, number>,
  // Contexte supposé pour un modèle inconnu : prudent, pour ne pas rater un seuil.
  brainCtxDefault: num(process.env.BOOW_BRAIN_CTX_DEFAULT, 32768),
};

export type BoowConfig = typeof config;

/** Origines web autorisées (CORS + handshake WebSocket). En dev : Vite (webPort).
 *  En prod : l'app est servie par le daemon lui-même (daemonPort, même origine). */
export const webOrigins = [
  `http://localhost:${config.webPort}`,
  `http://127.0.0.1:${config.webPort}`,
  `http://localhost:${config.daemonPort}`,
  `http://127.0.0.1:${config.daemonPort}`,
];

/**
 * Origine autorisée ? Loopback + IP privées (WSL / LAN local) sur le port web ou daemon.
 * Les origines distantes restent bloquées. Les requêtes sans origine (curl, tests) passent.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true;
  if (webOrigins.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (port !== String(config.webPort) && port !== String(config.daemonPort)) return false;
    const h = u.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (/^10\./.test(h)) return true; // 10.0.0.0/8
    if (/^192\.168\./.test(h)) return true; // 192.168.0.0/16
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // 172.16.0.0/12 (WSL)
    return false;
  } catch {
    return false;
  }
}
