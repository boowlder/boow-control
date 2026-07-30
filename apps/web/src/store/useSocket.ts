import type { ClientCommand, ServerEvent } from '@boow/shared';
import { useCockpit } from './useCockpit';
import { handleEventFx } from '../lib/fx';

let ws: WebSocket | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** Ouvre (idempotent) la connexion WS au daemon, avec reconnexion auto. */
export function connectSocket(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  ws = new WebSocket(wsUrl());
  ws.onopen = () => useCockpit.getState().setConnected(true);
  ws.onmessage = (ev) => {
    try {
      const e = JSON.parse(ev.data) as ServerEvent;
      useCockpit.getState().applyEvent(e);
      handleEventFx(e);
    } catch {
      /* message non-JSON ignoré */
    }
  };
  ws.onclose = () => {
    useCockpit.getState().setConnected(false);
    if (reconnect) clearTimeout(reconnect);
    reconnect = setTimeout(connectSocket, 1500);
  };
  ws.onerror = () => ws?.close();
}

export function sendCommand(cmd: ClientCommand): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(cmd));
  }
}
