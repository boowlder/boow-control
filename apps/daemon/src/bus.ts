import type { ServerEvent } from '@boow/shared';

type Listener = (e: ServerEvent) => void;

/** Bus d'évènements interne : tout ce qui doit atteindre le front passe ici. */
export class Bus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: ServerEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error('[bus] listener error', err);
      }
    }
  }
}
