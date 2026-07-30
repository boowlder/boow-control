// Le mode opération : Claude dresse la carte, les modèles locaux la suivent.
//
// L'idée tient en une image : Claude est le cartographe, pas le contremaître.
// Il est payé une fois pour dessiner le chemin ; ensuite le daemon conduit et
// les modèles locaux marchent. On ne le rappelle qu'en cas de vrai blocage.

/** Qui exécute une étape.
 *  - `local-texte` : un cerveau local rédige du texte ou du code (pas de mains).
 *  - `fichier` : le DAEMON écrit un fichier lui-même — instantané, sans réveiller
 *    Hermès. Il y met le résultat de l'étape précédente (le code produit).
 *  - `hermes` : l'agent avec les mains, réservé aux actions qui demandent du
 *    jugement (lancer un build, git, une modification fine…). Le plus lent. */
export type Executant = 'local-texte' | 'fichier' | 'hermes';

export type EtapeStatut = 'attente' | 'encours' | 'ok' | 'echec';

export type OperationStatut =
  | 'brainstorm' // on discute du projet avec Claude, rien n'est encore lancé
  | 'carte' // Claude transforme la discussion en carte
  | 'encours' // les étapes se déroulent
  | 'pause' // budget atteint ou blocage : attend l'utilisateur
  | 'termine'
  | 'echec'
  | 'arrete'; // stoppée à la main

/** Un message de la phase de discussion. */
export interface Echange {
  role: 'moi' | 'claude';
  texte: string;
  ts: number;
}

export interface OperationEtape {
  id: string;
  titre: string;
  /** Consigne transmise telle quelle à l'exécutant. */
  prompt: string;
  executant: Executant;
  /** Chemin du fichier à écrire — pour les étapes `fichier` (le daemon y met
   *  le résultat de l'étape précédente). */
  chemin?: string;
  /** Comment on saura que c'est réussi, en une phrase. */
  critere: string;
  /** Commande locale de vérification (optionnelle) — réussite = code de sortie 0. */
  verif?: string;
  statut: EtapeStatut;
  /** Nombre de tentatives déjà faites. */
  essais: number;
  /** Erreur, ou résumé de ce qui a été produit. */
  detail?: string;
}

export interface Operation {
  id: string;
  titre: string;
  /** La demande d'origine, mot pour mot. */
  objectif: string;
  statut: OperationStatut;
  /**
   * Appels à Claude autorisés pour la partie AUTOMATIQUE (carte, déblocages,
   * revue) — celle qui tourne sans l'utilisateur devant l'écran. Fixé par lui.
   * La discussion préalable n'est pas bridée : chaque message y est déclenché
   * par lui, donc aucun risque d'emballement.
   */
  budget: number;
  /** Appels à Claude consommés en tout, discussion comprise. */
  appelsClaude: number;
  /** Appels consommés par la partie automatique — c'est eux que `budget` limite. */
  appelsAuto: number;
  /** Dépense cumulée, en dollars. */
  coutUsd: number;
  /** La discussion qui a servi à construire la carte. */
  echanges: Echange[];
  /** Session Claude de la discussion, pour qu'il garde le fil. */
  sessionId?: string;
  etapes: OperationEtape[];
  /** Pourquoi c'est en pause ou en échec — en français simple. */
  message?: string;
  /** Revue finale par Claude demandée au lancement. */
  revueFinale: boolean;
  /** Texte de la revue finale, si elle a eu lieu. */
  revue?: string;
  debut: number;
  fin?: number;
}
