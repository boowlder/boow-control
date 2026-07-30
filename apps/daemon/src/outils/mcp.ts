import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { brancherMcp, type Outil } from './registre';

// Le daemon, client MCP. C'est ce qui transforme la boîte à outils en boîte
// OUVERTE : au lieu des seuls outils natifs, n'importe quel serveur MCP peut
// tendre ses outils aux cerveaux locaux — le même standard que Claude et
// ChatGPT. Deux transports : stdio (un programme local) et HTTP (une URL).
//
// Config : ~/.boow/mcp.json
//   { "serveurs": [
//       { "nom": "fichiers", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/USER/projects"] },
//       { "nom": "docs", "url": "https://exemple/mcp" }
//   ] }
//
// Prudence : un serveur qui ne répond pas ne doit jamais bloquer le daemon.
// Chaque connexion a un délai, et un échec est simplement noté.

interface DefServeur {
  nom: string;
  command?: string;
  args?: string[];
  url?: string;
  /** Variables d'environnement (② jeton). Le fichier est en 0600 : les secrets
   *  y vivent, protégés au niveau système plutôt que dispersés. */
  env?: Record<string, string>;
}

interface ServeurConnecte {
  nom: string;
  client: Client;
  outils: Outil[];
}

const CHEMIN = path.join(os.homedir(), '.boow', 'mcp.json');
const connectes: ServeurConnecte[] = [];

async function lireConfig(): Promise<DefServeur[]> {
  try {
    const brut = await readFile(CHEMIN, 'utf8');
    const j = JSON.parse(brut) as { serveurs?: DefServeur[] };
    return (j.serveurs ?? []).filter((s) => s.nom && (s.command || s.url));
  } catch {
    return [];
  }
}

async function connecter(def: DefServeur): Promise<ServeurConnecte | null> {
  const client = new Client({ name: 'boow-control', version: '2.0' }, { capabilities: {} });
  const transport = def.url
    ? new StreamableHTTPClientTransport(new URL(def.url))
    : new StdioClientTransport({
        command: def.command!,
        args: def.args ?? [],
        // On garde l'environnement courant (PATH pour trouver npx/uvx…) et on y
        // ajoute les secrets du connecteur. Sans ça, le programme ne démarre pas.
        ...(def.env ? { env: { ...(process.env as Record<string, string>), ...def.env } } : {}),
      });

  // Délai dur : un serveur qui traîne au démarrage ne fige pas le cockpit.
  const minuteur = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('délai de connexion dépassé')), 15_000));
  try {
    await Promise.race([client.connect(transport), minuteur]);
    const { tools } = await Promise.race([client.listTools(), minuteur]);
    const outils: Outil[] = tools.map((t) => envelopper(def.nom, client, t));
    return { nom: def.nom, client, outils };
  } catch {
    try {
      await client.close();
    } catch {
      /* rien à fermer */
    }
    return null;
  }
}

/** Un outil MCP présenté comme un outil natif : le modèle ne voit pas la différence. */
function envelopper(serveur: string, client: Client, t: { name: string; description?: string; inputSchema?: unknown }): Outil {
  return {
    // Préfixé du serveur : deux serveurs peuvent nommer un outil « search ».
    nom: `${serveur}__${t.name}`,
    description: t.description ?? `Outil ${t.name} du connecteur ${serveur}`,
    parametres: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    // On ignore ce que fait l'outil côté serveur : par prudence, tout appel MCP
    // est traité comme une écriture (passe par le mode de travail).
    effet: 'edit',
    async executer(args, ctx) {
      const ok = await ctx.demander('edit', `${serveur} · ${t.name}`);
      if (!ok) return 'Refusé par l’utilisateur (mode de travail).';
      const res = (await client.callTool({ name: t.name, arguments: args })) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      const texte = (res.content ?? [])
        .map((c) => (c.type === 'text' ? c.text : `[${c.type}]`))
        .join('\n')
        .slice(0, 8000);
      return texte || (res.isError ? 'Erreur du serveur MCP.' : '(réponse vide)');
    },
  };
}

/** Connecte tous les serveurs configurés. À appeler une fois au démarrage. */
export async function demarrerMcp(): Promise<{ serveurs: number; outils: number }> {
  const defs = await lireConfig();
  const resultats = await Promise.all(defs.map(connecter));
  for (const r of resultats) if (r) connectes.push(r);
  // On branche le fournisseur d'outils : le registre les inclura d'office.
  brancherMcp(() => connectes.flatMap((s) => s.outils));
  return { serveurs: connectes.length, outils: connectes.reduce((n, s) => n + s.outils.length, 0) };
}

export async function arreterMcp(): Promise<void> {
  await Promise.all(
    connectes.map((s) =>
      s.client.close().catch(() => {
        /* déjà fermé */
      }),
    ),
  );
  connectes.length = 0;
}

/** Pour l'UI : quels serveurs sont branchés et combien d'outils chacun. */
export function etatMcp(): { nom: string; outils: number }[] {
  return connectes.map((s) => ({ nom: s.nom, outils: s.outils.length }));
}

// ── Installation depuis le catalogue (chantier 12, phase 2) ─────────────────

async function ecrireConfig(defs: DefServeur[]): Promise<void> {
  await mkdir(path.dirname(CHEMIN), { recursive: true });
  await writeFile(CHEMIN, JSON.stringify({ serveurs: defs }, null, 2));
  // 0600 : ce fichier peut porter des jetons (connecteurs ②).
  try {
    await chmod(CHEMIN, 0o600);
  } catch {
    /* best effort : un chmod raté ne bloque pas l'installation */
  }
}

/** Les noms des connecteurs LOCAUX déjà installés (pour marquer le catalogue). */
export async function connecteursLocauxInstalles(): Promise<string[]> {
  return (await lireConfig()).map((d) => d.nom);
}

/** Recharge tous les serveurs (après un ajout ou un retrait). */
export async function rechargerMcp(): Promise<{ serveurs: number; outils: number }> {
  await arreterMcp();
  return demarrerMcp();
}

/** Installe (ou remplace) un connecteur local dans mcp.json, puis recharge. */
export async function installerConnecteurLocal(def: DefServeur): Promise<{ serveurs: number; outils: number }> {
  if (!def.nom || !(def.command || def.url)) throw new Error('définition de connecteur incomplète');
  const defs = (await lireConfig()).filter((d) => d.nom !== def.nom);
  defs.push(def);
  await ecrireConfig(defs);
  return rechargerMcp();
}

/** Retire un connecteur local de mcp.json, puis recharge. */
export async function retirerConnecteurLocal(nom: string): Promise<{ serveurs: number; outils: number }> {
  const defs = (await lireConfig()).filter((d) => d.nom !== nom);
  await ecrireConfig(defs);
  return rechargerMcp();
}
