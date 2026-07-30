import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import type { AgentState, LocalAgentConfig, LocalPermissionMode } from '@boow/shared';
import type { Bus } from '../bus';
import type { Registry } from '../registry';
import { config } from '../config';
import { nowLine } from '../now';
import { demanderPermission, libererPermissions } from '../permissions';
import { choisir, verdict } from './hermes-policy';

// Client ACP (Agent Client Protocol) : on spawn `hermes acp` et on parle
// JSON-RPC newline-delimited sur stdio. Shapes vérifiées via probe réel :
//   initialize -> session/new -> session/prompt
//   notifs session/update { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk'
//                                          | 'tool_call' | 'tool_call_update' | ... }
//   requête agent->client : session/request_permission (arbitrée par le mode
//   de travail — voir `hermes-policy.ts`).

const ID = 'hermes';
const CWD = process.env.BOOW_HERMES_CWD ?? path.join(os.homedir(), 'projects', 'boow-control');

type Json = Record<string, any>;

interface Acp {
  child: ChildProcess;
  idc: number;
  pending: Map<number, { resolve: (r: Json) => void; reject: (e: Json) => void }>;
  sessionId?: string;
  ready: Promise<void>;
  busy: boolean;
  stderr: string;
  // trackers d'état pour le prompt en cours
  cur: AgentState | '';
  curDetail: string;
  startedText: boolean;
  /** Texte du tour en cours — le mode opération a besoin du résultat, pas seulement de l'affichage. */
  capture: string;
  /** Fichiers déjà signalés ce tour : tool_call + tool_call_update rejouent la même écriture. */
  fichiersVus: Set<string>;
}

let acp: Acp | null = null;
let bus!: Bus;
let registry!: Registry;

const READ_KINDS = new Set(['read', 'fetch', 'search']);

// ── Mode de travail des locaux ──────────────────────────────────────────────
//
// Jusqu'ici, toute demande d'autorisation d'Hermès recevait « oui » sans que la
// question soit posée à l'utilisateur. Hermès demandait pourtant : son propre
// `approvals.mode` vaut `manual`. C'était donc le cockpit qui décidait à sa
// place. Ce réglage lui rend la décision.

// Position de départ : les fichiers passent, lancer une commande se demande.
// Ni l'ancien comportement (oui à tout, en silence) ni « me demander », qui
// ferait cliquer à chaque lecture de fichier — Hermès en fait beaucoup. La
// commande est la seule catégorie qui peut ne pas se réparer.
let localConfig: LocalAgentConfig = { permissionMode: 'ecritures' };

export function getLocalConfig(): LocalAgentConfig {
  return { ...localConfig };
}
export function setLocalPermissionMode(m: LocalPermissionMode): LocalAgentConfig {
  localConfig = { permissionMode: m };
  return getLocalConfig();
}

/** Ce que l'outil s'apprête à faire, en une ligne lisible. */
function resumer(tc: Json | undefined): string {
  const titre = String(tc?.title ?? tc?.kind ?? 'outil');
  const brut = tc?.rawInput as Record<string, unknown> | undefined;
  const txt = (k: string) => (typeof brut?.[k] === 'string' ? (brut[k] as string) : '');
  const detail = txt('command') || txt('file_path') || txt('path') || txt('url') || txt('query');
  return detail ? `${titre} · ${detail.slice(0, 140)}` : titre;
}

function write(a: Acp, o: Json): void {
  a.child.stdin!.write(JSON.stringify(o) + '\n');
}
function rpc(a: Acp, method: string, params: Json): Promise<Json> {
  const id = ++a.idc;
  return new Promise((resolve, reject) => {
    a.pending.set(id, { resolve, reject });
    write(a, { jsonrpc: '2.0', id, method, params });
  });
}
function notify(a: Acp, method: string, params: Json): void {
  write(a, { jsonrpc: '2.0', method, params });
}

function setState(a: Acp, state: AgentState, detail = ''): void {
  if (state !== a.cur || detail !== a.curDetail) {
    a.cur = state;
    a.curDetail = detail;
    registry.setState(ID, state, detail || undefined);
  }
}

