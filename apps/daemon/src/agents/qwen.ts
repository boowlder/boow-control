import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Bus } from '../bus';
import type { Registry } from '../registry';
import { config } from '../config';
import { nowLine } from '../now';
import { routerState } from '../routes/brains';
import { outilsPour, versOpenAI, type Outil, type OutilCtx } from '../outils/registre';
import { getLocalConfig } from './hermes';
import { verdict } from './hermes-policy';
import { demanderPermission } from '../permissions';
import { estimeTokens, planCompaction, reconstruireCarnet } from './qwen-compaction';

interface ToolCall {
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const histories = new Map<string, ChatMessage[]>();
const controllers = new Map<string, AbortController>();
// Le « carnet de session » par agent : le résumé, mis à jour et jamais réécrit
// depuis zéro, de tout ce qui a quitté la fenêtre de contexte (voir compacter).
const carnets = new Map<string, string>();

// ── Sessions longues : compaction glissante (chantier 14) ────────────────────
// À l'approche du plafond de contexte, on résume le PLUS ANCIEN dans le carnet
// et on repart léger. Répétable sans fin, sans partir « en vrille » grâce à
// quatre règles : le système jamais résumé, un seul carnet mis à jour (pas de
// résumé de résumé), la queue récente gardée mot pour mot, le carnet plafonné.
// Le découpage/reconstruction (part risquée) vit dans qwen-compaction.ts, testé.
const SEUIL_COMPACT = 0.8; // on compacte quand le contexte de base dépasse 80 %
const GARDER_RECENT = 6; // derniers messages gardés verbatim (≈ 3 échanges)

/** Fenêtre de contexte du modèle courant (tokens). `BOOW_BRAIN_CTX_FORCE`
 *  permet de la plafonner pour tous les modèles (réglage / test de compaction). */
function ctxDe(model: string): number {
  const force = Number(process.env.BOOW_BRAIN_CTX_FORCE) || 0;
  if (force > 0) return force;
  return config.brainCtx[model] ?? config.brainCtxDefault;
}

const BASE_PROMPT =
  'Tu es Qwen, le cerveau local du cockpit "boow control". ' +
  'Réponds de façon concise et utile, en français par défaut.';

// Consigne d'outils : sans elle, le modèle répond « de mémoire » même quand il
// devrait chercher (versions, prix, actualité) — vérifié à l'écran. On l'ajoute
// seulement quand des outils sont réellement offerts.
const PROMPT_OUTILS =
  ' Tu disposes d\'outils. Utilise recherche_web dès que la question porte sur ' +
  'des faits récents, des versions, des prix, l\'actualité, ou tout ce dont tu ' +
  'n\'es pas certain — ne devine pas, cherche. IMPORTANT : recherche_web ne rend ' +
  'que des extraits ; pour vraiment répondre (comparer, détailler), enchaîne avec ' +
  'lire_page sur 1 à 3 liens prometteurs, LIS leur contenu, puis fais TA synthèse ' +
  'avec une conclusion claire — ne te contente pas de recopier des liens. Utilise ' +
  'les outils fichiers pour lire ou écrire dans le dossier de travail quand on te ' +
  'le demande. Cite tes sources en liens Markdown à la fin.';

const systemPrompt = (avecOutils: boolean) =>
  `${BASE_PROMPT}${avecOutils ? PROMPT_OUTILS : ''}\n${nowLine()}`;

// ── Routage multi-cerveaux (un seul endpoint OpenAI ; llama-swap charge le bon modèle) ──
const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const REASON_RE = /\b(raisonn\w+|réfléch\w+|prouve|démontre|planifie|stratégie|step.?by.?step|chain.?of.?thought|analyse approfondie|étape par étape)\b/i;
const CODE_RE =
  /```|\b(code[rz]?|fonction|function|classe|class|méthode|bug|d[ée]bug\w*|debug|erreur|stack ?trace|refactor\w*|impl[ée]ment\w*|script|compil\w*|endpoint|regex|sql|algorithm\w*|algorithme|npm|pnpm|yarn|pip|docker|kubernetes|typescript|javascript|python|rust|golang|kotlin|react|vue|svelte|node\.?js)\b|\.(py|js|ts|tsx|jsx|rs|go|java|cpp|cs|sh|sql|html|css)\b/i;
// Question qui exige de l'info FRAÎCHE ou vérifiable → on force la recherche web
// (le modèle local a tendance à répondre de mémoire, parfois en inventant).
const BESOIN_WEB =
  /\b(cherche\w*|recherch\w*|regarde sur|sur (le web|internet|google)|actualit\w*|\bactus?\b|news|nouvelles|aujourd.?hui|derni[èe]re?s?|r[ée]cent\w*|en ce moment|ce matin|cette semaine|en \d{4}|cours (du|de|d')|prix (du|de|d')|combien coûte|tarif\w*|m[ée]t[ée]o|qui a gagn[ée]|r[ée]sultat\w*|classement|horaire\w*|vol\w*|billet\w*)\b|\b20(2[6-9]|3\d)\b/i;
interface Brain {
  kind: string;
  model: string;
  think: boolean;
}

/**
 * Routage automatique :
 *  - image jointe → vision
 *  - intention code (langage, ```, mots-clés) → coder 30B
 *  - raisonnement explicite demandé → 14b en mode *thinking*
 *  - sinon généraliste rapide → 14b *sans* thinking (réponse directe et vive)
 * Généraliste et raisonnement partagent le 14b : pas de swap GPU entre les deux.
 */
