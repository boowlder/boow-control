import type { BoowMode } from '@boow/shared';
import { useCockpit } from '../../store/useCockpit';
import { cn } from '../../lib/utils';

// Le sélecteur de mode est l'outil principal du cockpit : il change qui
// travaille et ce que ça coûte. Il est donc en haut, au centre, toujours
// visible — pas rangé dans un coin.

const MODES: { id: BoowMode; label: string; aide: string }[] = [
  { id: 'normal', label: 'Normal', aide: 'Hermès et le cerveau local — gratuit, illimité' },
  { id: 'operation', label: 'Opération', aide: 'Claude dresse la carte, les locaux exécutent' },
  { id: 'claude', label: 'ClaudeCODE', aide: 'Claude directement, avec ses outils — facturé' },
];

/** Ce que coûte le mode courant. Un rappel discret, à droite du sélecteur. */
const COUT: Record<BoowMode, { texte: string; chaud: boolean }> = {
  normal: { texte: 'local · gratuit', chaud: false },
  operation: { texte: 'claude + locaux · au budget', chaud: true },
  claude: { texte: 'claude · facturé', chaud: true },
};

export function ModeBar() {
  const mode = useCockpit((s) => s.mode);
  const setMode = useCockpit((s) => s.setMode);
  const toutLocal = useCockpit((s) => s.localOnly);
  const combien = useCockpit((s) => s.sessions.filter((x) => x.mode === s.mode).length);
  const cout = COUT[mode];

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line/70 px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-[12px] text-muted">
          {combien} session{combien > 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line/80 bg-panel2/50 p-0.5">
        {MODES.map(({ id, label, aide }) => {
          const on = mode === id;
          // « Tout local » coupe tout ce qui appelle Claude : le dire ici plutôt
          // que de laisser cliquer sur un mode qui ne répondra pas.
          const coupe = toutLocal && id !== 'normal';
          return (
            <button
              key={id}
              onClick={() => setMode(id)}
              title={coupe ? `${aide}\n\n« Tout local » est activé — ce mode est coupé.` : aide}
              aria-pressed={on}
              className={cn(
                'relative rounded-[10px] px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
                on ? 'text-ink' : 'text-muted hover:text-ink',
                coupe && 'opacity-40',
              )}
            >
              {/* La pastille était animée par framer-motion (`layoutId`). Une
                  transition CSS donne le même effet pour 110 Ko de moins. */}
              <span
                aria-hidden
                className={cn(
                  'absolute inset-0 rounded-[10px] ring-1 transition-[background-color,box-shadow] duration-200',
                  on ? 'bg-brand/18 ring-brand/40' : 'bg-transparent ring-transparent',
                )}
              />
              <span className="relative">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <span className={cn('truncate text-[12px]', cout.chaud ? 'text-warn/80' : 'text-muted')}>
          {toutLocal && mode !== 'normal' ? 'coupé · tout local' : cout.texte}
        </span>
      </div>
    </div>
  );
}
