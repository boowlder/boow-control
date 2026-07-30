import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { analyserMcp, cibleValide, nomValide, sourceValide } from './repertoire-parse';
import type { ConnecteurInfo } from './repertoire-parse';
import { CATALOGUE, CATEGORIES, resumeCatalogue, connecteurParId, resoudreRecette } from '../repertoire/catalogue';
import { connecteursLocauxInstalles, installerConnecteurLocal, retirerConnecteurLocal } from '../outils/mcp';

// Le répertoire : ce que la machine sait faire, et ce qu'elle pourrait savoir.
//
// Tout vient du CLI `claude`, qui est la source de vérité — pas d'un catalogue
// recopié qui périmerait. Trois familles :
//   • plugins     `claude plugin list --available --json`  (259 dans l'officiel)
//   • connecteurs `claude mcp list`                        (serveurs MCP)
//   • places      `claude plugin marketplace list --json`  (dépôts de plugins)
//
// ⚠ Ces routes lancent des commandes avec des valeurs venues du navigateur.
// Elles passent TOUTES par `execFile` avec un tableau d'arguments — jamais par
// un shell. Un nom contenant `; rm -rf ~` est alors un simple argument, pas une
// commande. Les entrées sont en plus validées avant d'être transmises.

/** Une commande peut télécharger un dépôt : large, mais borné. */
const DELAI = 90_000;

interface Sortie {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function lancer(args: string[], delai = DELAI): Promise<Sortie> {
  return new Promise((resolve) => {
    execFile(config.bin.claude, args, { timeout: delai, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr || (err as Error | null)?.message || '') });
    });
  });
}

async function json<T>(args: string[], repli: T): Promise<T> {
  const r = await lancer(args);
  if (!r.ok) return repli;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return repli;
  }
}

export interface PluginInfo {
  pluginId: string;
  name: string;
  description?: string;
  marketplaceName?: string;
  installCount?: number;
  /** URL du dépôt, quand la source en donne une. */
  url?: string;
  installe: boolean;
}

export interface PlaceInfo {
  name: string;
  source?: string;
}

/**
 * Les connecteurs sont lus à part, et mis en cache.
 *
 * `claude mcp list` teste la santé de chaque serveur distant : avec vingt-deux
 * connecteurs, ça prend une quarantaine de secondes. Les mêler à la liste des
 * plugins ferait attendre tout le répertoire pour une seule de ses trois pages.
 */
const MCP_TTL = 60_000;
let mcpCache: { valeur: ReturnType<typeof analyserMcp>; vu: number } | undefined;
let mcpEnCours: Promise<ReturnType<typeof analyserMcp>> | undefined;

async function lireConnecteurs(force = false): Promise<ReturnType<typeof analyserMcp>> {
  if (!force && mcpCache && Date.now() - mcpCache.vu < MCP_TTL) return mcpCache.valeur;
  // Une seule sonde à la fois : dix ouvertures du répertoire ne doivent pas
  // lancer dix contrôles de santé en parallèle.
  if (!mcpEnCours) {
    mcpEnCours = lancer(['mcp', 'list'], 60_000)
      .then((r) => {
        const v = analyserMcp(r.stdout);
        mcpCache = { valeur: v, vu: Date.now() };
        void ecrireCacheDisque(v);
        return v;
      })
      .finally(() => {
        mcpEnCours = undefined;
      });
  }
  return mcpEnCours;
}

/**
 * La liste sans attendre. Les connecteurs de l'utilisateur viennent de son compte
 * claude.ai : aucun fichier local ne les liste — seul `claude mcp list` les
 * connaît, et il met une minute à tout sonder. Le daemon garde donc SON
 * cache disque du dernier contrôle complet : à l'ouverture on montre la
 * dernière photo (états compris), et le vrai contrôle repart en arrière-plan.
 * Seul le tout premier démarrage de la machine attend encore.
 */
const CHEMIN_CACHE = path.join(os.homedir(), '.boow', 'connecteurs.json');

async function ecrireCacheDisque(connecteurs: ConnecteurInfo[]): Promise<void> {
  try {
    await mkdir(path.dirname(CHEMIN_CACHE), { recursive: true });
    await writeFile(CHEMIN_CACHE, JSON.stringify({ vu: Date.now(), connecteurs }, null, 2));
  } catch {
    /* un cache qui ne s'écrit pas n'est pas une panne */
  }
}

async function listeInstantanee(): Promise<ConnecteurInfo[]> {
  try {
    const brut = await readFile(CHEMIN_CACHE, 'utf8');
    const j = JSON.parse(brut) as { connecteurs?: ConnecteurInfo[] };
    return j.connecteurs ?? [];
  } catch {
    return [];
  }
}

