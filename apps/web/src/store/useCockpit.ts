import { create } from 'zustand';
import type {
  AgentId,
  AgentMeta,
  AgentRuntimeState,
  BoowMode,
  ClaudeAgentConfig,
  ClaudeCapabilities,
  ClaudeUsage,
  LocalAgentConfig,
  Operation,
  Routine,
  ServerEvent,
  SystemStatus,
  Task,
} from '@boow/shared';
import { STATE_META } from '../lib/state-meta';
import {
  charger as chargerSessions,
  enregistrer as enregistrerSessions,
  nouvelle as nouvelleSession,
  parMode,
  titreDepuis,
  SANS_TITRE,
  type Session,
} from './sessions';

/**
 * Les trois lieux de la barre latérale — et, depuis la refonte, les trois
 * seules pages. Les neuf onglets d'avant ont été absorbés : la conversation et
 * l'opération vivent dans Travail, les compétences dans le Répertoire des
 * Réglages, l'activité dans le journal repliable des réponses.
 */
export type Lieu = 'travail' | 'routines' | 'reglages';
export type TabId = Lieu;

export const LIEU_DE: Record<TabId, Lieu> = {
  travail: 'travail',
  routines: 'routines',
  reglages: 'reglages',
};

export const PAGE_DE: Record<Lieu, TabId> = {
  travail: 'travail',
  routines: 'routines',
  reglages: 'reglages',
};

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  streaming?: boolean;
  /** Début du message. Pour une réponse, c'est l'arrivée du premier mot. */
  ts: number;
  /**
   * Fin du flux, pour une réponse d'agent.
   *
   * `ts` seul ne dit que le délai avant le premier mot — sur un modèle chaud
   * c'est 0,2 s pour une réponse qui prend quinze secondes. Afficher ça comme
   * « durée » serait faux.
   */
  finTs?: number;
  /**
   * Bulle éphémère « le cerveau se réveille » : affichée quand la question
   * part vers un cerveau endormi, retirée dès le premier signe de vie.
   */
  reveil?: boolean;
  /** Fichiers créés/modifiés pendant cette réponse — lignes cliquables dessous. */
  fichiers?: { path: string; action: 'write' | 'edit' | 'delete' | 'move' }[];
}

export type ActivityKind = 'state' | 'delegation' | 'spawn' | 'despawn' | 'task' | 'notice';

export interface ActivityItem {
  id: string;
  ts: number;
  kind: ActivityKind;
  text: string;
  agentId?: AgentId;
  accent?: string;
}

export interface Toast {
  id: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface NotificationItem {
  id: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  ts: number;
  read: boolean;
}

export type SceneMode = '3d' | '2d';

/** Une autorisation d'outil qui attend une réponse de l'utilisateur. */
export interface PermissionAsk {
  reqId: string;
  agentId: AgentId;
  tool: string;
  summary: string;
  ts: number;
}

/** Effets transitoires consommés par la scène 3D (paquet de délégation, poof de spawn). */
export interface SceneEffect {
  id: string;
  kind: 'delegation' | 'spawn' | 'despawn';
  from?: AgentId;
  to?: AgentId;
  agentId?: AgentId;
  ts: number;
}

interface CockpitState {
  connected: boolean;
  agents: AgentMeta[];
  states: Record<AgentId, AgentRuntimeState>;
  system: SystemStatus | null;
  tasks: Task[];
  activity: ActivityItem[];
  toasts: Toast[];
  chats: Record<AgentId, ChatMsg[]>;
  /** Remplissage du contexte local par agent (la jauge du composeur). */
  contexts: Record<AgentId, { used: number; max: number; compacted?: boolean; ts: number }>;
  claudeConfigs: Record<AgentId, ClaudeAgentConfig>;
  /** Ce que l'installation Claude sait faire (modèles, compétences, MCP). */
  claudeCaps: ClaudeCapabilities | null;
  /** Consommation de l'abonnement (fenêtres 5 h et semaine). */
  claudeUsage: ClaudeUsage | null;
  /** Interrupteur maître : plus aucun appel à Claude. */
  localOnly: boolean;
  /** Jusqu'où Hermès peut aller seul. */
  localConfig: LocalAgentConfig;
  /** Autorisations d'outils en attente de réponse. */
  permissions: PermissionAsk[];
  /** Opérations, la plus récente en tête. */
  operations: Operation[];
  /** Tâches programmées. */
  routines: Routine[];
  artifacts: Record<AgentId, { name: string; content: string; ts: number }>;
  effects: SceneEffect[];
  sceneMode: SceneMode;
  /** Mode de travail : normal (local), opération, ClaudeCODE. */
  mode: BoowMode;
  setMode: (m: BoowMode) => void;
  /** Barre latérale dépliée ? */
  barreOuverte: boolean;
  basculerBarre: () => void;
  /** Toutes les conversations gardées, tous modes confondus. */
  sessions: Session[];
  /** Celle qui est ouverte. `chats` en est la copie de travail. */
  sessionId: string;
  demarrerSession: (mode?: BoowMode) => void;
  ouvrirSession: (id: string) => void;
  renommerSession: (id: string, titre: string) => void;
  supprimerSession: (id: string) => void;
  tab: TabId;
  selectedAgent: AgentId;
  paletteOpen: boolean;
  notifEnabled: boolean;
  soundEnabled: boolean;
  ttsEnabled: boolean;
  speakingAgent: AgentId | null;
  notifications: NotificationItem[];
  theme: Theme;
  setTheme: (t: Theme) => void;

