import type { AgentId, BoowMode } from '@boow/shared';
import type { ChatMsg } from './useCockpit';

// Une session, c'est une conversation menée dans un mode donné.
//
// Le cloisonnement par mode n'est pas cosmétique : une discussion locale est
// gratuite, une session Claude est facturée. Mélangées dans une même liste, on
// rouvre une session payante en croyant reprendre une conversation gratuite.
// D'où un tas par mode, et jamais de passerelle entre eux.

export interface Session {
  id: string;
  mode: BoowMode;
  /** Reprend la première phrase de l'utilisateur ; « Nouvelle discussion » avant ça. */
  titre: string;
  /** Création, en ms. */
  cree: number;
  /** Dernière activité, en ms — c'est l'ordre de la liste. */
  vu: number;
  /** Le contenu, dans la forme que le reste du cockpit connaît déjà. */
  chats: Record<AgentId, ChatMsg[]>;
}

const CLE = 'boow.sessions';
/** Au-delà, les plus vieilles sortent : le stockage local est petit. */
const MAX_PAR_MODE = 100;

export const SANS_TITRE = 'Nouvelle discussion';

export const uid = (): string => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

export function nouvelle(mode: BoowMode): Session {
  const t = Date.now();
  return { id: uid(), mode, titre: SANS_TITRE, cree: t, vu: t, chats: {} };
}

/** Un titre lisible tiré du premier message — coupé au mot, pas au caractère. */
export function titreDepuis(texte: string): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  if (!propre) return SANS_TITRE;
  if (propre.length <= 48) return propre;
  const coupe = propre.slice(0, 48);
  const espace = coupe.lastIndexOf(' ');
  return `${espace > 20 ? coupe.slice(0, espace) : coupe}…`;
}

export function charger(): Session[] {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) ?? '[]') as Session[];
    if (!Array.isArray(brut)) return [];
    return brut
      .filter((s) => s && typeof s.id === 'string' && s.chats)
      .map((s) => ({
        ...s,
        // Un flux interrompu par un rechargement resterait « en cours » à vie.
        chats: Object.fromEntries(
          Object.entries(s.chats).map(([k, v]) => [k, (v ?? []).map((m) => (m.streaming ? { ...m, streaming: false } : m))]),
        ),
      }));
  } catch {
    return [];
  }
}

export function enregistrer(sessions: Session[]): void {
  try {
    // Élagage par mode : un tas bavard ne doit pas faire disparaître les autres.
    const parMode = new Map<BoowMode, Session[]>();
    for (const s of [...sessions].sort((a, b) => b.vu - a.vu)) {
      const tas = parMode.get(s.mode) ?? [];
      if (tas.length < MAX_PAR_MODE) tas.push(s);
      parMode.set(s.mode, tas);
    }
    const gardees = [...parMode.values()].flat();
    localStorage.setItem(CLE, JSON.stringify(gardees));
  } catch {
    /* quota dépassé ou stockage refusé : on continue sans persister */
  }
}

/** Les sessions d'un mode, la plus récente en tête. */
export function parMode(sessions: Session[], mode: BoowMode): Session[] {
  return sessions.filter((s) => s.mode === mode).sort((a, b) => b.vu - a.vu);
}

/** Tout le texte d'une session, pour la recherche : titre + chaque message. */
function texteSession(s: Session): string {
  let t = s.titre;
  for (const liste of Object.values(s.chats)) {
    for (const m of liste ?? []) t += ` ${m.text}`;
  }
  return t.toLowerCase();
}

/**
 * Filtre par mot(s) dans le titre ET le contenu. Plusieurs mots = tous
 * présents (ET), l'ordre est libre : « bug composant » trouve une session qui
 * parle des deux, où qu'ils soient.
 */
export function filtrer(sessions: Session[], requete: string): Session[] {
  const mots = requete.toLowerCase().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return sessions;
  return sessions.filter((s) => {
    const t = texteSession(s);
    return mots.every((m) => t.includes(m));
  });
}
