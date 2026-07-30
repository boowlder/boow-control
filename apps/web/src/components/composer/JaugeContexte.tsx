import { useCockpit } from '../../store/useCockpit';
import { cn } from '../../lib/utils';

// Jauge de contexte du cerveau local (chantier 14) : montre le remplissage de
// la fenêtre du modèle courant. Vert < 60 %, ambre 60-85 %, rouge au-delà.
// À ~80 % le daemon compacte tout seul la session : le rouge n'est donc pas
// une alerte bloquante, juste « on approche, ça va se résumer ».
export function JaugeContexte() {
  const ctx = useCockpit((s) => s.contexts['qwen']);
  if (!ctx || !ctx.max || !ctx.used) return null;

  const pct = Math.min(100, Math.round((ctx.used / ctx.max) * 100));
  const couleur = pct >= 85 ? 'bg-danger' : pct >= 60 ? 'bg-warn' : 'bg-ok';
  const texte = pct >= 85 ? 'text-danger' : pct >= 60 ? 'text-warn' : 'text-muted';

  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      title={
        `Contexte du cerveau local : ${ctx.used.toLocaleString('fr-FR')} / ` +
        `${ctx.max.toLocaleString('fr-FR')} tokens.\n` +
        'À 80 %, la session se compacte automatiquement pour continuer sans perte.'
      }
    >
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-panel2">
        <div className={cn('h-full rounded-full transition-[width] duration-500', couleur)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('font-mono text-[10px] tabular-nums', texte)}>{pct}%</span>
    </div>
  );
}
