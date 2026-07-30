import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentId, AgentState, Task } from '@boow/shared';
import type { Bus } from './bus';

const STATE_DIR = path.join(os.homedir(), '.boow');
const STATE_FILE = path.join(STATE_DIR, 'tasks.json');

/**
 * Suit les tâches routées vers un agent. Quand l'agent assigné passe à
 * `done`/`error`/`idle`, la tâche est clôturée automatiquement.
 */
export class TaskManager {
  private tasks = new Map<string, Task>();
  private active = new Map<AgentId, string>(); // agent -> taskId en cours

  constructor(private bus: Bus) {
    this.load();
    bus.subscribe((e) => {
      if (e.t === 'agent.state') this.onAgentState(e.id, e.state);
    });
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Recharge les tâches du disque ; celles "en cours" d'avant le redémarrage sont marquées stoppées. */
  private load(): void {
    try {
      const arr = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Task[];
      for (const t of arr) {
        const dead = t.status === 'running' || t.status === 'queued' || t.status === 'waiting';
        this.tasks.set(t.id, dead ? { ...t, status: 'stopped' } : t);
      }
    } catch {
      /* pas de fichier / corrompu — on démarre vide */
    }
  }

  private persist(): void {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, JSON.stringify(this.list()));
    } catch {
      /* ignore */
    }
  }

  create(target: AgentId | 'auto', assignedTo: AgentId, title: string): Task {
    const now = Date.now();
    const task: Task = {
      id: `t-${now.toString(36)}`,
      title,
      target,
      assignedTo,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.active.set(assignedTo, task.id);
    this.bus.emit({ t: 'task.update', task });
    this.persist();
    return task;
  }

  /** Stoppe une tâche en cours ; renvoie l'agent à annuler. */
  stop(taskId: string): AgentId | undefined {
    const t = this.tasks.get(taskId);
    if (!t || (t.status !== 'running' && t.status !== 'queued')) return undefined;
    this.update(taskId, { status: 'stopped' });
    if (t.assignedTo) this.active.delete(t.assignedTo);
    return t.assignedTo;
  }

  private update(id: string, patch: Partial<Task>): void {
    const t = this.tasks.get(id);
    if (!t) return;
    const next: Task = { ...t, ...patch, updatedAt: Date.now() };
    this.tasks.set(id, next);
    this.bus.emit({ t: 'task.update', task: next });
    this.persist();
  }

  private onAgentState(agentId: AgentId, state: AgentState): void {
    const id = this.active.get(agentId);
    if (!id) return;
    if (state === 'error') {
      this.update(id, { status: 'error' });
      this.active.delete(agentId);
    } else if (state === 'done' || state === 'idle') {
      const t = this.tasks.get(id);
      if (t?.status === 'running') this.update(id, { status: 'done' });
      this.active.delete(agentId);
    }
  }
}
