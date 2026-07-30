import type { FastifyInstance } from 'fastify';
import { config } from '../config';

/**
 * Interroge le routeur llama-server : quels cerveaux existent, lequel est chargé.
 * En mode routeur, GET /models renvoie { data: [{ id, status: { value } }] }
 * avec value ∈ loaded | unloaded | error. En mode mono-modèle (pas de routeur),
 * le même endpoint répond sans champ `status` : on retombe alors en mode direct.
 */
export async function routerState(): Promise<{ routerUp: boolean; active: string[]; known: string[] }> {
  const base = config.endpoints.brain.replace(/\/v1\/?$/, '');
  try {
    const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { routerUp: false, active: [], known: [] };
    const j = (await r.json()) as { data?: Array<{ id?: string; status?: { value?: string } }> };
    const rows = j.data ?? [];
    const routerUp = rows.some((m) => m.status?.value !== undefined);
    return {
      routerUp,
      active: rows.filter((m) => m.status?.value === 'loaded' && m.id).map((m) => m.id as string),
      known: rows.filter((m) => m.id).map((m) => m.id as string),
    };
  } catch {
    // Cerveau injoignable : ni routeur, ni modèle direct.
    return { routerUp: false, active: [], known: [] };
  }
}

/** État du multi-LLM local : cerveau(x) chargé(s) + cerveaux configurés. */
export async function brainsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/brains', async () => {
    const { routerUp, active, known } = await routerState();
    return {
      routerUp,
      // Conservé sous l'ancien nom : le front l'affiche encore.
      swapUp: routerUp,
      active,
      known,
      brains: config.brains, // { coder, vision, reasoning, fast }
    };
  });
}
