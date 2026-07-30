import type { AgentId } from '@boow/shared';
import type { Bus } from './bus';

// Les demandes d'autorisation en attente d'une réponse de l'utilisateur.
//
// Ce mécanisme vivait dans `claude.ts` et n'était donc utilisable que par
// Claude. Hermès, lui, se voyait répondre « oui » automatiquement à tout, sans
// que la question soit jamais posée. Il est ici pour que les deux agents
// passent par le même guichet.

interface EnAttente {
  agentId: AgentId;
  resolve: (autorise: boolean, raison?: string) => void;
  minuteur: NodeJS.Timeout;
}

const enAttente = new Map<string, EnAttente>();

/** Sans réponse au bout de ce délai, on refuse : mieux vaut bloquer qu'agir seul. */
const DELAI = 300_000;

let n = 0;
function nouvelId(): string {
  return `p-${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Pose la question au cockpit et attend. Rend `true` si l'utilisateur autorise.
 * Ne lève jamais : un silence de cinq minutes vaut refus.
 */
export function demanderPermission(
  bus: Bus,
  agentId: AgentId,
  outil: string,
  resume: string,
): Promise<{ autorise: boolean; raison?: string }> {
  return new Promise((resolve) => {
    const reqId = nouvelId();
    const minuteur = setTimeout(() => {
      if (enAttente.delete(reqId)) {
        bus.emit({ t: 'agent.permission.done', id: agentId, reqId });
        resolve({ autorise: false, raison: "Pas de réponse de l'utilisateur (5 min)." });
      }
    }, DELAI);
    enAttente.set(reqId, {
      agentId,
      minuteur,
      resolve: (autorise, raison) => resolve({ autorise, raison }),
    });
    bus.emit({ t: 'agent.permission', id: agentId, reqId, tool: outil, summary: resume, ts: Date.now() });
  });
}

/** Réponse du cockpit. Rend `false` si la demande n'existait plus (délai dépassé). */
export function repondrePermission(reqId: string, autorise: boolean, raison?: string): AgentId | null {
  const p = enAttente.get(reqId);
  if (!p) return null;
  enAttente.delete(reqId);
  clearTimeout(p.minuteur);
  p.resolve(autorise, raison);
  return p.agentId;
}

/** Libère les demandes d'un agent qui s'arrête — aucune ne doit rester orpheline. */
export function libererPermissions(bus: Bus, agentId: AgentId, raison: string): void {
  for (const [reqId, p] of [...enAttente]) {
    if (p.agentId !== agentId) continue;
    enAttente.delete(reqId);
    clearTimeout(p.minuteur);
    p.resolve(false, raison);
    bus.emit({ t: 'agent.permission.done', id: agentId, reqId });
  }
}
