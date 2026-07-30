import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { query, type Options, type PermissionResult, type Query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentState, ClaudeAgentConfig } from '@boow/shared';
import type { Bus } from '../bus';
import type { Registry } from '../registry';
import { config } from '../config';
import { nowLine } from '../now';
import { claudeUsage, invalidateUsage } from './claude-probe';
import { demanderPermission, libererPermissions } from '../permissions';

// Agent Claude via le Claude Agent SDK (remplace le lancement du CLI en
// sous-processus). Apports : sessions reprises proprement, streaming natif,
// demandes de permission remontées à l'interface, effort réglable, subagents.

const DEFAULT_CWD =
  process.env.BOOW_CLAUDE_CWD ?? path.join(os.homedir(), 'projects', 'boow-control');

function defaultConfig(): ClaudeAgentConfig {
  return { model: 'sonnet', permissionMode: 'acceptEdits', cwd: DEFAULT_CWD, busy: false };
}

const configs = new Map<string, ClaudeAgentConfig>();

// ── Interrupteur maître « tout local » ──────────────────────────────────────
// Quand il est actif, aucun appel à Claude ne part : le cockpit reste 100 % local.
let localOnly = false;
export function isLocalOnly(): boolean {
  return localOnly;
}
export function setLocalOnly(on: boolean): void {
  localOnly = on;
}

/** Clé API Anthropic optionnelle (mémoire seule, jamais diffusée ni persistée). */
let claudeApiKey: string | undefined = process.env.ANTHROPIC_API_KEY || undefined;
/** Dernier état d'authentification connu (login CLI ou clé). */
let claudeAuthed: boolean | undefined;

export function setClaudeApiKey(key: string): void {
  claudeApiKey = key.trim() || undefined;
  if (claudeApiKey) claudeAuthed = true;
}

export function getClaudeConfig(id: string): ClaudeAgentConfig {
  let c = configs.get(id);
  if (!c) {
    c = defaultConfig();
    configs.set(id, c);
  }
  return { ...c, hasApiKey: !!claudeApiKey, authed: claudeAuthed };
}

export function setClaudeConfig(id: string, patch: Partial<ClaudeAgentConfig>): ClaudeAgentConfig {
  const next = { ...getClaudeConfig(id), ...patch };
  configs.set(id, next);
  return next;
}

export function resetClaudeSession(id: string): void {
  // Nouvelle session = compteurs de coût et de tours remis à zéro.
  setClaudeConfig(id, { sessionId: undefined, costUsd: 0, turns: 0 });
}

/** Résumé lisible de ce qu'un outil s'apprête à faire. */
function summarize(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const fp = s('file_path') || s('path') || s('notebook_path');
  if (fp) return `${tool} · ${fp.replace(os.homedir(), '~')}`;
  const cmd = s('command');
  if (cmd) return `${tool} · ${cmd.slice(0, 120)}`;
  const url = s('url') || s('query');
  if (url) return `${tool} · ${url.slice(0, 120)}`;
  return tool;
}

// Outils « lecture » -> état analyse ; le reste -> travail.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'NotebookRead', 'TodoWrite']);

// Aucun persona spécifique : Claude Design a été retiré du Squad.
const PERSONAS: Record<string, string> = {};

const runs = new Map<string, Query>();

export function cancelClaude(bus: Bus, id: string): void {
  const q = runs.get(id);
  if (!q) return;
  void q.interrupt().catch(() => q.close());
  // Libère les permissions que cet agent attendait encore.
  libererPermissions(bus, id, 'Tâche annulée.');
}

/** Variables d'environnement du sous-processus Claude (clé API optionnelle). */
function claudeEnv(): Record<string, string> {
  const base = { ...process.env } as Record<string, string>;
  if (claudeApiKey) base.ANTHROPIC_API_KEY = claudeApiKey;
  return base;
}

