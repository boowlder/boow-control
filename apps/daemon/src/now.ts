/** Ligne de contexte temps réel injectée aux agents (le modèle local n'a pas d'horloge). */
export function nowLine(): string {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const s = d.toLocaleString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Date et heure actuelles : ${s} (${tz}). Utilise cette date comme référence (ne te fie pas à ta date d'entraînement).`;
}
