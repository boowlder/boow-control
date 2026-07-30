// Noms courts des agents, par rôle plutôt que par modèle.
//
// « Qwen Brain » dit quel modèle tourne, « cerveau » dit à quoi il sert. Quand
// on cherche d'un coup d'œil qui répond ou qui est en ligne, c'est le rôle qui
// compte — le modèle exact vit dans l'infobulle.

const COURT: Record<string, string> = {
  hermes: 'hermès',
  qwen: 'cerveau',
  oeil: 'œil',
  'claude-code': 'claude',
};

/** L'équipe, dans l'ordre d'affichage de la barre latérale. */
export const EQUIPE = ['hermes', 'qwen', 'oeil', 'claude-code'] as const;

export function nomCourt(id: string, repli?: string): string {
  return COURT[id] ?? repli ?? id;
}
