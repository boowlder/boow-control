import type { FastifyInstance } from 'fastify';
import { indexer, chercher, etatIndex } from '../memoire';
import { embeddingsDisponible } from '../memoire/serveur';

// La mémoire de recherche des projets, côté API. L'indexation est un travail de
// fond (peut durer) ; la recherche est instantanée une fois l'index en place.

let enCours = false;

export async function memoireRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/memoire/etat', async () => ({
    disponible: embeddingsDisponible(),
    enCours,
    ...(await etatIndex()),
  }));

  app.post('/api/memoire/indexer', async (_req, reply) => {
    if (!embeddingsDisponible()) return reply.code(503).send({ error: 'modèle d’empreintes absent' });
    if (enCours) return reply.code(409).send({ error: 'indexation déjà en cours' });
    enCours = true;
    try {
      const r = await indexer();
      return r;
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message.slice(0, 200) });
    } finally {
      enCours = false;
    }
  });

  app.get('/api/memoire/chercher', async (req, reply) => {
    const q = (req.query as { q?: string }).q?.trim();
    if (!q) return reply.code(400).send({ error: 'q requis' });
    try {
      return { resultats: await chercher(q, 8) };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message.slice(0, 200) });
    }
  });
}
