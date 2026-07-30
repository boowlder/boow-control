import { ChevronDown, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ClaudePermissionMode, LocalPermissionMode } from '@boow/shared';
import { useCockpit } from '../../store/useCockpit';
import { sendCommand } from '../../store/useSocket';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';

// Jusqu'où l'agent peut aller seul.
//
// Ce réglage manquait en mode normal, et son absence était trompeuse : elle
// laissait croire que les locaux avaient des droits limités par défaut. Ils
// avaient tous les droits, parce que le cockpit répondait « oui » à leur place
// sans jamais montrer la question. Le voici dans les trois modes.
//
// Sa portée du côté local est plus étroite qu'on l'espérerait, et l'encart en
// bas du tiroir le dit : l'adaptateur ACP d'Hermès ne soumet à autorisation que
// les modifications de fichiers. Ses commandes de terminal ne passent par
// aucun guichet — vérifié en le sondant directement.

interface Choix<T> {
  v: T;
  label: string;
  /** Version courte pour la pastille : la barre doit rester lisible. */
  court: string;
  aide: string;
  /** Vrai pour les positions qui laissent l'agent agir sans filet. */
  risque?: boolean;
}

const LOCAUX: Choix<LocalPermissionMode>[] = [
  { v: 'demander', label: 'Me demander', court: 'Demander', aide: 'chaque modification de fichier passe par toi' },
  { v: 'ecritures', label: 'Accepter les modifications', court: 'Accepter', aide: 'il modifie les fichiers sans demander' },
  { v: 'lecture', label: 'Refuser les modifications', court: 'Refuser', aide: 'il lit et propose ; toute écriture est refusée' },
  { v: 'tout', label: 'Tout autoriser', court: 'Tout', aide: 'plus aucun garde-fou ⚠', risque: true },
];

const CLAUDE: Choix<ClaudePermissionMode>[] = [
  { v: 'default', label: 'Me demander', court: 'Demander', aide: 'chaque outil passe par toi' },
  { v: 'acceptEdits', label: 'Accepter les fichiers', court: 'Accepter', aide: 'il écrit les fichiers sans demander' },
  { v: 'plan', label: 'Plan', court: 'Plan', aide: 'il lit et propose, ne touche à rien' },
  { v: 'auto', label: 'Auto', court: 'Auto', aide: 'il décide seul quoi autoriser' },
  { v: 'bypassPermissions', label: 'Tout autoriser', court: 'Tout', aide: 'plus aucun garde-fou ⚠', risque: true },
];

export function ModeTravail() {
  const mode = useCockpit((s) => s.mode);
  const local = useCockpit((s) => s.localConfig.permissionMode);
  const claude = useCockpit((s) => s.claudeConfigs['claude-code']?.permissionMode ?? 'acceptEdits');

  // En mode normal ce sont les locaux qui travaillent ; ailleurs, c'est Claude.
  const local_ = mode === 'normal';
  const choix = (local_ ? LOCAUX : CLAUDE) as Choix<string>[];
  const actuel = local_ ? local : claude;
  const actif = choix.find((c) => c.v === actuel);

  const choisir = (v: string) =>
    sendCommand(
      local_
        ? { t: 'local.config', permissionMode: v as LocalPermissionMode }
        : { t: 'claude.config', id: 'claude-code', permissionMode: v as ClaudePermissionMode },
    );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title={`Mode de travail : ${actif?.label ?? "—"} — ${actif?.aide ?? ""}`}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] transition-colors',
            actif?.risque ? 'text-warn' : 'text-brand hover:brightness-125',
          )}
        >
          <ShieldCheck size={13} />
          <span className="hidden sm:inline">{actif?.court ?? 'Mode'}</span>
          <ChevronDown size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <div className="px-1.5 pb-1.5 pt-1">
          <span className="kicker">Mode de travail</span>
        </div>
        {choix.map((c) => {
          const on = c.v === actuel;
          return (
            <button
              key={c.v}
              onClick={() => choisir(c.v)}
              className={cn(
                'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-panel2',
                on ? 'text-brand' : c.risque ? 'text-muted' : 'text-ink',
              )}
            >
              <span className="flex items-center gap-2 text-[12.5px]">
                <span className="flex-1 truncate">{c.label}</span>
                {on && <span className="shrink-0 text-[10px]">✓</span>}
              </span>
              <span className="text-[11px] leading-snug text-muted">{c.aide}</span>
            </button>
          );
        })}
        {local_ && (
          <div className="mt-1 space-y-1.5 border-t border-line/70 px-2 pb-0.5 pt-2">
            <p className="text-[11px] leading-snug text-muted">
              Ce réglage dit ce que le cockpit répond quand Hermès demande la
              permission de modifier un fichier.
            </p>
            {/* Ne pas laisser croire que ce réglage couvre tout : mesuré sur la
                machine, Hermès ne soumet jamais ses commandes de terminal. */}
            <p className="flex gap-1.5 text-[11px] leading-snug text-warn">
              <TriangleAlert size={12} className="mt-px shrink-0" />
              <span>
                Il ne couvre pas les commandes du terminal : Hermès les lance sans
                jamais demander, quel que soit le réglage.
              </span>
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
