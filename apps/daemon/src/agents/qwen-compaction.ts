// Logique PURE de la compaction glissante des sessions locales (chantier 14),
// isolée ici pour être testable sans réseau ni le gros graphe d'imports de
// qwen.ts. Le résumé lui-même (appel modèle) reste dans qwen.ts ; ici, on ne
// fait que DÉCOUPER et RECONSTRUIRE l'historique — la part risquée à verrouiller.

// Forme minimale suffisante pour le découpage : les vrais messages (ChatMessage
// de qwen.ts, avec tool_calls…) s'y coulent structurellement, sans signature
// d'index (qui les rendrait au contraire non assignables).
export interface Msg {
  role: string;
  content: string;
}

// Le carnet vit dans l'historique sous une paire (message user préfixé + accusé
// de l'assistant), ce qui reste sûr pour tous les gabarits de chat.
export const CARNET_PREFIX = '📓 Contexte des échanges précédents (résumé pour mémoire) :\n';
export const CARNET_ACCUSE = 'Bien noté, je garde ce contexte en tête.';

/** Estime grossièrement les tokens d'un historique (repli quand l'API n'en
 *  donne pas, et pour la jauge juste après compaction). ~4 caractères/token. */
export function estimeTokens(msgs: Msg[]): number {
  let n = 0;
  for (const m of msgs) n += (m.content?.length ?? 0) + 8;
  return Math.ceil(n / 4);
}

export interface PlanCompaction {
  /** Le message système, réinjecté tel quel (jamais résumé). */
  sys: Msg | null;
  /** Le carnet déjà présent (déballé de la paire) ou celui fourni en mémoire. */
  ancien: string;
  /** Les vieux échanges à intégrer au carnet. Vide ⇒ ne PAS compacter. */
  milieu: Msg[];
  /** Les derniers messages gardés mot pour mot. */
  recent: Msg[];
}

/**
 * Décompose l'historique pour la compaction, SANS rien résumer. Détecte un
 * carnet déjà présent pour le mettre à jour plutôt que d'en empiler un second.
 * `milieu` vide signifie qu'il n'y a rien d'assez vieux : l'appelant s'abstient.
 */
export function planCompaction(history: Msg[], carnetActuel: string, garderRecent: number): PlanCompaction {
  const sys = history[0]?.role === 'system' ? history[0] : null;
  let corps = sys ? history.slice(1) : history.slice();

  let ancien = carnetActuel;
  if (corps[0]?.role === 'user' && String(corps[0].content).startsWith(CARNET_PREFIX)) {
    ancien = String(corps[0].content).slice(CARNET_PREFIX.length);
    corps = corps.slice(2); // on retire la paire carnet (user + accusé)
  }

  const recent = garderRecent > 0 ? corps.slice(-garderRecent) : [];
  const milieu = garderRecent > 0 ? corps.slice(0, -garderRecent) : corps.slice();
  return { sys, ancien, milieu, recent };
}

/** Reconstruit l'historique compacté : système + carnet à jour + queue récente. */
export function reconstruireCarnet(sys: Msg | null, nouveauCarnet: string, recent: Msg[]): Msg[] {
  const out: Msg[] = [];
  if (sys) out.push(sys);
  out.push({ role: 'user', content: CARNET_PREFIX + nouveauCarnet });
  out.push({ role: 'assistant', content: CARNET_ACCUSE });
  out.push(...recent);
  return out;
}
