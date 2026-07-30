// Synthèse vocale. Voix locale (Piper, via le daemon) quand elle est
// installée ; sinon on retombe sur celle du navigateur.
import { useCockpit } from '../store/useCockpit';

const AGENT_ORDER = ['hermes', 'claude-code', 'oeil', 'qwen'];
const AGENT_PITCH: Record<string, number> = { hermes: 0.86, 'claude-code': 1.0, oeil: 1.2, qwen: 1.06 };
const AGENT_RATE: Record<string, number> = { hermes: 0.98, 'claude-code': 1.05, oeil: 1.08, qwen: 1.0 };
/** La voix locale est la même pour tous : on distingue les agents par la hauteur. */
const AGENT_TAUX: Record<string, number> = { hermes: 0.94, 'claude-code': 1.0, oeil: 1.08, qwen: 1.03 };

export function frVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  const all = window.speechSynthesis.getVoices();
  const fr = all.filter((v) => /^fr/i.test(v.lang));
  return fr.length ? fr : all;
}

/** Nettoie le markdown / code / liens pour une lecture fluide. */
function clean(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, '. bloc de code. ')
    .replace(/`[^`]*`/g, '')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, 'lien')
    .replace(/[#*_>|~]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 1600);
}

// ── Voix locale ─────────────────────────────────────────────────────────────

/** undefined = pas encore demandé au daemon. */
let voixLocale: boolean | undefined;
let audio: HTMLAudioElement | null = null;
let urlEnCours: string | null = null;

async function localeDisponible(): Promise<boolean> {
  if (voixLocale !== undefined) return voixLocale;
  try {
    const r = await fetch('/api/tts/status');
    const d = (await r.json()) as { disponible?: boolean };
    voixLocale = !!d.disponible;
  } catch {
    voixLocale = false;
  }
  return voixLocale;
}

function libererAudio(): void {
  if (audio) {
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (urlEnCours) {
    URL.revokeObjectURL(urlEnCours);
    urlEnCours = null;
  }
}

async function parlerLocal(texte: string, agentId: string): Promise<boolean> {
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: texte }),
    });
    if (!r.ok) return false;
    const blob = await r.blob();
    libererAudio();
    urlEnCours = URL.createObjectURL(blob);
    audio = new Audio(urlEnCours);
    audio.playbackRate = AGENT_TAUX[agentId] ?? 1;
    audio.onended = () => {
      useCockpit.getState().setSpeaking(null);
      libererAudio();
    };
    audio.onerror = () => {
      useCockpit.getState().setSpeaking(null);
      libererAudio();
    };
    useCockpit.getState().setSpeaking(agentId);
    await audio.play();
    return true;
  } catch {
    useCockpit.getState().setSpeaking(null);
    return false;
  }
}

// ── Voix du navigateur (repli) ──────────────────────────────────────────────

function parlerNavigateur(texte: string, agentId: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const fr = frVoices();
  const idx = Math.max(0, AGENT_ORDER.indexOf(agentId));
  const voice = fr.length ? fr[idx % fr.length] : undefined;
  const u = new SpeechSynthesisUtterance(texte);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'fr-FR';
  u.pitch = AGENT_PITCH[agentId] ?? 1;
  u.rate = AGENT_RATE[agentId] ?? 1.02;
  u.onstart = () => useCockpit.getState().setSpeaking(agentId);
  u.onend = () => useCockpit.getState().setSpeaking(null);
  u.onerror = () => useCockpit.getState().setSpeaking(null);
  window.speechSynthesis.cancel(); // pas de chevauchement
  window.speechSynthesis.speak(u);
}

export function speak(text: string, agentId: string): void {
  const txt = clean(text);
  if (!txt) return;
  stopSpeak();
  void (async () => {
    if (await localeDisponible()) {
      if (await parlerLocal(txt, agentId)) return;
      // La voix locale a flanché : on ne laisse pas l'utilisateur dans le silence.
    }
    parlerNavigateur(txt, agentId);
  })();
}

export function stopSpeak(): void {
  libererAudio();
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  useCockpit.getState().setSpeaking(null);
}

// Les voix du navigateur sont souvent vides au 1er appel : on les précharge.
if (typeof window !== 'undefined' && window.speechSynthesis) {
  try {
    window.speechSynthesis.onvoiceschanged = () => frVoices();
    frVoices();
  } catch {
    /* ignore */
  }
}