/** Vérifie l'authentification par un appel minimal. */
export async function checkClaudeAuth(): Promise<boolean> {
  try {
    const q = query({
      prompt: 'ok',
      options: { maxTurns: 1, permissionMode: 'dontAsk', cwd: DEFAULT_CWD, env: claudeEnv() },
    });
    for await (const m of q) {
      if (m.type === 'result') {
        claudeAuthed = !(m as { is_error?: boolean }).is_error;
        q.close();
        return claudeAuthed;
      }
    }
    claudeAuthed = true;
  } catch {
    claudeAuthed = false;
  }
  return claudeAuthed ?? false;
}

/**
 * Lance Claude et traduit le flux du SDK en états + logs sur le bus.
 * Mappe : system/init -> thinking (+ capture de session), deltas texte ->
 * working, tool_use -> working/analyzing, result -> done/error.
 */
export async function runClaude(bus: Bus, registry: Registry, id: string, prompt: string): Promise<void> {
  if (localOnly) {
    bus.emit({
      t: 'notice',
      level: 'warn',
      text: "Mode « tout local » actif : aucun appel à Claude n'est envoyé.",
    });
    registry.setState(id, 'idle', 'tout local');
    return;
  }

  if (runs.has(id)) {
    bus.emit({ t: 'notice', level: 'warn', text: `${id} est déjà occupé.` });
    return;
  }

  const cfg = getClaudeConfig(id);
  const persona = [nowLine(), PERSONAS[id]].filter(Boolean).join('\n\n');

  const emitConfig = () => bus.emit({ t: 'agent.config', id, config: getClaudeConfig(id) });
  const log = (stream: 'assistant' | 'system' | 'thinking', chunk: string) =>
    bus.emit({ t: 'agent.log', id, stream, chunk, ts: Date.now() });

  // Objet plutôt que variables libres : TypeScript ne suit pas les mutations
  // faites dans une fermeture sur des `let`.
  const st: { state: AgentState | ''; detail: string } = { state: '', detail: '' };
  const setState = (state: AgentState, detail = '') => {
    if (state !== st.state || detail !== st.detail) {
      st.state = state;
      st.detail = detail;
      registry.setState(id, state, detail || undefined);
    }
  };

  // Demande de permission -> événement sur le bus, on attend la réponse du front.
  const canUseTool = async (tool: string, input: Record<string, unknown>): Promise<PermissionResult> => {
    setState('needs-input', tool);
    const { autorise, raison } = await demanderPermission(bus, id, tool, summarize(tool, input));
    return autorise ? { behavior: 'allow' } : { behavior: 'deny', message: raison || 'Refusé depuis le cockpit.' };
  };

  const options: Options = {
    model: cfg.model,
    cwd: cfg.cwd,
    permissionMode: cfg.permissionMode,
    includePartialMessages: true,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: persona },
    env: claudeEnv(),
    ...(cfg.effort ? { effort: cfg.effort as Options['effort'] } : {}),
    ...(cfg.maxTurns && cfg.maxTurns > 0 ? { maxTurns: cfg.maxTurns } : {}),
    ...(cfg.sessionId ? { resume: cfg.sessionId } : {}),
    // En mode « me demander », chaque outil passe par le cockpit.
    ...(cfg.permissionMode === 'default' ? { canUseTool } : {}),
  };

  setClaudeConfig(id, { busy: true });
  emitConfig();
  setState('thinking', 'démarre…');

  const pendingArtifacts = new Set<string>(); // fichiers HTML/SVG écrits ce tour
  let startedText = false;
  let sawResult = false;

  let q: Query;
  try {
    q = query({ prompt, options });
  } catch (err) {
    setClaudeConfig(id, { busy: false });
    emitConfig();
    setState('error', (err as Error).message);
    bus.emit({ t: 'notice', level: 'error', text: `Claude : ${(err as Error).message}` });
    return;
  }
  runs.set(id, q);

  try {
    for await (const msg of q) {
      const m = msg as Record<string, any>;

      if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') {
        setClaudeConfig(id, { sessionId: m.session_id });
        emitConfig();
        setState('thinking', `session ${String(m.session_id).slice(0, 8)}`);
        continue;
      }

      // Flux incrémental : texte, réflexion, démarrage d'outil.
      if (m.type === 'stream_event') {
        const ev = m.event ?? m.stream_event ?? {};
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          const tool = ev.content_block.name ?? 'outil';
          setState(READ_TOOLS.has(tool) ? 'analyzing' : 'working', tool);
          log('system', `🔧 ${tool}`);
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta ?? {};
          if (d.type === 'text_delta' && d.text) {
            if (!startedText) {
              startedText = true;
              setState('working', 'rédige');
            }
            log('assistant', d.text);
          } else if (d.type === 'thinking_delta') {
            setState('thinking', 'réfléchit');
          }
        }
        continue;
      }

      if (m.type === 'assistant') {
        const blocks = m.message?.content ?? [];
        for (const b of blocks) {
          if (b?.type === 'tool_use' && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(b.name ?? '')) {
            const fp = b.input?.file_path ?? b.input?.notebook_path;
            if (typeof fp === 'string') {
              if (/\.(html?|svg)$/i.test(fp)) pendingArtifacts.add(fp);
              // Ligne cliquable sous la réponse : « Write » crée, le reste modifie.
              bus.emit({ t: 'agent.file', id, path: fp, action: b.name === 'Write' ? 'write' : 'edit', ts: Date.now() });
            }
          }
        }
        // Filet : si le streaming n'a rien émis (message synthétique), on log le texte.
        if (!startedText) {
          const txt = blocks
            .filter((b: { type?: string }) => b?.type === 'text')
            .map((b: { text?: string }) => b.text ?? '')
            .join('')
            .trim();
          if (txt) log('assistant', txt);
        }
        continue;
      }

      if (m.type === 'result') {
        sawResult = true;
        if (m.is_error) {
          const txt = typeof m.result === 'string' && m.result ? m.result : String(m.subtype ?? 'échec');
          if (/not logged in|authentication|invalid api key/i.test(txt)) claudeAuthed = false;
          setState('error', txt.slice(0, 60));
          bus.emit({ t: 'notice', level: 'error', text: `Claude : ${txt.slice(0, 160)}` });
        } else {
          claudeAuthed = true;
          // Le SDK renvoie les totaux de la session, pas du tour : on remplace.
          const totalCost = typeof m.total_cost_usd === 'number' ? m.total_cost_usd : undefined;
          const totalTurns = typeof m.num_turns === 'number' ? m.num_turns : undefined;
          if (totalCost !== undefined || totalTurns !== undefined) {
            setClaudeConfig(id, {
              ...(totalCost !== undefined ? { costUsd: totalCost } : {}),
              ...(totalTurns !== undefined ? { turns: totalTurns } : {}),
            });
          }
          const cost = totalCost !== undefined ? `$${totalCost.toFixed(4)}` : '';
          setState('done', [`${m.num_turns ?? '?'} tours`, cost].filter(Boolean).join(' · '));
        }
      }
    }
  } catch (err) {
    const msg = (err as Error).message ?? 'échec';
    if (!/abort|interrupt/i.test(msg)) {
      setState('error', msg.slice(0, 60));
      bus.emit({ t: 'notice', level: 'error', text: `Claude : ${msg.slice(0, 160)}` });
    } else {
      setState('idle', 'annulé');
    }
  } finally {
    runs.delete(id);
    setClaudeConfig(id, { busy: false });
    emitConfig();
    // Aucune permission ne doit rester orpheline.
    libererPermissions(bus, id, 'Tour terminé.');
    if (!sawResult && st.state !== 'error' && st.state !== 'idle') setState('done', 'terminé');
    setTimeout(() => {
      if (!runs.has(id)) registry.setState(id, 'idle');
    }, 1800);
    // La jauge d'abonnement vient de bouger : on la relit en tâche de fond.
    invalidateUsage();
    void claudeUsage()
      .then((usage) => bus.emit({ t: 'claude.usage', usage }))
      .catch(() => {
        /* la jauge n'est pas critique */
      });
  }

  // Pousse les fichiers HTML/SVG écrits ce tour comme artefacts visuels.
  for (const fp of pendingArtifacts) {
    try {
      const content = await readFile(fp, 'utf8');
      if (content && content.length < 2_000_000) {
        bus.emit({ t: 'agent.artifact', id, name: path.basename(fp), content, ts: Date.now() });
      }
    } catch {
      /* fichier illisible — on ignore */
    }
  }
}

