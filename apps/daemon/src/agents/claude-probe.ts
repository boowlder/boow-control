import os from 'node:os';
import path from 'node:path';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeCapabilities, ClaudeUsage, ClaudeUsageWindow } from '@boow/shared';

// Lecture des capacités réelles de l'installation Claude de la machine.
//
// Astuce : on ouvre une session dont l'entrée est un flux qui n'émet JAMAIS de
// message. Le CLI démarre et s'initialise, mais aucun appel au modèle n'est
// fait — donc zéro jeton consommé. On interroge, puis on ferme.

const CWD = process.env.BOOW_CLAUDE_CWD ?? path.join(os.homedir(), 'projects', 'boow-control');

/** Durée de validité du cache : les capacités bougent rarement. */
const CAPS_TTL = 15 * 60_000;
/** La consommation, elle, bouge à chaque usage. */
const USAGE_TTL = 60_000;
/** Une sonde met quelques secondes à démarrer : on ne la laisse pas traîner. */
const TIMEOUT = 30_000;

/**
 * Versions précédentes proposées dans « Plus de modèles ».
 * `supportedModels()` ne renvoie que les alias courants (sonnet, opus, haiku…) ;
 * ces identifiants-là existent bien mais restent à demander explicitement.
 * Si l'un disparaît du plan, l'appel échouera proprement — c'est le serveur
 * qui tranche, pas cette liste.
 */
const MODELES_ANCIENS: ClaudeCapabilities['modelesAnciens'] = [
  { value: 'claude-opus-4-7', displayName: 'Opus 4.7', description: 'Opus 4.7 · version précédente' },
  { value: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Opus 4.6 · version précédente' },
  { value: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: 'Sonnet 4.6 · version précédente' },
  { value: 'claude-opus-4-5', displayName: 'Opus 4.5', description: 'Opus 4.5 · version précédente' },
  { value: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5', description: 'Sonnet 4.5 · version précédente' },
];

let capsCache: ClaudeCapabilities | undefined;
let usageCache: ClaudeUsage | undefined;
/** Sonde en cours — évite d'en lancer dix en parallèle. */
let inflight: Promise<void> | undefined;

/** Un flux d'entrée qui ne produit rien : le CLI s'initialise et attend. */
async function* silence(): AsyncGenerator<never> {
  await new Promise((r) => setTimeout(r, TIMEOUT + 5_000));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), ms)),
  ]);
}

/** Normalise une fenêtre de consommation venue du SDK. */
function window(w: unknown): ClaudeUsageWindow | null {
  if (!w || typeof w !== 'object') return null;
  const o = w as { utilization?: number | null; resets_at?: string | null };
  return { pct: typeof o.utilization === 'number' ? o.utilization : null, resetsAt: o.resets_at ?? null };
}

/**
 * Ouvre une sonde, lit tout ce qui est lisible, remplit les deux caches.
 * Ne lève jamais : en cas d'échec, les caches portent le message d'erreur.
 */
async function probe(): Promise<void> {
  const now = Date.now();
  let q: Query | undefined;
  try {
    q = query({ prompt: silence(), options: { cwd: CWD, permissionMode: 'plan' } });

    const [models, commands, subagents, mcp, account] = await Promise.all([
      withTimeout(q.supportedModels(), TIMEOUT).catch(() => []),
      withTimeout(q.supportedCommands(), TIMEOUT).catch(() => []),
      withTimeout(q.supportedAgents(), TIMEOUT).catch(() => []),
      withTimeout(q.mcpServerStatus(), TIMEOUT).catch(() => []),
      withTimeout(q.accountInfo(), TIMEOUT).catch(() => undefined),
    ]);

    capsCache = {
      models: models.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
        resolvedModel: m.resolvedModel,
        supportsEffort: m.supportsEffort,
        effortLevels: m.supportedEffortLevels,
      })),
      modelesAnciens: MODELES_ANCIENS,
      skills: commands.map((c) => ({
        name: c.name,
        description: c.description ?? '',
        argumentHint: c.argumentHint || undefined,
      })),
      subagents: subagents.map((a) => ({ name: a.name, description: a.description ?? '', model: a.model })),
      mcp: (mcp as Array<{ name?: string; status?: string }>).map((s) => ({
        name: s.name ?? '?',
        status: s.status ?? 'inconnu',
      })),
      account: account
        ? {
            email: account.email,
            organization: account.organization,
            subscriptionType: account.subscriptionType,
          }
        : undefined,
      fetchedAt: now,
    };

    // API expérimentale, susceptible de disparaître : on la teste avant d'appeler.
    const lire = (q as unknown as Record<string, unknown>)
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof lire === 'function') {
      try {
        const u = (await withTimeout(
          (lire as () => Promise<Record<string, any>>).call(q),
          TIMEOUT,
        )) as Record<string, any>;
        const rl = u?.rate_limits ?? null;
        usageCache = {
          available: !!u?.rate_limits_available && !!rl,
          subscription: u?.subscription_type ?? null,
          fiveHour: window(rl?.five_hour),
          sevenDay: window(rl?.seven_day),
          fetchedAt: now,
        };
      } catch (e) {
        usageCache = { available: false, fetchedAt: now, error: (e as Error).message };
      }
    } else {
      usageCache = { available: false, fetchedAt: now, error: 'non exposé par cette version du SDK' };
    }
  } catch (e) {
    const error = (e as Error).message || 'lecture impossible';
    capsCache = { models: [], modelesAnciens: MODELES_ANCIENS, skills: [], subagents: [], mcp: [], fetchedAt: now, error };
    usageCache = { available: false, fetchedAt: now, error };
  } finally {
    try {
      q?.close();
    } catch {
      /* déjà fermée */
    }
  }
}

/** Lance une sonde, en réutilisant celle qui tourne déjà le cas échéant. */
function sonder(): Promise<void> {
  if (!inflight) {
    inflight = probe().finally(() => {
      inflight = undefined;
    });
  }
  return inflight;
}

export async function claudeCapabilities(force = false): Promise<ClaudeCapabilities> {
  if (force || !capsCache || Date.now() - capsCache.fetchedAt > CAPS_TTL) await sonder();
  return capsCache ?? { models: [], modelesAnciens: MODELES_ANCIENS, skills: [], subagents: [], mcp: [], fetchedAt: 0 };
}

export async function claudeUsage(force = false): Promise<ClaudeUsage> {
  if (force || !usageCache || Date.now() - usageCache.fetchedAt > USAGE_TTL) await sonder();
  return usageCache ?? { available: false, fetchedAt: 0 };
}

/** Valeurs en cache sans déclencher de sonde (pour un envoi immédiat au front). */
export function cachedCapabilities(): ClaudeCapabilities | undefined {
  return capsCache;
}
export function cachedUsage(): ClaudeUsage | undefined {
  return usageCache;
}

/** Force la prochaine lecture d'usage à repartir du serveur (après un run Claude). */
export function invalidateUsage(): void {
  if (usageCache) usageCache = { ...usageCache, fetchedAt: 0 };
}
