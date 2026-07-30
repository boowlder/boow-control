import type { BoowMode } from './protocol';

// Tâches programmées, uniques ou répétitives.
// Pas de calendrier : une simple liste où l'on voit quoi, quand, et ce que
// ça a donné la dernière fois. C'est ce que l'utilisateur a demandé.

export type Recurrence =
  | 'unique' // une seule fois, puis la routine s'éteint
  | 'horaire'
  | 'quotidien'
  | 'hebdomadaire'
  | 'mensuel';

export interface Routine {
  id: string;
  /** Nom court, affiché dans la liste. */
  titre: string;
  /** La consigne envoyée, telle quelle. */
  consigne: string;
  /** Dans quel mode elle s'exécute. */
  mode: BoowMode;
  recurrence: Recurrence;
  /** epoch ms de la prochaine exécution. */
  prochaine: number;
  actif: boolean;
  /** epoch ms de la dernière exécution. */
  derniere?: number;
  /** Résumé de ce qu'elle a donné la dernière fois. */
  dernierResultat?: string;
  dernierOk?: boolean;
  /** Une exécution est-elle en cours ? */
  encours?: boolean;
  cree: number;
}
