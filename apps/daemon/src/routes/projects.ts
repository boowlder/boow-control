import type { FastifyInstance } from 'fastify';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Liste les dossiers de travail proposables à Claude : les racines connues et
// leurs sous-dossiers directs. Sert au sélecteur de projet du cockpit (2 clics).

const ROOTS = [path.join(os.homedir(), 'projects'), path.join(os.homedir(), 'work')];

interface Projet {
  name: string;
  path: string;
  /** Racine dont il dépend (pour grouper à l'affichage). */
  root: string;
  /** Dépôt git ? (petit repère visuel) */
  git: boolean;
  mtime: number;
}

async function estGit(p: string): Promise<boolean> {
  try {
    return (await stat(path.join(p, '.git'))).isDirectory();
  } catch {
    return false;
  }
}

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async () => {
    const projets: Projet[] = [];

    for (const root of ROOTS) {
      let noms: string[];
      try {
        noms = await readdir(root);
      } catch {
        continue; // racine absente : on l'ignore silencieusement
      }

      // La racine elle-même est un choix valide.
      projets.push({
        name: path.basename(root),
        path: root,
        root,
        git: await estGit(root),
        mtime: 0,
      });

      for (const nom of noms) {
        if (nom.startsWith('.')) continue;
        const full = path.join(root, nom);
        try {
          const s = await stat(full);
          if (!s.isDirectory()) continue;
          projets.push({ name: nom, path: full, root, git: await estGit(full), mtime: s.mtimeMs });
        } catch {
          /* dossier illisible — on passe */
        }
      }
    }

    // Les racines d'abord, puis les projets les plus récemment touchés.
    projets.sort((a, b) => (a.mtime === 0 || b.mtime === 0 ? a.mtime - b.mtime : b.mtime - a.mtime));
    return { roots: ROOTS, projects: projets };
  });
}
