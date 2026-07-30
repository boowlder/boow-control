import { ChevronDown } from 'lucide-react';
import type { ClaudeEffort } from '@boow/shared';
import { useCockpit } from '../../store/useCockpit';
import { sendCommand } from '../../store/useSocket';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Slider } from '../ui/slider';

// Combien Claude réfléchit avant de répondre. Une barre, pas une liste : c'est
// une échelle, et la voir comme telle dit tout de suite où l'on se situe entre
// « répond vite » et « prend son temps ».

const ECHELLE: { v: string; label: string; aide: string }[] = [
  { v: '', label: 'auto', aide: 'le modèle décide tout seul' },
  { v: 'low', label: 'rapide', aide: 'répond vite, réfléchit peu' },
  { v: 'medium', label: 'moyen', aide: 'équilibré' },
  { v: 'high', label: 'poussé', aide: 'prend le temps de réfléchir' },
  { v: 'xhigh', label: 'très poussé', aide: 'réflexion longue — plus lent, plus cher' },
  { v: 'max', label: 'maximum', aide: 'effort maximum, pour les vrais casse-tête' },
];

export function Effort() {
  const cfg = useCockpit((s) => s.claudeConfigs['claude-code']);
  const caps = useCockpit((s) => s.claudeCaps);

  const modeles = [...(caps?.models ?? []), ...(caps?.modelesAnciens ?? [])];
  const actif = modeles.find((m) => m.value === (cfg?.model ?? 'sonnet'));
  const niveaux = actif?.effortLevels?.length
    ? actif.effortLevels
    : (['low', 'medium', 'high', 'xhigh', 'max'] as ClaudeEffort[]);

  // L'échelle ne montre que les crans que ce modèle accepte vraiment.
  const echelle = ECHELLE.filter((e) => e.v === '' || niveaux.includes(e.v as ClaudeEffort));
  const indice = Math.max(0, echelle.findIndex((e) => e.v === (cfg?.effort ?? '')));
  const courant = echelle[indice] ?? echelle[0];
  const gere = actif?.supportsEffort !== false;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title="Effort de réflexion"
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
        >
          <span>{gere ? courant.label : '—'}</span>
          <ChevronDown size={11} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-60 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="kicker flex-1">Effort</span>
          <span className="text-[12px] text-brand">{courant.label}</span>
        </div>

        {gere ? (
          <>
            <Slider
              min={0}
              max={echelle.length - 1}
              step={1}
              value={[indice]}
              onValueChange={([v]) =>
                sendCommand({ t: 'claude.config', id: 'claude-code', effort: echelle[v]?.v ?? '' })
              }
            />
            <div className="mt-1.5 flex justify-between text-[10.5px] text-muted">
              <span>plus rapide</span>
              <span>plus réfléchi</span>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">{courant.aide}</p>
          </>
        ) : (
          <p className="text-[11.5px] text-muted">Ce modèle ne gère pas les niveaux d'effort.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