  setTab: (t: TabId) => void;
  setSelectedAgent: (id: AgentId) => void;
  setSceneMode: (m: SceneMode) => void;
  setConnected: (c: boolean) => void;
  setPalette: (o: boolean) => void;
  togglePalette: () => void;
  setNotif: (o: boolean) => void;
  setSound: (o: boolean) => void;
  setTts: (o: boolean) => void;
  setSpeaking: (id: AgentId | null) => void;
  pushToast: (level: Toast['level'], text: string) => void;
  pushNotification: (level: Toast['level'], text: string) => void;
  markNotificationsRead: () => void;
  pushUserMessage: (id: AgentId, text: string) => void;
  dismissToast: (id: string) => void;
  applyEvent: (e: ServerEvent) => void;
}

/**
 * Repeint le cockpit à la couleur du mode : sauge en normal, or en opération,
 * terre cuite en ClaudeCODE.
 *
 * Ce n'est pas décoratif. La teinte dit d'un coup d'œil où l'on est, donc ce
 * que le prochain message va coûter — sans avoir à lire le sélecteur.
 */
export function appliquerAccent(m: BoowMode): void {
  const nom = m === 'operation' ? '--c-operation' : m === 'claude' ? '--c-claude' : '--c-local';
  try {
    document.documentElement.style.setProperty('--c-brand', `var(${nom})`);
  } catch {
    /* ignore */
  }
}

export type Theme = 'dark' | 'light';
export function applyTheme(t: Theme): void {
  try {
    document.documentElement.classList.toggle('theme-light', t === 'light');
  } catch {
    /* ignore */
  }
}
const initialTheme: Theme = (() => {
  try {
    return localStorage.getItem('boow.theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
})();

const ls = (k: string, parDefaut = false): boolean => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? parDefaut : v === '1';
  } catch {
    return parDefaut;
  }
};
const lset = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* ignore */
  }
};

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

// L'historique vivait dans une clé unique `boow.chats`, tous modes mélangés.
// Il est maintenant découpé en sessions (voir `sessions.ts`) : `chats` reste la
// copie de travail de la session ouverte, et `enregistrerEtat` la recopie dans
// la session avant d'écrire sur disque.

/** Reprend les anciennes conversations d'une clé `boow.chats` d'avant les sessions. */
const CHATS_KEY = 'boow.chats';
function reprendreAncienHistorique(): Session | null {
  try {
    const brut = JSON.parse(localStorage.getItem(CHATS_KEY) ?? 'null') as Record<string, ChatMsg[]> | null;
    if (!brut || !Object.keys(brut).length) return null;
    const s = nouvelleSession('normal');
    s.titre = 'Avant les sessions';
    for (const k of Object.keys(brut)) {
      s.chats[k] = (brut[k] ?? []).map((m) => (m.streaming ? { ...m, streaming: false } : m)).slice(-200);
    }
    localStorage.removeItem(CHATS_KEY);
    return s;
  } catch {
    return null;
  }
}

/**
 * Écrit la session ouverte sur disque. N'écrit *pas* dans le magasin : cette
 * fonction est appelée depuis un abonnement à chaque changement d'état, et un
 * `set` ici relancerait l'abonnement en boucle. Le magasin, lui, est remis à
 * jour au moment de changer de session — voir `deposer` plus bas.
 */