function handleUpdate(a: Acp, update: Json | undefined): void {
  if (!update) return;
  const su = update.sessionUpdate as string;
  if (su === 'agent_message_chunk') {
    const text = update.content?.text ?? '';
    if (!text) return;
    if (!a.startedText) {
      a.startedText = true;
      setState(a, 'working', 'répond');
    }
    a.capture += text;
    bus.emit({ t: 'agent.log', id: ID, stream: 'assistant', chunk: text, ts: Date.now() });
  } else if (su === 'agent_thought_chunk') {
    setState(a, 'thinking', 'réfléchit');
  } else if (su === 'tool_call' || su === 'tool_call_update') {
    const title: string = update.title || update.kind || 'outil';
    const kind = String(update.kind);
    const isRead = READ_KINDS.has(kind) || /read|grep|search|glob|fetch|list/i.test(title);
    setState(a, isRead ? 'analyzing' : 'working', String(title).slice(0, 40));
    if (su === 'tool_call') bus.emit({ t: 'agent.log', id: ID, stream: 'system', chunk: `🔧 ${title}`, ts: Date.now() });
    // Ligne cliquable sous la réponse : une vraie écriture porte un `kind`
    // edit/delete/move et des `locations`. On dédoublonne au tour près.
    const ecrit = kind === 'edit' || kind === 'delete' || kind === 'move';
    if (ecrit && Array.isArray(update.locations)) {
      for (const loc of update.locations as Json[]) {
        const p = typeof loc?.path === 'string' ? loc.path : undefined;
        if (!p || a.fichiersVus.has(p)) continue;
        a.fichiersVus.add(p);
        const action = kind === 'edit' ? 'edit' : kind === 'delete' ? 'delete' : 'move';
        bus.emit({ t: 'agent.file', id: ID, path: p, action, ts: Date.now() });
      }
    }
    // Visualise la délégation Hermes -> Claude si l'outil invoque `claude`.
    const blob = JSON.stringify(update.rawInput ?? update).toLowerCase();
    if (blob.includes('claude')) {
      bus.emit({ t: 'agent.delegation', from: ID, to: 'claude-code', label: String(title).slice(0, 40) });
    }
  }
  // availableCommands / usage_update / plan / current_mode_update : ignorés ici.
}

function onLine(a: Acp, raw: string): void {
  const line = raw.trim();
  if (!line) return;
  let m: Json;
  try {
    m = JSON.parse(line);
  } catch {
    return; // une éventuelle ligne non-JSON
  }
  if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
    const p = a.pending.get(m.id);
    if (p) {
      a.pending.delete(m.id);
      if (m.error) p.reject(m.error);
      else p.resolve(m.result);
    }
    return;
  }
  if (m.method === 'session/update') {
    handleUpdate(a, m.params?.update);
    return;
  }
  if (m.method && m.id !== undefined) {
    // Requête agent -> client.
    if (m.method === 'session/request_permission') {
      void repondreAutorisation(a, m);
    } else {
      write(a, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unsupported' } });
    }
  }
}

async function repondreAutorisation(a: Acp, m: Json): Promise<void> {
  const opts: Json[] = m.params?.options ?? [];
  const tc: Json | undefined = m.params?.toolCall;
  const kind = String(tc?.kind ?? 'other');

  let autorise: boolean;
  const v = verdict(localConfig.permissionMode, kind);
  if (v === 'demander') {
    const avant = a.cur;
    setState(a, 'needs-input', String(tc?.title ?? kind).slice(0, 40));
    const r = await demanderPermission(bus, ID, kind, resumer(tc));
    autorise = r.autorise;
    if (a.busy) setState(a, (avant as AgentState) || 'working', autorise ? 'reprend' : 'refusé');
  } else {
    autorise = v === 'oui';
  }

  if (!autorise) {
    bus.emit({ t: 'agent.log', id: ID, stream: 'system', chunk: `⛔ refusé — ${resumer(tc)}`, ts: Date.now() });
  }

  const optionId = choisir(opts, autorise);
  // Aucune option de refus proposée : on annule le tour plutôt que d'autoriser.
  const outcome = optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' };
  write(a, { jsonrpc: '2.0', id: m.id, result: { outcome } });
}

