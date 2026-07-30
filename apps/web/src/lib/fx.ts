import type { ServerEvent } from '@boow/shared';
import { useCockpit } from '../store/useCockpit';

let audio: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (!audio) {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio = new AC();
    } catch {
      return null;
    }
  }
  return audio;
}

function tone(freq: number, dur = 0.12, type: OscillatorType = 'sine', when = 0, gain = 0.05): void {
  const a = ctx();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(a.destination);
  const t0 = a.currentTime + when;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export function playSound(kind: 'done' | 'alert' | 'error' | 'soft'): void {
  switch (kind) {
    case 'done':
      tone(660, 0.1, 'sine', 0);
      tone(990, 0.12, 'sine', 0.09);
      break;
    case 'alert':
      tone(880, 0.12, 'triangle', 0);
      tone(880, 0.12, 'triangle', 0.18);
      break;
    case 'error':
      tone(300, 0.18, 'sawtooth', 0, 0.04);
      break;
    case 'soft':
      tone(520, 0.08, 'sine', 0, 0.03);
      break;
  }
}

function browserNotify(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') new Notification(title, { body, silent: true });
  } catch {
    /* ignore */
  }
}

export function requestNotifPermission(): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

/** Effets (toast + son + notification) déclenchés par certains évènements serveur. */
export function handleEventFx(e: ServerEvent): void {
  const s = useCockpit.getState();
  if (e.t === 'agent.state') {
    const name = s.agents.find((a) => a.id === e.id)?.name ?? e.id;
    if (e.state === 'done') {
      s.pushToast('info', `${name} a terminé`);
      s.pushNotification('info', `${name} a terminé`);
      if (s.soundEnabled) playSound('done');
      if (s.notifEnabled && document.hidden) browserNotify('boow control', `${name} a terminé`);
    } else if (e.state === 'needs-input') {
      s.pushToast('warn', `${name} attend ta décision`);
      s.pushNotification('warn', `${name} attend ta décision`);
      if (s.soundEnabled) playSound('alert');
      if (s.notifEnabled) browserNotify('boow control', `${name} attend ta décision`);
    } else if (e.state === 'error') {
      s.pushToast('error', `${name} : erreur${e.detail ? ` — ${e.detail}` : ''}`);
      s.pushNotification('error', `${name} : erreur${e.detail ? ` — ${e.detail}` : ''}`);
      if (s.soundEnabled) playSound('error');
      if (s.notifEnabled && document.hidden) browserNotify('boow control', `${name} : erreur`);
    }
  } else if (e.t === 'agent.delegation' && e.from !== e.to) {
    if (s.soundEnabled) playSound('soft');
  }
}
