import type { AgentId, BoowMode } from '@boow/shared';
import type { Registry } from './registry';

// Routage invisible : l'utilisateur écrit dans UNE barre, le daemon choisit qui répond.
// Le principe : on n'envoie chez « celui qui a des mains » (Hermes) que si la
// demande touche vraiment à la machine. Tout le reste part sur un cerveau local,
// qui sait déjà choisir son spécialiste (code, vision, raisonnement, rapide).

/** Verbes qui, seuls, veulent toujours dire « fais-le sur la machine ». */
const ACTION_FORTE =
  /\b(installe[rz]?|d[ée]sinstalle[rz]?|ex[ée]cute[rz]?|lance[rz]?|d[ée]marre[rz]?|red[ée]marre[rz]?|arr[êe]te[rz]?|compile[rz]?|d[ée]ploie|commit(e|es)?|push(e|es)?|clone[rz]?|t[ée]l[ée]charge[rz]?|screenshot|capture d.[ée]cran)\b/i;

/** Verbes d'action — ne suffisent pas seuls, il leur faut un objet concret. */
const ACTION =
  /\b(cr[ée]e[rz]?|cr[ée][ée]|[ée]cri[stez]+|[ée]crire|modifie[rz]?|change[rz]?|renomme[rz]?|supprime[rz]?|efface[rz]?|d[ée]place[rz]?|copie[rz]?|d[ée]placer|ajoute[rz]?|range[rz]?|ouvre[rz]?|va sur|navigue[rz]?|corrige[rz]?)\b/i;

/** Objets qui n'ont de sens que si quelqu'un a accès à la machine ou au web. */
const CIBLE =
  /\b(fichiers?|dossiers?|r[ée]pertoires?|chemins?|projets?|d[ée]p[ôo]ts?|repo|branche|commit|terminal|commande|paquets?|d[ée]pendances?|service|site|page web|url|navigateur|onglet)\b/i;

/** Un chemin ou un nom de fichier écrit noir sur blanc. */
const CHEMIN = /(^|\s)(~\/|\.\/|\/home\/|[\w.-]+\.(txt|md|json|ya?ml|ts|tsx|js|jsx|py|sh|css|html|toml|ini|csv|log))/i;

/** Une adresse web à visiter. */
const URL_RE = /\bhttps?:\/\/\S+/i;

/**
 * La demande réclame-t-elle des « mains » (agir sur la machine ou le web) ?
 * Volontairement prudent : dans le doute, on reste sur un cerveau local, qui
 * répond plus vite et ne touche à rien.
 */
export function besoinDeMains(texte: string): boolean {
  if (ACTION_FORTE.test(texte)) return true;
  if (URL_RE.test(texte) && ACTION.test(texte)) return true;
  if (!ACTION.test(texte)) return false;
  return CIBLE.test(texte) || CHEMIN.test(texte);
}

export interface Decision {
  /** L'agent qui va répondre. */
  agent: AgentId;
  /** Explication courte, affichée à l'utilisateur pour qu'il comprenne le choix. */
  why: string;
  /** Rien ne part : le mode n'est pas encore disponible ou est bloqué. */
  refus?: string;
}

/**
 * Choisit qui traite le message selon le mode actif.
 * Ne fait aucun appel réseau : c'est une décision, pas une exécution.
 */
export function decide(
  mode: BoowMode,
  texte: string,
  registry: Registry,
  options: { localOnly: boolean; hasImages: boolean },
): Decision {
  if (mode === 'claude') {
    if (options.localOnly) {
      return { agent: 'claude-code', why: '', refus: "« Tout local » est activé : rebranche Claude pour utiliser ce mode." };
    }
    return { agent: 'claude-code', why: 'mode ClaudeCODE' };
  }

  // Le mode opération ne passe JAMAIS par le chat : il a son propre moteur
  // (operations.ts), lancé par la commande `operation.start`. Sans ce garde-fou,
  // un message envoyé ici ouvrirait une conversation Claude au lieu d'une carte
  // — exactement la dépense qu'on cherche à éviter.
  if (mode === 'operation') {
    return {
      agent: 'claude-code',
      why: '',
      refus: options.localOnly
        ? "« Tout local » est activé : le mode opération a besoin de Claude pour dresser la carte."
        : 'Le mode opération se lance avec « operation.start », pas par la conversation.',
    };
  }

  // ── Mode normal : 100 % local ────────────────────────────────────────────
  // Une image jointe se lit avec l'œil local, pas avec des mains.
  if (!options.hasImages && besoinDeMains(texte)) {
    const hermes = registry.get('hermes');
    if (hermes?.online) return { agent: 'hermes', why: 'ça touche à la machine — Hermes a les mains' };
    return { agent: 'qwen', why: 'Hermes est hors ligne — un cerveau local répond quand même' };
  }
  return { agent: 'qwen', why: options.hasImages ? 'image à lire — œil local' : 'question — cerveau local' };
}