export function enregistrerEtat(): void {
  const { sessions, sessionId, chats } = useCockpit.getState();
  enregistrerSessions(sessions.map((s) => (s.id === sessionId ? { ...s, chats: sansEphemere(chats), vu: Date.now() } : s)));
}

/**
 * Retire les bulles éphémères avant d'écrire une session sur disque : la bulle
 * de réveil ne doit jamais survivre à un rechargement — elle réapparaîtrait
 * sous un vieux message, sans réponse.
 */
function sansEphemere(chats: Record<AgentId, ChatMsg[]>): Record<AgentId, ChatMsg[]> {
  const out: Record<string, ChatMsg[]> = {};
  for (const [id, list] of Object.entries(chats)) {
    const filtre = list.filter((m) => !m.reveil);
    out[id] = filtre.length === list.length ? list : filtre;
  }
  return out as Record<AgentId, ChatMsg[]>;
}

/** Range la copie de travail dans sa session avant d'en ouvrir une autre. */
function deposer(s: { sessions: Session[]; sessionId: string; chats: Record<AgentId, ChatMsg[]> }): Session[] {
  return s.sessions.map((x) => (x.id === s.sessionId ? { ...x, chats: sansEphemere(s.chats), vu: Date.now() } : x));
}

/** État de départ : sessions relues du disque, plus celle qu'on rouvre. */
function etatSessions(mode: BoowMode): { sessions: Session[]; sessionId: string; chats: Record<AgentId, ChatMsg[]> } {
  const sessions = chargerSessions();
  const ancien = sessions.length ? null : reprendreAncienHistorique();
  if (ancien) sessions.push(ancien);
  const reprise = parMode(sessions, mode)[0] ?? nouvelleSession(mode);
  if (!sessions.some((s) => s.id === reprise.id)) sessions.push(reprise);
  return { sessions, sessionId: reprise.id, chats: reprise.chats };
}

const modeInitial: BoowMode = ((): BoowMode => {
  try {
    const v = localStorage.getItem('boow.mode');
    return v === 'operation' || v === 'claude' ? v : 'normal';
  } catch {
    return 'normal';
  }
})();

const etatInitialSessions = etatSessions(modeInitial);

const ACTIVITY_CAP = 200;
const EFFECT_CAP = 16;

function pushActivity(arr: ActivityItem[], item: Omit<ActivityItem, 'id' | 'ts'>): ActivityItem[] {
  return [{ id: uid(), ts: Date.now(), ...item }, ...arr].slice(0, ACTIVITY_CAP);
}

function pushEffect(arr: SceneEffect[], item: Omit<SceneEffect, 'id' | 'ts'>): SceneEffect[] {
  return [{ id: uid(), ts: Date.now(), ...item }, ...arr].slice(0, EFFECT_CAP);
}

