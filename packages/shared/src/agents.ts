// Identité & états des agents du "Squad". Partagé front <-> daemon.

export type AgentId = string;

export type AgentKind =
  | 'orchestrator' // Hermes — le capitaine
  | 'engineer' // Claude Code — l'ingénieur
  | 'brain'; // Qwen local

export type AgentProvider =
  | 'claude-code'
  | 'hermes-acp'
  | 'qwen'
  | 'system';

/**
 * Les états animés pilotés par le back. L'ordre n'a pas d'importance,
 * mais la liste fait foi (le front mappe chaque état à un badge + une anim Spline).
 */
export const AGENT_STATES = [
  'idle',
  'listening',
  'thinking',
  'analyzing',
  'planning',
  'working',
  'delegating',
  'spawning',
  'done',
  'error',
  'needs-input',
  'offline',
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

/** Métadonnées stables d'un agent (son "casting"). */
export interface AgentMeta {
  id: AgentId;
  name: string;
  kind: AgentKind;
  provider: AgentProvider;
  /** Couleur d'accent UI (hex). */
  accent: string;
  /** Couleur des yeux — signe distinctif du perso (hex). */
  eyes: string;
  /** Outil emblématique (clé, pinceau, bâton de chef...). */
  tool: string;
  tagline: string;
  /** Le daemon sait-il joindre cet agent ? */
  online: boolean;
  /** Cet agent accepte-t-il un chat live dès maintenant ? */
  chattable: boolean;
}

/**
 * Le « mode de travail » de Claude : jusqu'où il peut aller seul.
 * - `default`           il demande avant chaque outil
 * - `acceptEdits`       il modifie les fichiers sans demander
 * - `plan`              il lit et propose, ne touche à rien
 * - `auto`              un classeur décide quoi autoriser
 * - `bypassPermissions` plus aucun garde-fou
 * - `dontAsk`           ne demande jamais, refuse ce qui n'est pas pré-autorisé
 */
export type ClaudePermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'auto'
  | 'dontAsk';

/**
 * Le « mode de travail » des agents locaux — jusqu'où Hermès peut aller seul.
 *
 * Hermès demande la permission avant d'agir : son propre `approvals.mode` vaut
 * `manual`. C'est le cockpit qui décidait de répondre « oui » à sa place, sans
 * jamais montrer la question. Ce réglage rend la décision à l'utilisateur.
 *
 * - `demander`  chaque outil passe par le cockpit
 * - `ecritures` lecture et écriture de fichiers d'office, le reste se demande
 * - `lecture`   il lit et propose, tout ce qui modifie est refusé
 * - `tout`      plus aucun garde-fou (le comportement d'avant ce réglage)
 */
export type LocalPermissionMode = 'demander' | 'ecritures' | 'lecture' | 'tout';

/** Config « à chaud » des agents locaux. */
export interface LocalAgentConfig {
  permissionMode: LocalPermissionMode;
}

/** Niveaux d'effort de réflexion acceptés par le SDK. */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Config "à chaud" d'un agent Claude Code (pilotée depuis l'UI). */
export interface ClaudeAgentConfig {
  /** Alias (sonnet/opus/haiku) ou id complet. */
  model: string;
  /** low | medium | high | xhigh | max — optionnel (défaut du modèle sinon). */
  effort?: string;
  permissionMode: ClaudePermissionMode;
  /** Répertoire de travail de l'ingénieur. */
  cwd: string;
  /** Plafond de tours d'agent (--max-turns). 0/undefined = illimité. */
  maxTurns?: number;
  /** Session Claude en cours (pour --resume). */
  sessionId?: string;
  /** Une tâche tourne-t-elle ? */
  busy: boolean;
  /** Une clé API Anthropic est-elle configurée côté daemon ? (la clé elle-même n'est jamais diffusée) */
  hasApiKey?: boolean;
  /** Le CLI claude est-il authentifié (login/clé) ? undefined = inconnu. */
  authed?: boolean;
  /** Coût cumulé de la session en cours, en dollars. */
  costUsd?: number;
  /** Tours d'agent cumulés sur la session en cours. */
  turns?: number;
}

// ── Capacités réelles de l'installation Claude (lues via le SDK) ─────────────

export interface ClaudeModelInfo {
  value: string;
  displayName: string;
  /** Ex. « Opus 4.8 · Best for everyday tasks » — le numéro de version est ici. */
  description?: string;
  /** Identifiant réel derrière l'alias, ex. `opus` → `claude-opus-4-8`. */
  resolvedModel?: string;
  supportsEffort?: boolean;
  effortLevels?: ClaudeEffort[];
}

export interface ClaudeSkillInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface ClaudeSubagentInfo {
  name: string;
  description: string;
  model?: string;
}

export interface ClaudeMcpInfo {
  name: string;
  status: string;
}

/**
 * Ce que l'installation Claude de la machine sait faire.
 * Lu sans envoyer le moindre message — donc sans consommer de jetons.
 */
export interface ClaudeCapabilities {
  models: ClaudeModelInfo[];
  /**
   * Versions précédentes, à choisir explicitement. Le SDK ne les liste pas
   * (il ne renvoie que les alias courants) : c'est une liste tenue à la main.
   * Le serveur reste juge — une version retirée du plan sera simplement refusée.
   */
  modelesAnciens: ClaudeModelInfo[];
  skills: ClaudeSkillInfo[];
  subagents: ClaudeSubagentInfo[];
  mcp: ClaudeMcpInfo[];
  account?: { email?: string; organization?: string; subscriptionType?: string };
  /** epoch ms de la dernière lecture. */
  fetchedAt: number;
  /** Message d'erreur si la lecture a échoué. */
  error?: string;
}

/** Une fenêtre de consommation de l'abonnement (5 h ou 7 jours). */
export interface ClaudeUsageWindow {
  /** Pourcentage consommé, 0-100. */
  pct: number | null;
  /** ISO 8601 de la remise à zéro. */
  resetsAt: string | null;
}

/** Consommation réelle de l'abonnement Claude. */
export interface ClaudeUsage {
  /** false pour une clé API ou un fournisseur tiers : pas de plafond de plan. */
  available: boolean;
  subscription?: string | null;
  fiveHour?: ClaudeUsageWindow | null;
  sevenDay?: ClaudeUsageWindow | null;
  fetchedAt: number;
  error?: string;
}

/** État runtime courant d'un agent. */
export interface AgentRuntimeState {
  id: AgentId;
  state: AgentState;
  detail?: string;
  taskId?: string;
  /** epoch ms du dernier changement d'état. */
  since: number;
}
