import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Recurrence, Routine } from '@boow/shared';
import type { Bus } from './bus';
import type { Registry } from './registry';
import { decide } from './routing';
import { isLocalOnly } from './agents/claude';
import { demanderAuCerveau } from './agents/local';
import { runHermes } from './agents/hermes';
import { lancerOperationDirecte } from './operations';

// Tâches programmées. Une horloge simple, pas de dépendance : on regarde toutes
// les 20 secondes si quelque chose est dû. La précision à la seconde n'a aucun
// intérêt ici, et une routine ratée pendant que le cockpit dormait se rattrape
// au démarrage suivant.

const FICHIER = path.join(os.homedir(), '.boow', 'routines.json');
/** Fréquence de contrôle de l'horloge. */
const TIC = 20_000;
/** Budget d'appels Claude d'une routine en mode opération. */
const BUDGET_OPERATION = 3;

let routines: Routine[] = [];
let bus: Bus | undefined;
let registry: Registry | undefined;
let horloge: NodeJS.Timeout | undefined;

const uid = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function listerRoutines(): Routine[] {
  return [...routines].sort((a, b) => {
    if (a.actif !== b.actif) return a.actif ? -1 : 1;
    return a.prochaine - b.prochaine;
  });
}

function diffuser(): void {
  bus?.emit({ t: 'routine.list', routines: listerRoutines() });
  void sauver();
}

async function sauver(): Promise<void> {
  try {
    await mkdir(path.dirname(FICHIER), { recursive: true });
    await writeFile(FICHIER, JSON.stringify(routines, null, 2), 'utf8');
  } catch {
    // Une routine en mémoire vaut mieux qu'un daemon qui plante à l'écriture.
  }
}