export const useCockpit = create<CockpitState>((set) => ({
  connected: false,
  agents: [],
  states: {},
  contexts: {},
  system: null,
  tasks: [],
  activity: [],
  toasts: [],
  claudeConfigs: {},
  claudeCaps: null,
  claudeUsage: null,
  localOnly: false,
  localConfig: { permissionMode: 'ecritures' },
  permissions: [],
  operations: [],
  routines: [],
  artifacts: {},
  effects: [],
  sceneMode: '3d',
  mode: modeInitial,
  setMode: (m) =>
    set((s) => {
      if (m === s.mode) return {};
      try {
        localStorage.setItem('boow.mode', m);
      } catch {
        /* ignore */
      }
      appliquerAccent(m);
      // Changer de mode change de tas : on range la conversation en cours et on
      // reprend la dernière du mode visé, ou on en ouvre une neuve.
      const sessions = deposer(s);
      const reprise = parMode(sessions, m)[0] ?? nouvelleSession(m);
      const toutes = sessions.some((x) => x.id === reprise.id) ? sessions : [...sessions, reprise];
      return { mode: m, sessions: toutes, sessionId: reprise.id, chats: reprise.chats };
    }),
  barreOuverte: ls('boow.barre', true),
  basculerBarre: () =>
    set((s) => {
      lset('boow.barre', !s.barreOuverte);
      return { barreOuverte: !s.barreOuverte };
    }),

  ...etatInitialSessions,
  demarrerSession: (mode) =>
    set((s) => {
      const m = mode ?? s.mode;
      const neuve = nouvelleSession(m);
      return { sessions: [...deposer(s), neuve], sessionId: neuve.id, chats: neuve.chats, mode: m, tab: 'travail' as TabId };
    }),
  ouvrirSession: (id) =>
    set((s) => {
      if (id === s.sessionId) return { tab: 'travail' as TabId };
      const sessions = deposer(s);
      const cible = sessions.find((x) => x.id === id);
      if (!cible) return {};
      appliquerAccent(cible.mode);
      return { sessions, sessionId: id, chats: cible.chats, mode: cible.mode, tab: 'travail' as TabId };
    }),
  renommerSession: (id, titre) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, titre: titre.trim() || SANS_TITRE } : x)),
    })),
  supprimerSession: (id) =>
    set((s) => {
      const restantes = s.sessions.filter((x) => x.id !== id);
      if (id !== s.sessionId) return { sessions: restantes };
      // On vient de supprimer celle qui était ouverte : on enchaîne sur la
      // suivante du même mode, sinon sur une page blanche.
      const reprise = parMode(restantes, s.mode)[0] ?? nouvelleSession(s.mode);
      const toutes = restantes.some((x) => x.id === reprise.id) ? restantes : [...restantes, reprise];
      return { sessions: toutes, sessionId: reprise.id, chats: reprise.chats };
    }),

  tab: 'travail',
  selectedAgent: 'qwen',
  paletteOpen: false,
  notifEnabled: ls('boow.notif'),
  soundEnabled: ls('boow.sound'),
  ttsEnabled: ls('boow.tts'),
  speakingAgent: null,
  notifications: [],
  theme: initialTheme,
  setTheme: (t) => {
    try {
      localStorage.setItem('boow.theme', t);
    } catch {
      /* ignore */
    }
    applyTheme(t);
    set({ theme: t });
  },

  setTab: (t) => set({ tab: t }),
  setSelectedAgent: (id) => set({ selectedAgent: id }),
  setSceneMode: (m) => set({ sceneMode: m }),
  setConnected: (c) => set({ connected: c }),
  setPalette: (o) => set({ paletteOpen: o }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setNotif: (o) => {
    lset('boow.notif', o);
    set({ notifEnabled: o });
  },
  setSound: (o) => {
    lset('boow.sound', o);
    set({ soundEnabled: o });
  },
  setTts: (o) => {
    lset('boow.tts', o);
    set({ ttsEnabled: o });
  },
  setSpeaking: (id) => set({ speakingAgent: id }),
  pushToast: (level, text) =>
    set((s) => ({ toasts: [...s.toasts, { id: uid(), level, text }].slice(-5) })),
  pushNotification: (level, text) =>
    set((s) => ({
      notifications: [{ id: uid(), level, text, ts: Date.now(), read: false }, ...s.notifications].slice(0, 50),
    })),
  markNotificationsRead: () =>
    set((s) => ({ notifications: s.notifications.map((n) => (n.read ? n : { ...n, read: true })) })),

  pushUserMessage: (id, text) =>
    set((s) => {
      const list = s.chats[id] ? [...s.chats[id]] : [];
      list.push({ id: uid(), role: 'user', text, ts: Date.now() });
      // La première phrase de l'utilisateur donne son nom à la session.
      const sessions = s.sessions.map((x) =>
        x.id === s.sessionId && x.titre === SANS_TITRE ? { ...x, titre: titreDepuis(text) } : x,
      );
      return { chats: { ...s.chats, [id]: list }, sessions };
    }),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  applyEvent: (e) =>
    set((s) => {
      const nameOf = (id: AgentId) => s.agents.find((a) => a.id === id)?.name ?? id;
      const accentOf = (id: AgentId) => s.agents.find((a) => a.id === id)?.accent;

      switch (e.t) {
        case 'hello': {
          const states: Record<AgentId, AgentRuntimeState> = {};
          for (const st of e.states) states[st.id] = st;
          return {
            agents: e.agents,
            states,
            system: e.system,
            tasks: e.tasks,
            localOnly: e.localOnly,
            localConfig: e.localConfig,
            operations: e.operations,
            routines: e.routines,
          };
        }

        case 'agent.state': {
          const states = {
            ...s.states,
            [e.id]: { id: e.id, state: e.state, detail: e.detail, taskId: e.taskId, since: e.since },
          };

          // Finalise les bulles assistant en cours quand l'agent s'arrête —
          // et retire une éventuelle bulle de réveil restée là (échec avant
          // le premier mot : elle mentirait).
          let chats = s.chats;
          if (e.state === 'done' || e.state === 'idle' || e.state === 'error') {
            const list = s.chats[e.id];
            if (list?.some((m) => m.streaming || m.reveil)) {
              const fin = Date.now();
              chats = {
                ...s.chats,
                [e.id]: list
                  .filter((m) => !m.reveil)
                  .map((m) => (m.streaming ? { ...m, streaming: false, finTs: fin } : m)),
              };
            }
          }

          // On garde la timeline lisible : pas de bruit idle/offline.
          let activity = s.activity;
          if (e.state !== 'idle' && e.state !== 'offline') {
            const label = STATE_META[e.state]?.label ?? e.state;
            activity = pushActivity(activity, {
              kind: 'state',
              text: `${nameOf(e.id)} · ${label}${e.detail ? ` — ${e.detail}` : ''}`,
              agentId: e.id,
              accent: accentOf(e.id),
            });
          }
          return { states, chats, activity };
        }

        case 'agent.log': {
          if (e.stream !== 'assistant' && e.stream !== 'system') return {};
          let list = s.chats[e.id] ? [...s.chats[e.id]] : [];
          // Le premier MOT de la réponse retire la bulle de réveil. Une ligne
          // système ne compte pas : « charge le modèle… » arrive précisément
          // PENDANT le réveil que la bulle est censée couvrir.
          if (e.stream === 'assistant') list = list.filter((m) => !m.reveil);
          const last = list[list.length - 1];
          if (e.stream === 'assistant' && last && last.role === 'assistant' && last.streaming) {
            list[list.length - 1] = { ...last, text: last.text + e.chunk };
          } else {
            // Ferme les bulles en cours, puis ouvre la nouvelle (assistant streamé / ligne système).
            for (let i = 0; i < list.length; i++) {
              if (list[i].streaming) list[i] = { ...list[i], streaming: false };
            }
            list.push({
              id: uid(),
              role: e.stream === 'system' ? 'system' : 'assistant',
              text: e.chunk,
              streaming: e.stream === 'assistant',
              ts: e.ts,
            });
          }
          return { chats: { ...s.chats, [e.id]: list } };
        }

        case 'agent.file': {
          // On accroche le fichier à la réponse en cours (ou à la dernière) :
          // c'est sous elle que la ligne cliquable apparaîtra.
          const list = s.chats[e.id] ? [...s.chats[e.id]] : [];
          let cible = -1;
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].role === 'assistant') {
              cible = i;
              break;
            }
          }
          // Aucune réponse encore : on ouvre une bulle porteuse (l'outil a parlé
          // avant le texte). Elle se remplira au premier mot.
          if (cible === -1) {
            list.push({ id: uid(), role: 'assistant', text: '', streaming: true, ts: e.ts, fichiers: [] });
            cible = list.length - 1;
          }
          const m = list[cible];
          const deja = m.fichiers ?? [];
          if (deja.some((f) => f.path === e.path && f.action === e.action)) return {};
          list[cible] = { ...m, fichiers: [...deja, { path: e.path, action: e.action }] };
          return { chats: { ...s.chats, [e.id]: list } };
        }

        case 'agent.context':
          return {
            contexts: { ...s.contexts, [e.id]: { used: e.used, max: e.max, compacted: e.compacted, ts: e.ts } },
          };

        case 'agent.delegation':
          return {
            effects: pushEffect(s.effects, { kind: 'delegation', from: e.from, to: e.to }),
            activity: pushActivity(s.activity, {
              kind: 'delegation',
              text: `${nameOf(e.from)} délègue à ${nameOf(e.to)}${e.label ? ` : ${e.label}` : ''}`,
              agentId: e.from,
              accent: accentOf(e.from),
            }),
          };

        case 'agent.spawn': {
          const agents = s.agents.some((a) => a.id === e.child.id)
            ? s.agents
            : [...s.agents, e.child];
          return {
            agents,
            states: {
              ...s.states,
              [e.child.id]: { id: e.child.id, state: 'spawning', since: Date.now() },
            },
            effects: pushEffect(s.effects, { kind: 'spawn', agentId: e.child.id }),
            activity: pushActivity(s.activity, {
              kind: 'spawn',
              text: `${nameOf(e.parent)} invoque ${e.child.name}`,
              agentId: e.child.id,
              accent: e.child.accent,
            }),
          };
        }

        case 'agent.despawn': {
          const label = nameOf(e.id);
          const { [e.id]: _drop, ...states } = s.states;
          return {
            agents: s.agents.filter((a) => a.id !== e.id),
            states,
            effects: pushEffect(s.effects, { kind: 'despawn', agentId: e.id }),
            activity: pushActivity(s.activity, {
              kind: 'despawn',
              text: `${label} s'efface`,
            }),
          };
        }

        case 'task.update': {
          const exists = s.tasks.some((t) => t.id === e.task.id);
          const tasks = exists
            ? s.tasks.map((t) => (t.id === e.task.id ? e.task : t))
            : [e.task, ...s.tasks];
          return {
            tasks,
            activity: pushActivity(s.activity, {
              kind: 'task',
              text: `Tâche : ${e.task.title} (${e.task.status})`,
            }),
          };
        }

        case 'agent.config':
          return { claudeConfigs: { ...s.claudeConfigs, [e.id]: e.config } };

        case 'agent.artifact':
          return { artifacts: { ...s.artifacts, [e.id]: { name: e.name, content: e.content, ts: e.ts } } };

        case 'agent.permission':
          return {
            permissions: [
              ...s.permissions.filter((p) => p.reqId !== e.reqId),
              { reqId: e.reqId, agentId: e.id, tool: e.tool, summary: e.summary, ts: e.ts },
            ],
            activity: pushActivity(s.activity, {
              kind: 'notice',
              text: `${nameOf(e.id)} demande l'autorisation : ${e.summary}`,
              agentId: e.id,
              accent: accentOf(e.id),
            }),
          };

        case 'agent.permission.done':
          return { permissions: s.permissions.filter((p) => p.reqId !== e.reqId) };

        case 'operation.update': {
          const existe = s.operations.some((o) => o.id === e.operation.id);
          return {
            operations: existe
              ? s.operations.map((o) => (o.id === e.operation.id ? e.operation : o))
              : [e.operation, ...s.operations],
          };
        }

        case 'routine.list':
          return { routines: e.routines };

        case 'claude.capabilities':
          return { claudeCaps: e.caps };

        case 'claude.usage':
          return { claudeUsage: e.usage };

        case 'local.only':
          return { localOnly: e.on };

        case 'local.config':
          return { localConfig: e.config };

        case 'chat.routed': {
          // Le daemon a choisi : on écrit le message dans SA conversation et on l'affiche.
          const list = s.chats[e.id] ? [...s.chats[e.id]] : [];
          list.push({ id: uid(), role: 'user', text: e.text, ts: Date.now() });
          // Cerveau endormi (la veille libère la mémoire vidéo après 5 min) :
          // sans cette bulle, la question reste 30 s sans le moindre signe de
          // vie et on croit à une panne. Elle part au premier mot reçu.
          const local = e.id === 'qwen' || e.id === 'hermes' || e.id === 'oeil';
          if (local && s.system?.cerveaux && s.system.cerveaux.actifs.length === 0) {
            list.push({
              id: uid(),
              role: 'system',
              reveil: true,
              text: 'Le cerveau se réveille — compte ~30 s avant la réponse (un peu plus la toute première fois).',
              ts: Date.now(),
            });
          }
          // Le message n'est pas passé par `pushUserMessage` : c'est le daemon
          // qui nous le renvoie. Sans ça, la session gardait son titre par
          // défaut à vie — visible au premier essai à l'écran.
          const sessions = s.sessions.map((x) =>
            x.id === s.sessionId && x.titre === SANS_TITRE ? { ...x, titre: titreDepuis(e.text) } : x,
          );
          return {
            chats: { ...s.chats, [e.id]: list },
            sessions,
            selectedAgent: e.id,
            activity: pushActivity(s.activity, {
              kind: 'delegation',
              text: `${nameOf(e.id)} prend la main — ${e.why}`,
              agentId: e.id,
              accent: accentOf(e.id),
            }),
          };
        }

        case 'system.status':
          return { system: e.system };

        case 'notice': {
          const toast: Toast = { id: uid(), level: e.level, text: e.text };
          return {
            toasts: [...s.toasts, toast].slice(-5),
            activity: pushActivity(s.activity, { kind: 'notice', text: e.text }),
          };
        }

        default:
          return {};
      }
    }),
}));