/** Résultat d'un appel unique à Claude, hors conversation. */
export interface AppelUnique {
  texte: string;
  coutUsd: number;
  erreur?: string;
  /** Session Claude, à repasser au prochain appel pour qu'il garde le fil. */
  sessionId?: string;
}

/**
 * Un aller-retour avec Claude, sans conversation ni outils.
 *
 * C'est la brique du mode opération : Claude dresse la carte, il ne la suit
 * pas. Sans outils et avec un seul tour, la dépense est bornée et prévisible —
 * ce qui est tout l'intérêt : Claude coûte cher, les modèles locaux non.
 */
export async function askClaudeOnce(
  prompt: string,
  opts: {
    systeme?: string;
    effort?: string;
    maxTurns?: number;
    cwd?: string;
    /** Session à reprendre — pour que Claude garde le fil d'une discussion. */
    sessionId?: string;
  } = {},
): Promise<AppelUnique> {
  if (localOnly) {
    return { texte: '', coutUsd: 0, erreur: '« Tout local » est activé : aucun appel à Claude.' };
  }

  // Modèle ET effort suivent ce que l'utilisateur a réglé dans le cockpit : sans ça,
  // le mode opération tournerait toujours au réglage par défaut, quoi qu'il
  // choisisse.
  const reglages = getClaudeConfig('claude-code');
  const effort = opts.effort ?? reglages.effort;

  const options: Options = {
    model: reglages.model,
    cwd: opts.cwd ?? DEFAULT_CWD,
    permissionMode: 'plan',
    // Aucun outil : Claude réfléchit et répond, il n'agit pas.
    tools: [],
    maxTurns: opts.maxTurns ?? 1,
    env: claudeEnv(),
    ...(opts.systeme ? { systemPrompt: opts.systeme } : {}),
    ...(effort ? { effort: effort as Options['effort'] } : {}),
    ...(opts.sessionId ? { resume: opts.sessionId } : {}),
  };

  // Trace le réglage réellement transmis : c'est le seul moyen de vérifier
  // depuis l'extérieur que le choix de l'utilisateur arrive bien jusqu'au SDK.
  console.log(`[claude] appel · modèle=${options.model} effort=${effort ?? 'défaut'}`);

  let texte = '';
  let coutUsd = 0;
  let erreur: string | undefined;
  let sessionId: string | undefined = opts.sessionId;

  try {
    const q = query({ prompt, options });
    for await (const msg of q) {
      const m = msg as Record<string, any>;
      if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') {
        sessionId = m.session_id;
      } else if (m.type === 'assistant') {
        for (const b of m.message?.content ?? []) {
          if (b?.type === 'text' && b.text) texte += b.text;
        }
      } else if (m.type === 'result') {
        if (typeof m.total_cost_usd === 'number') coutUsd = m.total_cost_usd;
        if (m.is_error) erreur = typeof m.result === 'string' ? m.result : String(m.subtype ?? 'échec');
        else claudeAuthed = true;
      }
    }
    q.close();
  } catch (e) {
    erreur = (e as Error).message || 'échec';
  }

  return { texte: texte.trim(), coutUsd, erreur, sessionId };
}

/** Arrête proprement toutes les sessions Claude (extinction du daemon). */
export function shutdownClaude(): void {
  for (const q of runs.values()) {
    try {
      q.close();
    } catch {
      /* ignore */
    }
  }
  runs.clear();
}

// `config` est importé pour rester cohérent avec le reste du daemon (chemins/binaires).
void config;
