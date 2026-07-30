import type { AgentState } from '@boow/shared';

/** Pour chaque état : libellé FR + couleur sémantique + s'il est "actif" (anim). */
export const STATE_META: Record<AgentState, { label: string; color: string; active: boolean }> = {
  idle: { label: 'Au repos', color: '#8b97a8', active: false },
  listening: { label: 'Écoute', color: '#38bdf8', active: true },
  thinking: { label: 'Réflexion', color: '#a78bfa', active: true },
  analyzing: { label: 'Analyse', color: '#22d3ee', active: true },
  planning: { label: 'Planification', color: '#818cf8', active: true },
  working: { label: 'Au travail', color: '#34d399', active: true },
  delegating: { label: 'Délègue', color: '#fbbf24', active: true },
  spawning: { label: 'Invoque', color: '#e879f9', active: true },
  done: { label: 'Terminé', color: '#4ade80', active: false },
  error: { label: 'Erreur', color: '#f87171', active: false },
  'needs-input': { label: 'Attend ma décision', color: '#fb923c', active: true },
  offline: { label: 'Hors ligne', color: '#52606d', active: false },
};
