import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { empreintes } from './serveur';

// L'index de recherche des projets : « où ai-je fait ce composant ? ». On
// découpe le texte et le code en morceaux, on calcule leur empreinte, et on
// range le tout dans un fichier plat. La recherche compare l'empreinte de la
// question à celles des morceaux (cosinus) — assez rapide en mémoire pour les
// quelques milliers de morceaux d'un dossier de projets, sans base lourde.

// Par défaut projects + work ; surchargeable (tests, périmètre réduit).
const RACINES = (process.env.BOOW_INDEX_ROOTS ?? `${path.join(os.homedir(), 'projects')}:${path.join(os.homedir(), 'work')}`)
  .split(':')
  .filter(Boolean);
const FICHIER = path.join(os.homedir(), '.boow', 'memoire.json');

// Ce qu'on n'indexe jamais : le lourd, le généré, le binaire — et `open-design`,
// le projet retiré au chantier 1 (7026 fichiers morts qui noyaient tout).
const EXCLUS = new Set(['node_modules', 'dist', 'build', '.git', '.venv', '__pycache__', 'target', '.next', '.cache', 'coverage', 'open-design']);
const EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.cs',
  '.sh', '.sql', '.html', '.css', '.scss', '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.vue', '.svelte',
]);
const MAX_FICHIER = 200_000; // au-delà, on saute (fichier généré/minifié probable)
const TAILLE_MORCEAU = 1400;
const MORCEAUX_MAX = 8; // par fichier : un gros fichier ne noie pas l'index
// Plafond global : borne le temps d'indexation et la taille du fichier. À
// 1024 flottants par morceau, 15000 morceaux ≈ 60 Mo de JSON — dans le budget
// « quelques dizaines de Mo » annoncé à l'utilisateur.
const MORCEAUX_TOTAL = 15_000;

interface Morceau {
  chemin: string;
  debut: number;
  texte: string;
  /** Vecteur normalisé puis quantifié en int8, encodé base64 : ~1 Ko au lieu
   *  de ~18 Ko en flottants JSON. La perte de précision est sans effet sur le
   *  classement par similarité. */
  q: string;
}

/** Normalise un vecteur puis le quantifie en int8 base64. */
function quantifier(vec: number[]): string {
  let norme = 0;
  for (const x of vec) norme += x * x;
  norme = Math.sqrt(norme) || 1;
  const buf = Buffer.allocUnsafe(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const v = Math.round((vec[i] / norme) * 127);
    buf[i] = Math.max(-127, Math.min(127, v)) & 0xff; // int8 signé dans un octet
  }
  return buf.toString('base64');
}

/** Cosinus entre deux vecteurs int8 (base64). */
function cosinusQ(aB64: string, bB64: string): number {
  const a = Buffer.from(aB64, 'base64');
  const b = Buffer.from(bB64, 'base64');
  let ps = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = (a[i] << 24) >> 24; // octet -> int8 signé
    const y = (b[i] << 24) >> 24;
    ps += x * y;
    na += x * x;
    nb += y * y;
  }
  return ps / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
interface Index {
  version: number;
  indexeLe: number;
  morceaux: Morceau[];
}

let cache: Index | undefined;

function decouper(contenu: string): { debut: number; texte: string }[] {
  const out: { debut: number; texte: string }[] = [];
  for (let i = 0; i < contenu.length && out.length < MORCEAUX_MAX; i += TAILLE_MORCEAU) {
    const texte = contenu.slice(i, i + TAILLE_MORCEAU).trim();
    if (texte.length > 40) out.push({ debut: i, texte });
  }
  return out;
}

async function* fichiers(dir: string, prof = 0): AsyncGenerator<string> {
  if (prof > 8) return;
  let entrees;
  try {
    entrees = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entrees) {
    if (e.name.startsWith('.') || EXCLUS.has(e.name)) continue;
    const plein = path.join(dir, e.name);
    if (e.isDirectory()) yield* fichiers(plein, prof + 1);
    else if (e.isFile() && EXT.has(path.extname(e.name).toLowerCase())) yield plein;
  }
}

/** (Re)construit l'index complet. Rend le nombre de morceaux et la taille. */
export async function indexer(): Promise<{ fichiers: number; morceaux: number; octets: number }> {
  const aEmpreinter: { chemin: string; debut: number; texte: string }[] = [];
  let nbFichiers = 0;
  for (const racine of RACINES) {
    for await (const f of fichiers(racine)) {
      if (aEmpreinter.length >= MORCEAUX_TOTAL) break;
      try {
        const s = await stat(f);
        if (s.size > MAX_FICHIER) continue;
        const contenu = await readFile(f, 'utf8');
        const bouts = decouper(contenu);
        if (!bouts.length) continue;
        nbFichiers++;
        for (const b of bouts) aEmpreinter.push({ chemin: f, ...b });
      } catch {
        /* fichier illisible : on saute */
      }
    }
  }

  // Empreintes par lots : on ne submerge pas le serveur d'un seul coup. Un lot
  // qui échoue est SAUTÉ, pas fatal : mieux vaut un index presque complet que
  // rien après plusieurs minutes de travail.
  const morceaux: Morceau[] = [];
  const LOT = 64;
  for (let i = 0; i < aEmpreinter.length; i += LOT) {
    const lot = aEmpreinter.slice(i, i + LOT);
    try {
      const vecs = await empreintes(lot.map((m) => m.texte));
      lot.forEach((m, j) => vecs[j] && morceaux.push({ ...m, q: quantifier(vecs[j]) }));
    } catch {
      /* lot raté : on continue avec le reste */
    }
  }

  const index: Index = { version: 1, indexeLe: Date.now(), morceaux };
  await mkdir(path.dirname(FICHIER), { recursive: true });
  const json = JSON.stringify(index);
  await writeFile(FICHIER, json);
  cache = index;
  return { fichiers: nbFichiers, morceaux: morceaux.length, octets: Buffer.byteLength(json) };
}

async function charger(): Promise<Index | undefined> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FICHIER, 'utf8')) as Index;
    return cache;
  } catch {
    return undefined;
  }
}

export interface Trouvaille {
  chemin: string;
  score: number;
  extrait: string;
}

/** Cherche les fichiers les plus proches d'une question. Un résultat par fichier. */
export async function chercher(question: string, max = 8): Promise<Trouvaille[]> {
  const index = await charger();
  if (!index || !index.morceaux.length) return [];
  const [qVec] = await empreintes([question]);
  if (!qVec) return [];
  const qB64 = quantifier(qVec);

  // Meilleur morceau par fichier.
  const parFichier = new Map<string, Trouvaille>();
  for (const m of index.morceaux) {
    const score = cosinusQ(qB64, m.q);
    const actuel = parFichier.get(m.chemin);
    if (!actuel || score > actuel.score) {
      parFichier.set(m.chemin, { chemin: m.chemin, score, extrait: m.texte.slice(0, 160) });
    }
  }
  return [...parFichier.values()].sort((a, b) => b.score - a.score).slice(0, max);
}

export async function etatIndex(): Promise<{ indexe: boolean; morceaux: number; indexeLe?: number; octets?: number }> {
  const index = await charger();
  if (!index) return { indexe: false, morceaux: 0 };
  try {
    const s = await stat(FICHIER);
    return { indexe: true, morceaux: index.morceaux.length, indexeLe: index.indexeLe, octets: s.size };
  } catch {
    return { indexe: true, morceaux: index.morceaux.length, indexeLe: index.indexeLe };
  }
}