/** Calcule la date de la prochaine occurrence après `depuis`. */
export function prochaineOccurrence(depuis: number, recurrence: Recurrence): number {
  if (recurrence === 'unique') return 0;
  const d = new Date(depuis);
  switch (recurrence) {
    case 'horaire':
      d.setHours(d.getHours() + 1);
      break;
    case 'quotidien':
      d.setDate(d.getDate() + 1);
      break;
    case 'hebdomadaire':
      d.setDate(d.getDate() + 7);
      break;
    case 'mensuel':
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d.getTime();
}

/** Avance une échéance dépassée jusqu'à la prochaine dans le futur. */
function rattraper(prochaine: number, recurrence: Recurrence): number {
  if (recurrence === 'unique') return prochaine;
  let p = prochaine;
  let garde = 0;
  while (p <= Date.now() && garde++ < 5000) p = prochaineOccurrence(p, recurrence);
  return p;
}

export async function chargerRoutines(b: Bus, r: Registry): Promise<Routine[]> {
  bus = b;
  registry = r;
  try {
    routines = JSON.parse(await readFile(FICHIER, 'utf8')) as Routine[];
    // Une exécution marquée « en cours » ne peut pas survivre à un redémarrage.
    for (const x of routines) x.encours = false;
  } catch {
    routines = [];
  }
  if (!horloge) horloge = setInterval(() => void tic(), TIC);
  return listerRoutines();
}

export function arreterHorloge(): void {
  if (horloge) clearInterval(horloge);
  horloge = undefined;
}

export function creerRoutine(entree: {
  titre: string;
  consigne: string;
  mode: Routine['mode'];
  recurrence: Recurrence;
  premiere: number;
}): Routine {
  const routine: Routine = {
    id: uid(),
    titre: entree.titre.trim().slice(0, 120) || entree.consigne.trim().slice(0, 60),
    consigne: entree.consigne.trim(),
    mode: entree.mode,
    recurrence: entree.recurrence,
    // Une date déjà passée partirait immédiatement : on la repousse d'une minute.
    prochaine: entree.premiere > Date.now() ? entree.premiere : Date.now() + 60_000,
    actif: true,
    cree: Date.now(),
  };
  routines.push(routine);
  diffuser();
  return routine;
}

/**
 * Modifie une routine existante sans la recréer.
 *
 * Recréer perdrait `derniere`, `dernierResultat` et `dernierOk` — c'est-à-dire
 * tout ce qui permet de savoir si elle marchait. Corriger une heure ne doit pas
 * effacer la mémoire de la tâche.
 */
export function modifierRoutine(
  id: string,
  patch: Partial<Pick<Routine, 'titre' | 'consigne' | 'mode' | 'recurrence' | 'prochaine'>>,
): Routine | undefined {
  const r = routines.find((x) => x.id === id);
  if (!r) return undefined;
  if (patch.titre !== undefined) r.titre = patch.titre.trim().slice(0, 120) || r.titre;
  if (patch.consigne !== undefined && patch.consigne.trim()) r.consigne = patch.consigne.trim();
  if (patch.mode !== undefined) r.mode = patch.mode;
  if (patch.recurrence !== undefined) r.recurrence = patch.recurrence;
  if (patch.prochaine !== undefined) {
    // Une date déjà passée partirait tout de suite : on la repousse d'une minute.
    r.prochaine = patch.prochaine > Date.now() ? patch.prochaine : Date.now() + 60_000;
  }
  diffuser();
  return r;
}

export function basculerRoutine(id: string, actif: boolean): boolean {
  const r = routines.find((x) => x.id === id);
  if (!r) return false;
  r.actif = actif;
  // En la réactivant, on ne veut pas qu'elle rattrape tout son retard d'un coup.
  if (actif && r.prochaine <= Date.now()) r.prochaine = rattraper(r.prochaine, r.recurrence);
  diffuser();
  return true;
}

export function supprimerRoutine(id: string): boolean {
  const avant = routines.length;
  routines = routines.filter((x) => x.id !== id);
  if (routines.length === avant) return false;
  diffuser();
  return true;
}

// ── L'exécution ─────────────────────────────────────────────────────────────

/** Lance une routine et note ce qu'elle a donné. */
export async function executerRoutine(id: string): Promise<void> {
  const r = routines.find((x) => x.id === id);
  if (!r || r.encours || !bus || !registry) return;

  r.encours = true;
  r.derniere = Date.now();
  diffuser();
  bus.emit({ t: 'notice', level: 'info', text: `Routine « ${r.titre} » : c'est parti.` });

  let ok = false;
  let resume = '';

  try {
    if (r.mode === 'operation') {
      if (isLocalOnly()) {
        resume = '« Tout local » actif — le mode opération a besoin de Claude.';
      } else {
        // Sans personne pour discuter, la routine va droit à la carte.
        const op = await lancerOperationDirecte(bus, registry, r.consigne, {
          budget: BUDGET_OPERATION,
          revueFinale: false,
        });
        ok = op.statut === 'termine';
        resume = op.message ?? op.statut;
      }
    } else {
      // Modes normal et ClaudeCODE : on passe par la même décision que la barre
      // de conversation, pour que le comportement soit identique.
      const d = decide(r.mode, r.consigne, registry, { localOnly: isLocalOnly(), hasImages: false });
      if (d.refus) {
        resume = d.refus;
      } else if (d.agent === 'hermes') {
        const res = await runHermes(bus, registry, 'hermes', r.consigne);
        ok = !res.erreur && !!res.texte.trim();
        resume = res.erreur ?? res.texte.trim().slice(0, 400);
      } else if (d.agent === 'claude-code') {
        // Une routine ne doit pas ouvrir une conversation sans fin : on demande
        // une réponse unique, bornée, comme pour les cartes d'opération.
        const { askClaudeOnce } = await import('./agents/claude');
        const res = await askClaudeOnce(r.consigne, { maxTurns: 1 });
        ok = !res.erreur && !!res.texte;
        resume = res.erreur ?? res.texte.slice(0, 400);
      } else {
        const res = await demanderAuCerveau(r.consigne);
        ok = !res.erreur && !!res.texte;
        resume = res.erreur ?? res.texte.slice(0, 400);
      }
    }
  } catch (e) {
    resume = (e as Error).message || 'échec inattendu';
  }

  r.encours = false;
  r.dernierOk = ok;
  r.dernierResultat = resume || (ok ? 'terminé' : 'aucun résultat');

  if (r.recurrence === 'unique') {
    r.actif = false;
    r.prochaine = 0;
  } else {
    r.prochaine = prochaineOccurrence(Date.now(), r.recurrence);
  }
  diffuser();

  bus.emit({
    t: 'notice',
    level: ok ? 'info' : 'warn',
    text: `Routine « ${r.titre} » : ${ok ? 'terminée' : 'échec'}.`,
  });
}

/** Un tour d'horloge : y a-t-il quelque chose à lancer ? */
async function tic(): Promise<void> {
  const maintenant = Date.now();
  const dues = routines.filter((r) => r.actif && !r.encours && r.prochaine > 0 && r.prochaine <= maintenant);
  // Une seule à la fois : deux routines simultanées se battraient pour le GPU.
  const premiere = dues[0];
  if (premiere) await executerRoutine(premiere.id);
}