function pickBrain(text: string, hasImages: boolean): Brain {
  if (hasImages) return { kind: 'vision', model: config.brains.vision, think: false };
  if (CODE_RE.test(text)) return { kind: 'coder', model: config.brains.coder, think: false };
  if (REASON_RE.test(text)) return { kind: 'reasoning', model: config.brains.reasoning, think: true };
  return { kind: 'général', model: config.brains.reasoning, think: false };
}

/** Prévient via le flux système si le routeur doit d'abord charger le modèle (~15 s sur 1 GPU). */
async function announceLoadIfNeeded(bus: Bus, id: string, model: string): Promise<void> {
  try {
    const { routerUp, active } = await routerState();
    // Sans routeur (mode mono-modèle), il n'y a jamais de chargement à annoncer.
    if (!routerUp) return;
    const ready = active.includes(model);
    if (!ready) bus.emit({ t: 'agent.log', id, stream: 'system', chunk: `⏳ charge le modèle ${model}…`, ts: Date.now() });
  } catch {
    // Routeur injoignable — on n'annonce rien, la requête suit de toute façon.
  }
}

/** Lit un fichier image et le convertit en data-URL base64 (format vision OpenAI). */
async function toDataUrl(p: string): Promise<string | null> {
  try {
    const buf = await readFile(p);
    const ext = p.toLowerCase().split('.').pop() ?? '';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export function cancelChat(id: string): void {
  controllers.get(id)?.abort();
  controllers.delete(id);
}

export function resetQwen(id: string): void {
  histories.delete(id);
  carnets.delete(id);
}

/**
 * Résume, sur le modèle LOCAL (0 token Claude), le carnet actuel augmenté des
 * échanges qui débordent. On MET À JOUR le carnet — on ne le réécrit pas depuis
 * zéro — ce qui borne la dérive. Rendu factuel, structuré, serré.
 */
async function resumerCarnet(
  ancien: string,
  aIntegrer: ChatMessage[],
  brain: Brain,
  signal: AbortSignal,
): Promise<string> {
  const echanges = aIntegrer
    .map((m) => `${m.role === 'user' ? 'Vous' : m.role === 'assistant' ? 'Toi' : m.role}: ${m.content}`)
    .join('\n')
    .slice(0, 24_000);
  const consigne =
    'Tu es un archiviste. Mets à jour le CARNET DE SESSION en y intégrant les ' +
    'nouveaux échanges. Rends UNIQUEMENT le carnet à jour, en français, factuel ' +
    'et serré (400 mots MAX), sous ces rubriques quand elles ont du contenu : ' +
    'Objectif · Décisions · Fichiers/chemins · État · À faire · Préférences. ' +
    'Conserve les infos encore utiles de l\'ancien carnet, ajoute les nouvelles, ' +
    'enlève ce qui est périmé. N\'invente rien, ne commente pas.';
  const body = {
    model: brain.model,
    stream: false,
    temperature: 0.3,
    max_tokens: 700,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: 'system', content: consigne },
      { role: 'user', content: `CARNET ACTUEL:\n${ancien || '(vide)'}\n\nNOUVEAUX ÉCHANGES:\n${echanges}` },
    ],
  };
  const res = await fetch(`${config.endpoints.brain}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`compaction HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const texte = json.choices?.[0]?.message?.content?.trim();
  if (!texte) throw new Error('compaction : résumé vide');
  return texte;
}

/**
 * Compacte l'historique quand il approche du plafond : garde le système, un
 * carnet à jour et les derniers messages verbatim. Rend le nouvel historique
 * (ou l'ancien tel quel s'il n'y a rien d'assez vieux à résumer).
 */
async function compacter(id: string, history: ChatMessage[], brain: Brain, signal: AbortSignal): Promise<ChatMessage[] | null> {
  const { sys, ancien, milieu, recent } = planCompaction(history, carnets.get(id) ?? '', GARDER_RECENT);
  if (milieu.length === 0) return null; // rien d'assez vieux : on ne touche à rien

  const nouveau = await resumerCarnet(ancien, milieu as ChatMessage[], brain, signal);
  carnets.set(id, nouveau);
  return reconstruireCarnet(sys, nouveau, recent) as ChatMessage[];
}

/**
 * Chat live contre le cerveau Qwen (endpoint OpenAI-compatible).
 * Émet l'ÉTAT de l'agent (thinking -> working -> done) et stream l'assistant
 * token par token via `agent.log`. C'est la preuve de bout en bout du pipeline.
 */
export async function runQwenChat(
  bus: Bus,
  registry: Registry,
  id: string,
  text: string,
  attachments: string[] = [],
): Promise<void> {
  const images = attachments.filter((p) => IMG_EXT.test(p));

  // Routage automatique du cerveau. La recherche web n'est plus câblée en dur :
  // c'est devenu un OUTIL que le modèle appelle s'il en a besoin (9.3).
  const brain: Brain = pickBrain(text, images.length > 0);
  const avecVision = brain.kind === 'vision' && images.length > 0;

  const history = histories.get(id) ?? [];
  // (Ré)installe un message système à jour : date/heure courantes, et la
  // consigne d'outils seulement quand des outils sont réellement offerts.
  const sys = systemPrompt(!avecVision);
  if (history[0]?.role === 'system') history[0].content = sys;
  else history.unshift({ role: 'system', content: sys });
  history.push({ role: 'user', content: text });

  let reqMessages: unknown[] = history;
  if (avecVision) {
    const urls = (await Promise.all(images.map(toDataUrl))).filter((u): u is string => !!u);
    if (urls.length) {
      reqMessages = history.map((m, i) =>
        i === history.length - 1
          ? { role: 'user', content: [{ type: 'text', text }, ...urls.map((url) => ({ type: 'image_url', image_url: { url } }))] }
          : m,
      );
    }
  }

  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  registry.setState(id, 'thinking', 'réfléchit…');
  bus.emit({ t: 'agent.log', id, stream: 'system', chunk: `🧠 ${brain.kind} · ${brain.model}`, ts: Date.now() });
  await announceLoadIfNeeded(bus, id, brain.model);

  // Les outils : les mains des cerveaux locaux. Pas en vision (l'œil lit une
  // image, il n'agit pas), et le modèle reste libre de ne pas les appeler.
  const outils = avecVision ? [] : outilsPour(id);
  const ctx: OutilCtx = {
    cwd: process.env.BOOW_HERMES_CWD ?? path.join(os.homedir(), 'projects', 'boow-control'),
    bus,
    agentId: id,
    signal: ctrl.signal,
    demander: async (kind, resume) => {
      // Le mode de travail gouverne aussi les outils locaux — la promesse faite
      // à l'utilisateur : un seul réglage pour tous les cerveaux.
      const v = verdict(getLocalConfig().permissionMode, kind);
      if (v === 'oui') return true;
      if (v === 'non') return false;
      const r = await demanderPermission(bus, id, kind, resume);
      return r.autorise;
    },
  };

  // Le modèle local répond trop souvent « de mémoire » (parfois en inventant)
  // là où il faudrait chercher. Quand la question crie « info fraîche », on
  // FORCE la recherche au premier tour ; ensuite il est libre (lire, synthétiser).
  const forcerWeb = !avecVision && outils.length > 0 && BESOIN_WEB.test(text);

  try {
    const { text: assistant, promptTokens } = await boucleOutils(bus, registry, id, brain, reqMessages, outils, ctx, ctrl.signal, forcerWeb);
    history.push({ role: 'assistant', content: assistant });

    // Jauge : taille du contexte de base (mesure de l'API si dispo, sinon estime).
    const max = ctxDe(brain.model);
    const used = promptTokens ?? estimeTokens(history);
    bus.emit({ t: 'agent.context', id, used, max, ts: Date.now() });

    // Compaction glissante : au-delà du seuil, on résume l'ancien et on repart
    // léger. On ne coupe plus « aux 20 derniers messages » (perte aveugle) —
    // c'est la compaction qui borne désormais, par le sens.
    let stocke = history;
    if (used / max >= SEUIL_COMPACT) {
      registry.setState(id, 'working', 'compacte la session…');
      try {
        const compacte = await compacter(id, history, brain, ctrl.signal);
        if (compacte) {
          stocke = compacte;
          bus.emit({ t: 'agent.log', id, stream: 'system', chunk: '🔄 Session compactée, on continue.', ts: Date.now() });
          bus.emit({ t: 'agent.context', id, used: estimeTokens(compacte), max, compacted: true, ts: Date.now() });
        }
      } catch (e) {
        // Échec de compaction (modèle indispo, abort…) : on ne casse pas la
        // session, on garde un repli sûr (système + messages récents).
        if ((e as Error).name !== 'AbortError') {
          bus.emit({ t: 'notice', level: 'warn', text: `Compaction impossible : ${(e as Error).message}` });
          stocke = [history[0], ...history.slice(1).slice(-GARDER_RECENT * 2)];
        }
      }
    }
    histories.set(id, stocke);
    registry.setState(id, 'done');
    setTimeout(() => registry.setState(id, 'idle'), 1200);
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    registry.setState(id, aborted ? 'idle' : 'error', aborted ? undefined : (err as Error).message);
    if (!aborted) {
      bus.emit({ t: 'notice', level: 'error', text: `Qwen : ${(err as Error).message}` });
    }
  } finally {
    controllers.delete(id);
  }
}

/** Le résultat d'un tour de complétion streamé. */
interface Tour {
  content: string;
  toolCalls: ToolCall[];
  finish: string;
  /** Tokens du prompt envoyé ce tour (taille du contexte de base), si l'API les donne. */
  promptTokens?: number;
  /** Tokens totaux (prompt + réponse) ce tour, si l'API les donne. */
  totalTokens?: number;
}

/**
 * Un tour : streame la réponse token par token (contenu + réflexion) et
 * accumule les éventuels appels d'outils, qui arrivent eux aussi en fragments.
 */
async function streamRound(
  bus: Bus,
  registry: Registry,
  id: string,
  brain: Brain,
  messages: unknown[],
  outils: Outil[],
  signal: AbortSignal,
  /** Nom d'un outil à FORCER ce tour (le modèle local répond parfois de mémoire
   *  quand il devrait chercher : on l'y oblige au premier tour). */
  forceOutil?: string,
): Promise<Tour> {
  const body: Record<string, unknown> = {
    model: brain.model,
    stream: true,
    // Fait renvoyer un dernier chunk `usage` (prompt/total tokens) : c'est la
    // mesure exacte du remplissage du contexte, pour la jauge et la compaction.
    stream_options: { include_usage: true },
    temperature: 0.4,
    // Garde anti-répétition explicite : sur une longue réponse nourrie de
    // résultats web un peu bruités, le modèle pouvait partir en boucle de
    // charabia. 1.1 le tient sans brider sa prose.
    repeat_penalty: 1.1,
    messages,
    chat_template_kwargs: { enable_thinking: brain.think },
  };
  if (outils.length) {
    const forcable = forceOutil && outils.some((o) => o.nom === forceOutil);
    if (forcable) {
      // llama-server ignore le forçage par NOM (vérifié) mais honore
      // « required ». On ne présente donc QUE l'outil voulu, et on l'exige :
      // le modèle est alors obligé de l'appeler, pas de répondre de mémoire.
      body.tools = versOpenAI(outils.filter((o) => o.nom === forceOutil));
      body.tool_choice = 'required';
    } else {
      body.tools = versOpenAI(outils);
      body.tool_choice = 'auto';
    }
  }

  const res = await fetch(`${config.endpoints.brain}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  let content = '';
  let finish = '';
  let firstToken = true;
  let promptTokens: number | undefined;
  let totalTokens: number | undefined;
  const tcs: ToolCall[] = []; // indexés par position (delta.tool_calls[].index)
  const decoder = new TextDecoder();
  let buf = '';

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        // Le chunk d'usage arrive en dernier, souvent avec `choices: []`.
        if (json.usage) {
          promptTokens = json.usage.prompt_tokens ?? promptTokens;
          totalTokens = json.usage.total_tokens ?? totalTokens;
        }
        const choix = json.choices?.[0] ?? {};
        const d = choix.delta ?? {};
        if (choix.finish_reason) finish = choix.finish_reason;

        const pensee: string = d.reasoning_content ?? '';
        if (pensee) {
          registry.setState(id, 'thinking', 'réfléchit…');
          bus.emit({ t: 'agent.log', id, stream: 'thinking', chunk: pensee, ts: Date.now() });
        }

        // Les appels d'outils arrivent fragmentés : on recolle par index.
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? 0;
          tcs[i] ??= { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) tcs[i].id = tc.id;
          if (tc.function?.name) tcs[i].function!.name = tc.function.name;
          if (tc.function?.arguments) tcs[i].function!.arguments += tc.function.arguments;
        }

        const delta: string = d.content ?? '';
        if (!delta) continue;
        if (firstToken) {
          firstToken = false;
          registry.setState(id, 'working', 'rédige…');
        }
        content += delta;
        bus.emit({ t: 'agent.log', id, stream: 'assistant', chunk: delta, ts: Date.now() });
      } catch {
        // fragment SSE incomplet — on attend la suite
      }
    }
  }
  return { content, toolCalls: tcs.filter(Boolean), finish, promptTokens, totalTokens };
}

/** Emoji d'état par outil, pour la ligne système du fil. */
function icone(effet: string): string {
  return effet === 'read' ? '🔎' : effet === 'execute' ? '⚙️' : '✏️';
}

/**
 * La boucle de function calling : le modèle répond ou appelle des outils ; on
 * exécute, on rend les résultats, et on recommence jusqu'à une réponse finale.
 * Bornée pour ne jamais tourner sans fin.
 */
async function boucleOutils(
  bus: Bus,
  registry: Registry,
  id: string,
  brain: Brain,
  messages: unknown[],
  outils: Outil[],
  ctx: OutilCtx,
  signal: AbortSignal,
  /** Forcer recherche_web au tout premier tour (question qui exige du frais). */
  forcerWeb = false,
): Promise<{ text: string; promptTokens?: number }> {
  const MAX_TOURS = 6;
  const parNom = new Map(outils.map((o) => [o.nom, o]));
  const fil = [...messages];
  let dernierTexte = '';
  // Tokens du prompt au PREMIER tour : c'est la taille du contexte de base
  // (système + historique + message), celle qui grossit d'un tour à l'autre et
  // qu'on surveille pour la jauge et la compaction.
  let baseTokens: number | undefined;

  for (let tour = 0; tour < MAX_TOURS; tour++) {
    const force = tour === 0 && forcerWeb ? 'recherche_web' : undefined;
    const r = await streamRound(bus, registry, id, brain, fil, outils, signal, force);
    if (tour === 0) baseTokens = r.promptTokens;
    if (r.content) dernierTexte = r.content;

    if (r.toolCalls.length === 0) return { text: dernierTexte, promptTokens: baseTokens }; // réponse finale

    // On rejoue la décision du modèle, puis chaque résultat d'outil.
    fil.push({ role: 'assistant', content: r.content, tool_calls: r.toolCalls });
    for (const tc of r.toolCalls) {
      const nom = tc.function?.name ?? '';
      const outil = parNom.get(nom);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        /* arguments illisibles : on laisse vide, l'outil se plaindra */
      }
      const resume = `${nom}(${Object.values(args).join(', ').slice(0, 60)})`;
      bus.emit({ t: 'agent.log', id, stream: 'system', chunk: `${icone(outil?.effet ?? 'read')} ${resume}`, ts: Date.now() });
      registry.setState(id, 'working', nom);

      let resultat: string;
      if (!outil) resultat = `Outil inconnu : ${nom}`;
      else {
        try {
          resultat = await outil.executer(args, ctx);
        } catch (e) {
          resultat = `Erreur de l'outil : ${(e as Error).message}`;
        }
      }
      fil.push({ role: 'tool', tool_call_id: tc.id ?? nom, content: resultat.slice(0, 8000) });
    }
  }
  // Budget de tours épuisé : on rend ce qu'on a plutôt que rien.
  return { text: dernierTexte || 'Je me suis arrêté après plusieurs étapes sans conclure.', promptTokens: baseTokens };
}