async function ensure(): Promise<Acp> {
  if (acp && !acp.child.killed) {
    await acp.ready;
    return acp;
  }
  const child = spawn(config.bin.hermes, ['acp'], {
    cwd: CWD,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  const a: Acp = {
    child,
    idc: 0,
    pending: new Map(),
    busy: false,
    stderr: '',
    cur: '',
    curDetail: '',
    startedText: false,
    capture: '',
    fichiersVus: new Set(),
    ready: Promise.resolve(),
  };
  const rl = readline.createInterface({ input: child.stdout! });
  rl.on('line', (l) => onLine(a, l));
  child.stderr!.on('data', (d) => {
    a.stderr = (a.stderr + d.toString()).slice(-4000);
  });
  child.on('exit', () => {
    if (acp === a) acp = null;
    for (const p of a.pending.values()) p.reject({ message: 'ACP process exited' });
    a.pending.clear();
    registry.setState(ID, 'offline');
  });
  acp = a;

  a.ready = (async () => {
    await rpc(a, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    const sn = await rpc(a, 'session/new', { cwd: CWD, mcpServers: [] });
    a.sessionId = sn.sessionId;
  })();
  await a.ready;
  return a;
}

/** Résultat d'un tour Hermes — le texte sert au mode opération, l'affichage passe par le bus. */
export interface TourHermes {
  texte: string;
  erreur?: string;
}

export async function runHermes(b: Bus, r: Registry, _id: string, text: string): Promise<TourHermes> {
  bus = b;
  registry = r;
  let a: Acp;
  registry.setState(ID, 'thinking', 'connexion ACP…');
  try {
    a = await ensure();
  } catch (err) {
    const erreur = (err as Json)?.message ?? 'ACP indisponible';
    registry.setState(ID, 'error', erreur);
    bus.emit({ t: 'notice', level: 'error', text: `Hermes ACP: ${erreur}` });
    return { texte: '', erreur };
  }
  // Deux étapes Hermès qui s'enchaînent (créer un dossier puis écrire dedans)
  // peuvent arriver avant que le tour précédent ait fini de se libérer. Plutôt
  // que d'échouer sec, on laisse un court instant à Hermès pour se rendre libre.
  if (a.busy) {
    for (let i = 0; i < 20 && a.busy; i++) await new Promise((r) => setTimeout(r, 250));
    if (a.busy) {
      bus.emit({ t: 'notice', level: 'warn', text: 'Hermes est déjà occupé.' });
      return { texte: '', erreur: 'Hermes est déjà occupé.' };
    }
  }
  a.busy = true;
  a.cur = '';
  a.curDetail = '';
  a.startedText = false;
  a.capture = '';
  a.fichiersVus.clear();
  setState(a, 'thinking', 'réfléchit…');
  try {
    const res = await rpc(a, 'session/prompt', {
      sessionId: a.sessionId,
      prompt: [{ type: 'text', text: `[${nowLine()}]\n\n${text}` }],
    });
    const stop = String(res?.stopReason ?? 'end_turn');
    if (stop === 'cancelled') setState(a, 'idle', 'annulé');
    else setState(a, 'done', stop === 'end_turn' ? 'tour terminé' : stop);
    setTimeout(() => {
      if (acp === a && !a.busy) registry.setState(ID, 'idle');
    }, 1600);
    return stop === 'cancelled' ? { texte: a.capture, erreur: 'annulé' } : { texte: a.capture };
  } catch (err) {
    const erreur = (err as Json)?.message ?? 'échec';
    setState(a, 'error', erreur);
    bus.emit({ t: 'notice', level: 'error', text: `Hermes: ${erreur}` });
    return { texte: a.capture, erreur };
  } finally {
    a.busy = false;
    // Une question restée sans réponse ne doit pas survivre au tour.
    libererPermissions(bus, ID, 'Tour terminé.');
  }
}

export function cancelHermes(b?: Bus): void {
  if (acp?.sessionId) notify(acp, 'session/cancel', { sessionId: acp.sessionId });
  const busActuel = b ?? bus;
  if (busActuel) libererPermissions(busActuel, ID, 'Tâche annulée.');
}

export async function resetHermes(): Promise<void> {
  if (!acp) return;
  try {
    const sn = await rpc(acp, 'session/new', { cwd: CWD, mcpServers: [] });
    acp.sessionId = sn.sessionId;
  } catch {
    // si la session ne peut pas repartir, on relance le process au prochain message
    try {
      acp.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    acp = null;
  }
}

export function shutdownHermes(): void {
  try {
    acp?.child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  acp = null;
}
