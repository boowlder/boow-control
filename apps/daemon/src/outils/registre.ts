import type { Bus } from '../bus';

// Le registre d'outils — la « boîte à outils » que le cockpit tend à ses
// cerveaux. Un outil est une fonction que le modèle peut décider d'appeler
// (function calling). Deux familles y vivent côte à côte :
//   • les outils NATIFS, écrits ici (recherche web, fichiers, mémoire projet) ;
//   • les outils MCP, empruntés à des serveurs externes (chantier 9.5).
// Les deux se présentent au modèle de la même façon — c'est tout l'intérêt du
// standard MCP : un outil est un outil, d'où qu'il vienne.

export interface OutilCtx {
  /** Dossier de travail courant : borne les outils fichiers. */
  cwd: string;
  bus: Bus;
  agentId: string;
  /** Signale qu'un outil demande une autorisation (mode de travail). */
  demander: (kind: string, resume: string) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface Outil {
  nom: string;
  description: string;
  /** JSON Schema des arguments, tel que l'API OpenAI l'attend. */
  parametres: Record<string, unknown>;
  /**
   * `read` = lecture pure · `edit`/`delete`/`move` = écriture (passe par le
   * mode de travail) · `execute` = commande. Décide de l'autorisation.
   */
  effet: 'read' | 'edit' | 'delete' | 'move' | 'execute';
  /** Fait le travail et rend un texte (le résultat lu par le modèle). */
  executer: (args: Record<string, unknown>, ctx: OutilCtx) => Promise<string>;
}

/** Forme d'un outil pour l'API OpenAI (`tools: [...]`). */
export interface OutilOpenAI {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const natifs = new Map<string, Outil>();

export function enregistrerOutil(o: Outil): void {
  natifs.set(o.nom, o);
}

/** Tous les outils disponibles pour un cerveau local (natifs + MCP actifs). */
export function outilsPour(_agentId: string): Outil[] {
  // Le filtrage par cible (Claude/locaux/Hermès) arrivera avec le registre
  // configurable (9.1). Pour l'instant : tous les natifs, pour les locaux.
  return [...natifs.values(), ...outilsMcpActifs()];
}

/** Liste pour l'UI/la recette : nom, description, origine (natif ou MCP). */
export function listerOutils(): { nom: string; description: string; effet: string; mcp: boolean }[] {
  const mcp = new Set(outilsMcpActifs().map((o) => o.nom));
  return outilsPour('qwen').map((o) => ({
    nom: o.nom,
    description: o.description,
    effet: o.effet,
    mcp: mcp.has(o.nom),
  }));
}

export function versOpenAI(outils: Outil[]): OutilOpenAI[] {
  return outils.map((o) => ({
    type: 'function',
    function: { name: o.nom, description: o.description, parameters: o.parametres },
  }));
}

// ── Crochet MCP (rempli par outils/mcp.ts au chantier 9.5) ───────────────────
let fournisseurMcp: () => Outil[] = () => [];
export function brancherMcp(fn: () => Outil[]): void {
  fournisseurMcp = fn;
}
function outilsMcpActifs(): Outil[] {
  try {
    return fournisseurMcp();
  } catch {
    return [];
  }
}
