import type { AgentMeta, AgentRuntimeState, AgentState } from '@boow/shared';
import type { Bus } from './bus';

// Le "casting" du Squad. Couleurs d'yeux + outil = signature lisible de chaque agent.
const SEED: AgentMeta[] = [
  {
    id: 'hermes',
    name: 'Hermes',
    kind: 'orchestrator',
    provider: 'hermes-acp',
    accent: '#f5b14c',
    eyes: '#ffb627',
    tool: 'bâton de chef',
    tagline: 'Le capitaine — orchestre et distribue.',
    online: false,
    chattable: true,
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'engineer',
    provider: 'claude-code',
    accent: '#5b9dff',
    eyes: '#4f8cff',
    tool: 'clé & visière',
    tagline: "L'ingénieur — construit en streaming.",
    online: false,
    chattable: true,
  },
  {
    id: 'qwen',
    name: 'Cerveau local',
    kind: 'brain',
    provider: 'qwen',
    accent: '#7fa88f',
    eyes: '#2ee6a6',
    tool: 'cœur de calcul',
    tagline: 'Le cerveau local — répond en direct.',
    online: true,
    chattable: true,
  },
  {
    // L'œil n'est pas un agent séparé : c'est le modèle de vision que le
    // cerveau charge quand une image est jointe. Il figure quand même dans
    // l'équipe, parce que c'est ce que l'utilisateur voit — un membre qui lit les
    // images. Il partage l'état du cerveau : même serveur, même carte.
    id: 'oeil',
    name: 'Œil local',
    kind: 'brain',
    provider: 'qwen',
    accent: '#c79a4e',
    eyes: '#ffc46b',
    tool: 'loupe',
    tagline: "L'œil — lit les images et les captures.",
    online: true,
    chattable: false,
  },
];

/** Registre d'agents + machine d'états. Chaque transition est diffusée sur le bus. */
export class Registry {
  private agents = new Map<string, AgentMeta>();
  private states = new Map<string, AgentRuntimeState>();

  constructor(private bus: Bus) {
    for (const a of SEED) {
      this.agents.set(a.id, { ...a });
      this.states.set(a.id, {
        id: a.id,
        state: a.online ? 'idle' : 'offline',
        since: Date.now(),
      });
    }
  }

  list(): AgentMeta[] {
    return [...this.agents.values()];
  }

  allStates(): AgentRuntimeState[] {
    return [...this.states.values()];
  }

  get(id: string): AgentMeta | undefined {
    return this.agents.get(id);
  }

  setOnline(id: string, online: boolean): void {
    const a = this.agents.get(id);
    if (!a || a.online === online) return;
    a.online = online;
    if (!online) this.setState(id, 'offline');
    else if (this.states.get(id)?.state === 'offline') this.setState(id, 'idle');
  }

  setState(id: string, state: AgentState, detail?: string, taskId?: string): void {
    if (!this.agents.has(id)) return;
    const next: AgentRuntimeState = { id, state, detail, taskId, since: Date.now() };
    this.states.set(id, next);
    this.bus.emit({ t: 'agent.state', id, state, detail, taskId, since: next.since });
  }

  removeAgent(id: string): void {
    this.agents.delete(id);
    this.states.delete(id);
  }
}
