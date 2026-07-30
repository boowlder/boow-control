// Contrat WebSocket front <-> daemon. Enveloppes discriminées par `t`.

import type {
  AgentId,
  AgentMeta,
  AgentRuntimeState,
  AgentState,
  ClaudeAgentConfig,
  ClaudeCapabilities,
  ClaudeUsage,
  LocalAgentConfig,
  LocalPermissionMode,
} from './agents';
import type { Task } from './tasks';
import type { Operation } from './operations';
import type { Recurrence, Routine } from './routines';

export type SystemServiceId =
  | 'brain'
  | 'chrome-cdp'
  | 'hermes'
  | 'claude';

export interface SystemService {
  id: SystemServiceId;
  label: string;
  url?: string;
  ok: boolean;
  detail?: string;
}

/** Mémoire vidéo de la carte, quand il y en a une. */
export interface GpuStatus {
  utiliseMo: number;
  totalMo: number;
  nom?: string;
}

export interface SystemStatus {
  services: SystemService[];
  /** Absent s'il n'y a pas de GPU NVIDIA joignable. */
  gpu?: GpuStatus;
  /**
   * Ce que le routeur a réellement en mémoire vidéo. `actifs` vide alors que
   * le service répond = tout dort : la prochaine question devra réveiller un
   * cerveau (~30 s). `oeil` nomme le modèle de vision, pour distinguer sa
   * pastille de celle du cerveau texte.
   */
  cerveaux?: { actifs: string[]; oeil: string };
  checkedAt: number;
}

/**
 * Les trois façons de se servir du cockpit.
 * - `normal`    : uniquement les modèles locaux, routés automatiquement
 * - `operation` : Claude dresse la carte, les modèles locaux l'exécutent
 * - `claude`    : conversation directe avec Claude Code
 */
export type BoowMode = 'normal' | 'operation' | 'claude';

export type LogStream =
  | 'stdout'
  | 'stderr'
  | 'thinking'
  | 'assistant'
  | 'system';

/** Évènements poussés par le daemon vers le front. */
export type ServerEvent =
  | {
      t: 'hello';
      agents: AgentMeta[];
      states: AgentRuntimeState[];
      system: SystemStatus;
      tasks: Task[];
      /** Interrupteur maître : quand il est actif, aucun appel à Claude n'est permis. */
      localOnly: boolean;
      /** Jusqu'où les agents locaux peuvent aller seuls. */
      localConfig: LocalAgentConfig;
      /** Opérations connues, la plus récente en tête. */
      operations: Operation[];
      /** Tâches programmées. */
      routines: Routine[];
    }
  | {
      t: 'agent.state';
      id: AgentId;
      state: AgentState;
      detail?: string;
      taskId?: string;
      since: number;
    }
  | {
      t: 'agent.log';
      id: AgentId;
      stream: LogStream;
      chunk: string;
      taskId?: string;
      ts: number;
    }
  | {
      // Un outil a créé ou modifié un fichier : le front en fait une ligne
      // cliquable sous la réponse. Seules les VRAIES écritures comptent, pas
      // les lectures — c'est décidé côté agent.
      t: 'agent.file';
      id: AgentId;
      path: string;
      action: 'write' | 'edit' | 'delete' | 'move';
      ts: number;
    }
  /** Remplissage du contexte local d'un agent (la jauge du composeur) :
   *  `used` tokens sur `max` (ctx-size du modèle). `compacted` = on vient de
   *  résumer l'ancien pour repartir léger — le front l'annonce dans le fil. */
  | { t: 'agent.context'; id: AgentId; used: number; max: number; compacted?: boolean; ts: number }
  | { t: 'agent.delegation'; from: AgentId; to: AgentId; taskId?: string; label?: string }
  | { t: 'agent.spawn'; parent: AgentId; child: AgentMeta; ttlMs?: number }
  | { t: 'agent.despawn'; id: AgentId }
  | { t: 'task.update'; task: Task }
  | { t: 'agent.config'; id: AgentId; config: ClaudeAgentConfig }
  | { t: 'agent.artifact'; id: AgentId; name: string; content: string; ts: number }
  /** Un agent demande l'autorisation d'utiliser un outil. Le front doit répondre
   *  par `permission.answer` avec le même `reqId`. */
  | {
      t: 'agent.permission';
      id: AgentId;
      reqId: string;
      tool: string;
      /** Résumé lisible de ce que l'outil va faire (chemin, commande…). */
      summary: string;
      ts: number;
    }
  /** La demande n'attend plus de réponse (répondue, annulée ou expirée). */
  | { t: 'agent.permission.done'; id: AgentId; reqId: string }
  /** Ce que l'installation Claude de la machine sait faire (modèles, compétences, MCP). */
  | { t: 'claude.capabilities'; caps: ClaudeCapabilities }
  /** Consommation de l'abonnement Claude (fenêtres 5 h et 7 jours). */
  | { t: 'claude.usage'; usage: ClaudeUsage }
  /** Nouvel état de l'interrupteur « tout local ». */
  | { t: 'local.only'; on: boolean }
  /** Réglages des agents locaux (mode de travail d'Hermès). */
  | { t: 'local.config'; config: LocalAgentConfig }
  /** Le daemon a choisi qui répond. Le front affiche la conversation de cet agent. */
  | {
      t: 'chat.routed';
      mode: BoowMode;
      id: AgentId;
      /** Explication courte du choix, à montrer à l'utilisateur. */
      why: string;
      /** Le message tel qu'il a été transmis à l'agent. */
      text: string;
    }
  /** État complet d'une opération — renvoyé à chaque changement. */
  | { t: 'operation.update'; operation: Operation }
  /** La liste des routines, renvoyée entière à chaque changement. */
  | { t: 'routine.list'; routines: Routine[] }
  | { t: 'system.status'; system: SystemStatus }
  | { t: 'notice'; level: 'info' | 'warn' | 'error'; text: string };

