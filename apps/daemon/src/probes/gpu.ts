import { execFile } from 'node:child_process';
import type { GpuStatus } from '@boow/shared';

// Mémoire vidéo occupée. C'est le chiffre qui décide quel cerveau tient sur la
// carte : à 16 Go, un modèle de trop et tout part en mémoire système, dix fois
// plus lent. Il mérite d'être visible en permanence.

/** `nvidia-smi` met quelques dizaines de ms ; on ne le lance pas plus souvent. */
const TTL = 4_000;

const ARGS = ['--query-gpu=memory.used,memory.total,name', '--format=csv,noheader,nounits'];

/**
 * Où chercher le binaire.
 *
 * Sous WSL il vit dans `/usr/lib/wsl/lib`, un dossier présent dans le PATH d'un
 * shell interactif mais **pas** dans celui du service systemd. Sans ce repli, la
 * jauge marchait en développement et restait vide en production — exactement le
 * genre d'écart qu'on ne voit qu'en regardant l'écran.
 */
const CHEMINS = ['nvidia-smi', '/usr/lib/wsl/lib/nvidia-smi', '/usr/bin/nvidia-smi'];

let cache: GpuStatus | undefined;
let vu = 0;
/** Chemin retenu au premier succès — on ne recherche pas à chaque appel. */
let binaire: string | undefined;
/** Aucun chemin ne répond : il n'y a pas de carte NVIDIA ici. */
let absent = false;

function lancer(bin: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(bin, ARGS, { timeout: 3_000 }, (err, stdout) => resolve(err ? undefined : String(stdout)));
  });
}

/** « 15129, 16311, NVIDIA GeForce RTX 5060 Ti » -> état lisible. */
export function analyser(stdout: string): GpuStatus | undefined {
  // Une ligne par carte ; on ne s'occupe que de la première.
  const ligne = stdout.split('\n')[0] ?? '';
  const un = ligne.indexOf(',');
  const deux = ligne.indexOf(',', un + 1);
  if (un < 0 || deux < 0) return undefined;

  const utiliseMo = Number(ligne.slice(0, un).trim());
  const totalMo = Number(ligne.slice(un + 1, deux).trim());
  if (!Number.isFinite(utiliseMo) || !Number.isFinite(totalMo) || totalMo <= 0) return undefined;

  // Le nom est pris tel quel : certaines cartes en ont un qui contient une
  // virgule (« RTX A6000, 48GB »), que redécouper abîmerait.
  const nom = ligne.slice(deux + 1).trim();
  return { utiliseMo, totalMo, ...(nom ? { nom } : {}) };
}

async function lire(): Promise<GpuStatus | undefined> {
  if (binaire) return analyser((await lancer(binaire)) ?? '');
  for (const bin of CHEMINS) {
    const sortie = await lancer(bin);
    if (sortie === undefined) continue;
    binaire = bin;
    return analyser(sortie);
  }
  absent = true;
  return undefined;
}

/** Rend l'état de la carte, ou `undefined` s'il n'y en a pas. Ne lève jamais. */
export async function checkGpu(): Promise<GpuStatus | undefined> {
  if (absent) return undefined;
  if (cache && Date.now() - vu < TTL) return cache;
  try {
    const r = await lire();
    vu = Date.now();
    // Un échec passager garde la dernière valeur connue plutôt que de faire
    // clignoter la jauge à vide.
    if (r) cache = r;
  } catch {
    /* la sonde ne doit jamais faire tomber le statut système */
  }
  return cache;
}
