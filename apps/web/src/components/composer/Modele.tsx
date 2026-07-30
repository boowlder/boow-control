import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ClaudeModelInfo } from '@boow/shared';
import { useCockpit } from '../../store/useCockpit';
import { sendCommand } from '../../store/useSocket';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';

// Le modèle de Claude. Ne sert qu'aux modes qui l'appellent — en mode normal,
// c'est le routeur local qui choisit, et ce réglage n'aurait rien à commander.

const SECOURS: ClaudeModelInfo[] = [
  { value: 'default', displayName: 'Défaut' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'opus', displayName: 'Opus' },
  { value: 'haiku', displayName: 'Haiku' },
];

/**
 * « Opus 4.8 » plutôt que « Opus ».
 *
 * Le numéro de version n'est pas dans `displayName` mais en tête de la
 * description (« Opus 4.8 · Best for everyday tasks »). Sans lui, impossible de
 * savoir quelle génération répond.
 */
export function avecVersion(m: ClaudeModelInfo | undefined): string {
  if (!m) return 'modèle';
  const tete = m.description?.split('·')[0]?.trim();
  return tete && /\d/.test(tete) ? tete : m.displayName;
}

export function Modele() {
  const cfg = useCockpit((s) => s.claudeConfigs['claude-code']);
  const caps = useCockpit((s) => s.claudeCaps);
  const [anciensOuverts, setAnciensOuverts] = useState(false);

  const modeles = caps?.models.length ? caps.models : SECOURS;
  const anciens = caps?.modelesAnciens ?? [];
  const choisi = cfg?.model ?? 'sonnet';
  const actif = [...modeles, ...anciens].find((m) => m.value === choisi);

  const Ligne = ({ m }: { m: ClaudeModelInfo }) => (
    <button
      onClick={() => sendCommand({ t: 'claude.config', id: 'claude-code', model: m.value })}
      title={m.description}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-panel2',
        m.value === choisi ? 'text-brand' : 'text-ink',
      )}
    >
      <span className="flex-1 truncate">{avecVersion(m)}</span>
      {m.value === choisi && <span className="shrink-0 text-[10px]">✓</span>}
    </button>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title="Modèle de Claude"
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
        >
          <span>{avecVersion(actif)}</span>
          <ChevronDown size={11} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-56 p-1.5">
        <div className="px-1.5 pb-1.5 pt-1">
          <span className="kicker">Modèle</span>
        </div>
        <div className="space-y-0.5">
          {modeles.map((m) => (
            <Ligne key={m.value} m={m} />
          ))}
        </div>

        {anciens.length > 0 && (
          <div className="mt-0.5">
            <button
              onClick={() => setAnciensOuverts((o) => !o)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted transition-colors hover:bg-panel2 hover:text-ink"
            >
              <span className="flex-1">Plus de modèles</span>
              <ChevronRight size={12} className={cn('transition-transform', anciensOuverts && 'rotate-90')} />
            </button>
            {anciensOuverts && (
              <div className="ml-2 space-y-0.5 border-l border-line pl-1.5">
                {anciens.map((m) => (
                  <Ligne key={m.value} m={m} />
                ))}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
