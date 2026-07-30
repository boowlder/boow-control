import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { enregistrerOutil, type Outil } from './registre';
import { webSearch, type SearchHit } from '../agents/websearch';
import { chercher as chercherProjets } from '../memoire';

// Les outils natifs : les « mains » de base des cerveaux locaux. Écrits ici,
// sans serveur externe. Ils donnent au mode normal ce qui lui manquait — voir
// sur le web, lire et écrire dans le dossier de travail — le modèle décidant
// lui-même quand s'en servir.

const RACINES = [path.join(os.homedir(), 'projects'), path.join(os.homedir(), 'work')];
function borne(cwd: string, rel: string): string {
  const base = path.resolve(cwd);
  const cible = path.resolve(base, rel.replace(/^~/, os.homedir()));
  const permis = [base, ...RACINES];
  if (!permis.some((r) => cible === r || cible.startsWith(r + path.sep))) {
    throw new Error('chemin hors du dossier de travail');
  }
  return cible;
}

const rechercheWeb: Outil = {
  nom: 'recherche_web',
  description:
    "Cherche sur le web et rends une liste de résultats (titre, lien, court extrait). C'est une PORTE D'ENTRÉE : pour vraiment répondre, enchaîne avec lire_page sur les liens les plus prometteurs afin de lire leur contenu, puis synthétise. Ne te contente pas de recopier les liens.",
  effet: 'read',
  parametres: {
    type: 'object',
    properties: { requete: { type: 'string', description: 'Les mots-clés à chercher' } },
    required: ['requete'],
  },
  async executer(args) {
    const requete = String(args.requete ?? '').trim();
    if (!requete) return 'Erreur : requête vide.';
    let hits: SearchHit[] = [];
    try {
      hits = await webSearch(requete, 5);
    } catch {
      hits = [];
    }
    if (!hits.length) {
      // Vraie absence de résultats (ou Chrome momentanément injoignable). Le
      // modèle le dit plutôt que d'inventer.
      return "Aucun résultat web (ou recherche momentanément indisponible). Réponds sur tes connaissances en le précisant.";
    }
    return hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.url}\n${h.snippet}`).join('\n\n');
  },
};

const lirePage: Outil = {
  nom: 'lire_page',
  description:
    "Ouvre une page web et rend son contenu texte lisible. À utiliser après recherche_web pour LIRE vraiment une page (article, fiche, doc) et pouvoir comparer/synthétiser, au lieu de rester sur les extraits.",
  effet: 'read',
  parametres: {
    type: 'object',
    properties: { url: { type: 'string', description: "L'adresse complète de la page (https://…)" } },
    required: ['url'],
  },
  async executer(args) {
    const url = String(args.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return 'Erreur : URL invalide (elle doit commencer par http).';
    try {
      const { chromeReadPage } = await import('../agents/websearch-chrome');
      return await chromeReadPage(url, 6000);
    } catch (e) {
      return `Impossible de lire la page : ${(e as Error).message}`;
    }
  },
};

const lireFichier: Outil = {
  nom: 'lire_fichier',
  description: 'Lit le contenu d’un fichier texte du dossier de travail. Donne le chemin relatif.',
  effet: 'read',
  parametres: {
    type: 'object',
    properties: { chemin: { type: 'string', description: 'Chemin relatif au dossier de travail' } },
    required: ['chemin'],
  },
  async executer(args, ctx) {
    const p = borne(ctx.cwd, String(args.chemin ?? ''));
    const contenu = await readFile(p, 'utf8');
    // On ne noie pas le modèle : un gros fichier est tronqué.
    return contenu.length > 12_000 ? `${contenu.slice(0, 12_000)}\n…(tronqué)` : contenu;
  },
};

const listerDossier: Outil = {
  nom: 'lister_dossier',
  description: 'Liste les fichiers et sous-dossiers d’un dossier de travail.',
  effet: 'read',
  parametres: {
    type: 'object',
    properties: { chemin: { type: 'string', description: 'Chemin relatif (vide = racine du dossier de travail)' } },
  },
  async executer(args, ctx) {
    const p = borne(ctx.cwd, String(args.chemin ?? '.'));
    const entrees = await readdir(p, { withFileTypes: true });
    return (
      entrees
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n') || '(dossier vide)'
    );
  },
};

const ecrireFichier: Outil = {
  nom: 'ecrire_fichier',
  description:
    'Crée ou remplace un fichier dans le dossier de travail. Demande une autorisation selon le mode de travail.',
  effet: 'edit',
  parametres: {
    type: 'object',
    properties: {
      chemin: { type: 'string', description: 'Chemin relatif au dossier de travail' },
      contenu: { type: 'string', description: 'Le contenu complet du fichier' },
    },
    required: ['chemin', 'contenu'],
  },
  async executer(args, ctx) {
    const rel = String(args.chemin ?? '');
    const p = borne(ctx.cwd, rel);
    const ok = await ctx.demander('edit', `écrire ${rel}`);
    if (!ok) return 'Refusé par l’utilisateur (mode de travail).';
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, String(args.contenu ?? ''));
    // Ligne cliquable sous la réponse, comme pour Hermès et Claude.
    ctx.bus.emit({ t: 'agent.file', id: ctx.agentId, path: p, action: 'write', ts: Date.now() });
    return `Fichier écrit : ${rel}`;
  },
};

const chercherDansProjets: Outil = {
  nom: 'chercher_projets',
  description:
    'Cherche dans TES propres projets (~/projects, ~/work) par le sens, pas juste les mots : « où ai-je fait ce composant ? ». Rend les fichiers les plus proches. Utile avant d’écrire du code pour réutiliser l’existant.',
  effet: 'read',
  parametres: {
    type: 'object',
    properties: { question: { type: 'string', description: 'Ce que tu cherches, en langage naturel' } },
    required: ['question'],
  },
  async executer(args) {
    const question = String(args.question ?? '').trim();
    if (!question) return 'Erreur : question vide.';
    let res;
    try {
      res = await chercherProjets(question, 8);
    } catch {
      return 'La mémoire de recherche n’est pas prête (index à construire ?).';
    }
    if (!res.length) return "Rien trouvé dans les projets (l'index est-il construit ?).";
    return res.map((r) => `${r.chemin} (proximité ${(r.score * 100).toFixed(0)}%)\n${r.extrait}`).join('\n\n');
  },
};

export function enregistrerOutilsNatifs(): void {
  for (const o of [rechercheWeb, lirePage, chercherDansProjets, lireFichier, listerDossier, ecrireFichier])
    enregistrerOutil(o);
}