export async function repertoireRoutes(app: FastifyInstance): Promise<void> {
  // Le catalogue curé (chantier 12) : la liste de ce que les cerveaux — surtout
  // les LOCAUX — peuvent brancher, avec pour chaque connecteur son type (①/②/③)
  // et, pour les OAuth, la voie « jeton » qui les rend utilisables hors Claude.
  // Phase 1 : lecture seule, aucune installation lancée.
  app.get('/api/catalogue', async () => ({
    categories: CATEGORIES,
    connecteurs: CATALOGUE,
    resume: resumeCatalogue(),
    // Quels connecteurs LOCAUX sont déjà branchés (pour marquer les cartes).
    installesLocaux: await connecteursLocauxInstalles(),
  }));

  // Le dossier passé aux connecteurs qui prennent `{cwd}` (fichiers, git…).
  const BASE_CWD = path.join(os.homedir(), 'projects');

  // Installe un connecteur du catalogue sur les LOCAUX. Sécurité : la commande
  // et les arguments viennent du catalogue (code), jamais du navigateur ; seules
  // les VALEURS de secrets sont fournies par l'utilisateur, et passent par un spawn sans
  // shell (aucune injection possible).
  app.post('/api/catalogue/installer', async (req, reply) => {
    const b = (req.body ?? {}) as { id?: unknown; secrets?: unknown; cible?: unknown };
    const c = typeof b.id === 'string' ? connecteurParId(b.id) : undefined;
    if (!c) return reply.code(400).send({ error: 'connecteur inconnu' });
    if (!c.local) return reply.code(400).send({ error: 'ce connecteur n’a pas de voie locale (OAuth → Claude)' });

    const cible = b.cible === 'claude' ? 'claude' : 'locaux';
    const main = cible === 'claude' ? 'claude' : 'locaux';
    if (!c.mains.includes(main)) return reply.code(400).send({ error: `ce connecteur ne va pas sur « ${main} »` });

    // On ne retient QUE les secrets déclarés par le connecteur, en chaînes.
    const fournis = (b.secrets && typeof b.secrets === 'object' ? b.secrets : {}) as Record<string, unknown>;
    const valeurs: Record<string, string> = {};
    for (const s of c.local.secrets ?? []) {
      const v = fournis[s.cle];
      if (typeof v !== 'string' || !v.trim()) return reply.code(400).send({ error: `secret manquant : ${s.libelle}` });
      valeurs[s.cle] = v.trim();
    }

    const def = resoudreRecette(c, valeurs, BASE_CWD);
    if (!def) return reply.code(400).send({ error: 'recette locale absente' });
    try {
      if (cible === 'claude') {
        // On confie le même serveur à Claude via son CLI (source de vérité).
        const args = ['mcp', 'add', '--scope', 'user'];
        if (def.url) args.push('--transport', 'http', c.id, def.url);
        else {
          for (const [k, v] of Object.entries(def.env ?? {})) args.push('--env', `${k}=${v}`);
          args.push(c.id, '--', def.command!, ...(def.args ?? []));
        }
        const r = await lancer(args);
        if (!r.ok) return reply.code(500).send({ error: (r.stderr || r.stdout || 'échec claude mcp add').slice(0, 300) });
        return reply.send({ ok: true, cible });
      }
      const etat = await installerConnecteurLocal(def);
      const branche = etat && (await connecteursLocauxInstalles()).includes(c.id);
      return reply.send({ ok: true, cible, branche, outils: etat.outils, serveurs: etat.serveurs });
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.post('/api/catalogue/desinstaller', async (req, reply) => {
    const b = (req.body ?? {}) as { id?: unknown };
    if (typeof b.id !== 'string' || !connecteurParId(b.id)) return reply.code(400).send({ error: 'connecteur inconnu' });
    try {
      const etat = await retirerConnecteurLocal(b.id);
      return reply.send({ ok: true, outils: etat.outils, serveurs: etat.serveurs });
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.get('/api/repertoire/connecteurs', async (req) => {
    const q = req.query as { force?: string; instant?: string } | undefined;
    const force = q?.force === '1';
    if (q?.instant === '1') {
      // Cache santé frais → on le donne, il est complet. Sinon : la dernière
      // photo disque tout de suite, et le contrôle repart en arrière-plan.
      if (!force && mcpCache && Date.now() - mcpCache.vu < MCP_TTL) {
        return { connecteurs: mcpCache.valeur, sante: true };
      }
      void lireConnecteurs(force).catch(() => {});
      const photo = await listeInstantanee();
      // Rien sur disque (tout premier démarrage) : on attend le vrai contrôle,
      // une liste vide mentirait.
      if (photo.length === 0) return { connecteurs: await lireConnecteurs(force), sante: true };
      return { connecteurs: photo, sante: false };
    }
    return { connecteurs: await lireConnecteurs(force), sante: true };
  });

  app.get('/api/repertoire', async () => {
    const [plugins, places] = await Promise.all([
      json<{ installed?: unknown[]; available?: unknown[] }>(['plugin', 'list', '--available', '--json'], {}),
      json<unknown[]>(['plugin', 'marketplace', 'list', '--json'], []),
    ]);

    const brut = (x: unknown): Record<string, any> => (x && typeof x === 'object' ? (x as any) : {});
    const enPlugin = (x: unknown, installe: boolean): PluginInfo => {
      const p = brut(x);
      return {
        pluginId: String(p.pluginId ?? p.name ?? ''),
        name: String(p.name ?? p.pluginId ?? ''),
        description: p.description ? String(p.description) : undefined,
        marketplaceName: p.marketplaceName ? String(p.marketplaceName) : undefined,
        installCount: typeof p.installCount === 'number' ? p.installCount : undefined,
        url: typeof p.source?.url === 'string' ? p.source.url : undefined,
        installe,
      };
    };

    const installes = (plugins.installed ?? []).map((x) => enPlugin(x, true));
    const noms = new Set(installes.map((p) => p.name));
    const dispos = (plugins.available ?? [])
      .map((x) => enPlugin(x, false))
      .map((p) => (noms.has(p.name) ? { ...p, installe: true } : p));

    return {
      plugins: [...installes, ...dispos.filter((p) => !noms.has(p.name))],
      // Les connecteurs viennent de `/api/repertoire/connecteurs`, plus lent.
      places: (Array.isArray(places) ? places : []).map((x) => {
        const m = brut(x);
        const s = brut(m.source);
        return {
          name: String(m.name ?? '?'),
          source: s.repo ? String(s.repo) : s.url ? String(s.url) : undefined,
        } as PlaceInfo;
      }),
    };
  });

  app.post('/api/repertoire/plugin', async (req, reply) => {
    const b = (req.body ?? {}) as { action?: string; id?: unknown };
    if (!nomValide(b.id)) return reply.code(400).send({ error: 'identifiant invalide' });
    const args =
      b.action === 'uninstall' ? ['plugin', 'uninstall', b.id] : ['plugin', 'install', b.id, '--scope', 'user'];
    const r = await lancer(args);
    return reply.code(r.ok ? 200 : 500).send({ ok: r.ok, message: (r.stdout || r.stderr).slice(0, 600) });
  });

  app.post('/api/repertoire/place', async (req, reply) => {
    const b = (req.body ?? {}) as { action?: string; source?: unknown };
    if (!sourceValide(b.source)) return reply.code(400).send({ error: 'source invalide' });
    const args =
      b.action === 'remove'
        ? ['plugin', 'marketplace', 'remove', b.source]
        : ['plugin', 'marketplace', 'add', b.source];
    const r = await lancer(args);
    return reply.code(r.ok ? 200 : 500).send({ ok: r.ok, message: (r.stdout || r.stderr).slice(0, 600) });
  });

  app.post('/api/repertoire/connecteur', async (req, reply) => {
    const b = (req.body ?? {}) as { action?: string; nom?: unknown; cible?: unknown; transport?: unknown };
    if (!nomValide(b.nom)) return reply.code(400).send({ error: 'nom invalide' });

    if (b.action === 'remove') {
      const r = await lancer(['mcp', 'remove', b.nom]);
      if (r.ok) mcpCache = undefined;
      return reply.code(r.ok ? 200 : 500).send({ ok: r.ok, message: (r.stdout || r.stderr).slice(0, 600) });
    }

    if (!cibleValide(b.cible)) return reply.code(400).send({ error: 'adresse invalide' });
    const transport = b.transport === 'sse' ? 'sse' : 'http';
    // Seuls les serveurs distants s'ajoutent depuis le cockpit. Un serveur
    // `stdio` reviendrait à lancer un programme arbitraire depuis le navigateur.
    if (!/^https?:\/\//i.test(b.cible.trim())) {
      return reply.code(400).send({ error: 'seules les adresses http(s) sont acceptées ici' });
    }
    const r = await lancer(['mcp', 'add', '--transport', transport, b.nom, b.cible.trim()]);
    if (r.ok) mcpCache = undefined;
    return reply.code(r.ok ? 200 : 500).send({ ok: r.ok, message: (r.stdout || r.stderr).slice(0, 600) });
  });
}
