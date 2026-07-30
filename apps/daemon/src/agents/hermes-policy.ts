import type { LocalPermissionMode } from '@boow/shared';

// La politique d'autorisation des agents locaux, seule et sans dépendance.
//
// Elle est ici plutôt que dans `hermes.ts` pour deux raisons : c'est une
// préoccupation distincte du transport ACP, et surtout ces fonctions décident
// si une commande s'exécute sur la machine de l'utilisateur — elles méritent d'être
// testables directement, sans démarrer un sous-processus.
//
// Le biais est volontaire et vaut partout : dans le doute, on ne laisse pas
// passer.
//
// ⚠ Portée réelle, mesurée en sondant `hermes acp` directement : l'adaptateur
// ne soumet à autorisation que les modifications de fichiers (`kind: 'edit'`,
// et seulement hors de l'espace de travail). Les commandes de terminal
// (`kind: 'execute'`) partent sans jamais passer par ici. Cette politique ne
// peut donc pas les arrêter — et l'interface le dit à l'utilisateur plutôt que de
// laisser croire le contraire.

/** Ce que l'ACP annonce comme intention : lire, modifier, exécuter… */
export const KINDS_LECTURE = new Set(['read', 'fetch', 'search', 'think']);
export const KINDS_ECRITURE = new Set(['edit', 'delete', 'move']);

/** Ce qu'on répond à une demande d'autorisation, ou « demander » pour la relayer. */
export function verdict(mode: LocalPermissionMode, kind: string): 'oui' | 'non' | 'demander' {
  switch (mode) {
    case 'tout':
      return 'oui';
    case 'lecture':
      // Il lit et propose ; tout ce qui touche à la machine est refusé.
      return KINDS_LECTURE.has(kind) ? 'oui' : 'non';
    case 'ecritures':
      // Les fichiers d'office : une écriture se répare. Lancer une commande
      // reste une décision, parce que ça peut ne pas se réparer.
      if (KINDS_LECTURE.has(kind) || KINDS_ECRITURE.has(kind)) return 'oui';
      return 'demander';
    case 'demander':
    default:
      return 'demander';
  }
}

/** Une option d'autorisation telle qu'Hermès la propose. */
export interface OptionAcp {
  optionId?: string;
  name?: string;
  kind?: string;
}

/**
 * Choisit l'option « autoriser » ou « refuser » dans la liste proposée.
 *
 * Rend `undefined` quand rien ne convient. Attention au repli « prends la
 * première » : il ne vaut que pour un accord. Appliqué à un refus, il
 * autoriserait l'action — l'appelant doit annuler le tour plutôt que ça.
 */
export function choisir(opts: OptionAcp[], autorise: boolean): string | undefined {
  const parKind = opts.find((o) => (autorise ? /^allow/ : /^reject/).test(String(o.kind ?? '')));
  if (parKind) return parKind.optionId;

  const mots = autorise ? /allow|accept|once|yes|proceed/i : /reject|deny|refus|no|cancel/i;
  const parNom = opts.find((o) => mots.test(`${o.name ?? ''}${o.optionId ?? ''}`));
  if (parNom) return parNom.optionId;

  return autorise ? opts[0]?.optionId : undefined;
}
