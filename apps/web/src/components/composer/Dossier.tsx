import { useEffect, useState } from 'react';
import { ChevronDown, FolderOpen, PanelsTopLeft } from 'lucide-react';
import { useCockpit } from '../../store/useCockpit';
import { sendCommand } from '../../store/useSocket';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';

// Le dossier de travail de la session. Il borne ce que l'agent voit : tu
// travailles sur le portfolio, il ne voit que le portfolio.

interface Projet {
  name: string;
  path: string;
  root: string;
  git: boolean;
  mtime: number;
}

/** `~/projects/boow-control` plutôt que le chemin absolu complet. */
function court(p: string | undefined): string {
  if (!p) return 'dossier';
  const nom = p.replace(/\/+$/, '').split('/').pop();
  return nom || p;
}

export function Dossier() {
  const cwd = useCockpit((s) => s.claudeConfigs['claude-code']?.cwd);
  const pushToast = useCockpit((s) => s.pushToast);
  const [projets, setProjets] = useState<Projet[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState('');

  // Chargé à la première ouverture seulement : la liste bouge rarement.
  useEffect(() => {
    if (!ouvert || projets.length) return;
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) => setProjets(Array.isArray(d?.projects) ? d.projects : Array.isArray(d) ? d : []))
      .catch(() => setProjets([]));
  }, [ouvert, projets.length]);

  const choisir = (p: string) => {
    sendCommand({ t: 'claude.config', id: 'claude-code', cwd: p });
    pushToast('info', `Dossier de travail → ${p}`);
    setOuvert(false);
  };

  const q = filtre.trim().toLowerCase();
  const liste = q ? projets.filter((p) => p.name.toLowerCase().includes(q)) : projets;

  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <button
          title={cwd ? `Dossier de travail : ${cwd}` : 'Choisir le dossier de travail'}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel2/50 px-2 py-1.5 text-[12px] text-muted transition-colors hover:border-brand/40 hover:text-ink"
        >
          <PanelsTopLeft size={13} />
          <span className="max-w-[160px] truncate">{court(cwd)}</span>
          <ChevronDown size={11} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-1.5">
        <div className="px-1.5 pb-1.5 pt-1">
          <span className="kicker">Dossier de travail</span>
        </div>

        {projets.length > 6 && (
          <input
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            placeholder="Filtrer…"
            className="mb-1 w-full rounded-md border border-line bg-base/50 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-brand/60"
          />
        )}

        <div className="max-h-64 overflow-y-auto">
          {liste.length === 0 && (
            <p className="px-2 py-3 text-[11.5px] text-muted">
              {projets.length ? 'Aucun dossier à ce nom.' : 'Aucun projet trouvé dans ~/projects ni ~/work.'}
            </p>
          )}
          {liste.map((p) => {
            const on = p.path === cwd;
            return (
              <button
                key={p.path}
                onClick={() => choisir(p.path)}
                title={p.path}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-panel2',
                  on ? 'text-brand' : 'text-ink',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.git && <span className="kicker shrink-0">git</span>}
                {on && <span className="shrink-0 text-[10px]">✓</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-1 border-t border-line/70 pt-1">
          <button
            onClick={() => {
              const p = window.prompt('Chemin du dossier de travail', cwd ?? '');
              if (p?.trim()) choisir(p.trim());
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted transition-colors hover:bg-panel2 hover:text-ink"
          >
            <FolderOpen size={13} /> Ouvrir un autre dossier…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