/** Commandes envoyées par le front au daemon. */
export type ClientCommand =
  | { t: 'chat.send'; id: AgentId; text: string; attachments?: string[] }
  /** Une seule barre de conversation : le daemon choisit l'agent selon le mode. */
  | { t: 'chat.route'; mode: BoowMode; text: string; attachments?: string[] }
  | { t: 'chat.cancel'; id: AgentId }
  | { t: 'chat.reset'; id: AgentId }
  | { t: 'task.create'; target: AgentId | 'auto'; title: string; prompt?: string }
  | { t: 'task.stop'; taskId: string }
  | {
      t: 'claude.config';
      id?: AgentId;
      model?: string;
      effort?: string;
      permissionMode?: import('./agents').ClaudePermissionMode;
      cwd?: string;
      maxTurns?: number;
    }
  /** Réponse à `agent.permission`, quel que soit l'agent qui demandait. */
  | { t: 'permission.answer'; reqId: string; allow: boolean; reason?: string }
  /** Jusqu'où les agents locaux peuvent aller seuls. */
  | { t: 'local.config'; permissionMode: LocalPermissionMode }
  /** Relit modèles / compétences / connecteurs MCP depuis l'installation Claude. */
  | { t: 'claude.capabilities.refresh' }
  /** Relit la consommation de l'abonnement. */
  | { t: 'claude.usage.refresh' }
  /**
   * Un message dans la discussion préparatoire avec Claude.
   * Sans `id`, une nouvelle opération démarre en phase de discussion.
   */
  | { t: 'operation.brainstorm'; id?: string; text: string }
  /**
   * « Ok, envoie aux locaux » : Claude change la discussion en carte, puis
   * les modèles locaux l'exécutent.
   */
  | { t: 'operation.carte'; id: string; budget: number; revueFinale: boolean }
  /** Lance sans discussion préalable — utilisé par les routines. */
  | { t: 'operation.start'; objectif: string; budget: number; revueFinale: boolean }
  /** Arrête une opération en cours. */
  | { t: 'operation.stop'; id: string }
  /** Repart d'une opération en pause, éventuellement avec du budget en plus. */
  | { t: 'operation.resume'; id: string; budgetSupplementaire?: number }
  /** Programme une tâche, unique ou répétitive. */
  | {
      t: 'routine.create';
      titre: string;
      consigne: string;
      mode: BoowMode;
      recurrence: Recurrence;
      /** epoch ms de la première exécution. */
      premiere: number;
    }
  /** Modifie une routine sans perdre son historique d'exécutions. */
  | {
      t: 'routine.update';
      id: string;
      titre?: string;
      consigne?: string;
      mode?: BoowMode;
      recurrence?: Recurrence;
      /** epoch ms de la prochaine exécution. */
      prochaine?: number;
    }
  /** Met une routine en pause ou la réactive. */
  | { t: 'routine.toggle'; id: string; actif: boolean }
  | { t: 'routine.delete'; id: string }
  /** Exécute une routine tout de suite, sans attendre son heure. */
  | { t: 'routine.run'; id: string }
  /** Interrupteur maître : coupe (ou rétablit) tout appel à Claude. */
  | { t: 'local.only'; on: boolean }
  | { t: 'system.refresh' }
  | { t: 'claude.apikey'; key: string }
  | { t: 'claude.auth.check' }
  | { t: 'ping' };
