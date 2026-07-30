import { useEffect, useRef } from 'react';
import { useCockpit } from '../store/useCockpit';
import { speak } from '../lib/tts';

/**
 * Lit à voix haute (FR) chaque réponse d'agent terminée, avec une voix par agent.
 * Ne rattrape pas l'historique chargé : seules les nouvelles réponses sont lues.
 */
export function TtsEngine() {
  const ttsEnabled = useCockpit((s) => s.ttsEnabled);
  const chats = useCockpit((s) => s.chats);
  const spoken = useRef<Set<string>>(new Set());
  const init = useRef(false);

  useEffect(() => {
    if (!init.current) {
      init.current = true;
      for (const msgs of Object.values(chats)) for (const m of msgs) spoken.current.add(m.id);
      return;
    }
    if (!ttsEnabled) return;
    for (const [agentId, msgs] of Object.entries(chats)) {
      const last = [...msgs].reverse().find((m) => m.role === 'assistant' && !m.streaming);
      if (last && !spoken.current.has(last.id)) {
        spoken.current.add(last.id);
        if (Date.now() - last.ts < 120000) speak(last.text, agentId);
      }
    }
  }, [chats, ttsEnabled]);

  return null;
}
