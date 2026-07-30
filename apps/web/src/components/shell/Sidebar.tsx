import { useState } from 'react';
import {
  CalendarClock,
  ChevronLeft,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { BoowMode } from '@boow/shared';
import { useCockpit, LIEU_DE, PAGE_DE, type Lieu } from '../../store/useCockpit';
import { filtrer, parMode } from '../../store/sessions';
import { EQUIPE, nomCourt } from '../../lib/agentNames';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { sendCommand } from '../../store/useSocket';
import { cn } from '../../lib/utils';

const LIEUX: { id: Lieu; label: string; icon: LucideIcon }[] = [
  { id: 'travail', label: 'Travail', icon: MessageSquare },
  { id: 'routines', label: 'Routines', icon: CalendarClock },
  { id: 'reglages', label: 'Réglages', icon: Settings },
];

const ETIQUETTE: Record<BoowMode, string> = {
  normal: 'sessions · normal',
  operation: 'sessions · opération',
  claude: 'sessions · claudecode',
};

/** Qui remettre à zéro quand on ouvre une discussion neuve, selon le mode. */
const AGENTS_DU_MODE: Record<BoowMode, string[]> = {
  normal: ['hermes', 'qwen'],
  // Une opération neuve est créée par le daemon au premier message : rien à
  // remettre à zéro ici.
  operation: [],
  claude: ['claude-code'],
};

/** « il y a 4 min », « hier », « 12 juil. » — sans dépendance de dates. */
function quand(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "à l'instant";
  if (d < 3_600_000) return `il y a ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `il y a ${Math.floor(d / 3_600_000)} h`;
  if (d < 172_800_000) return 'hier';
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function Membre({ id }: { id: string }) {
  const agent = useCockpit((s) => s.agents.find((a) => a.id === id));
  const etat = useCockpit((s) => s.states[id]?.state ?? 'offline');
  const ouverte = useCockpit((s) => s.barreOuverte);
  const cerveaux = useCockpit((s) => s.system?.cerveaux);
  if (!agent) return null;
  const vivant = etat !== 'offline';

  // Cerveau et œil vivent derrière le routeur : « en ligne » ne veut pas dire
  // « chargé ». Anneau vide = prêt mais endormi (0 Go), plein = en mémoire.
  let charge: boolean | undefined;
  if (vivant && cerveaux && (id === 'qwen' || id === 'oeil')) {
    charge =
      id === 'oeil'
        ? cerveaux.actifs.includes(cerveaux.oeil)
        : cerveaux.actifs.some((m) => m !== cerveaux.oeil);
  }
  const endormi = charge === false;
  const detail = !vivant
    ? 'hors ligne'
    : endormi
      ? 'endormi — se réveille à la demande'
      : charge
        ? 'chargé en mémoire vidéo'
        : 'en ligne';
  return (
    <span
      title={`${agent.name} — ${detail}`}
      className={cn('flex items-center gap-2 text-[11px]', ouverte ? '' : 'justify-center')}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={
          endormi
            ? { background: 'transparent', boxShadow: `inset 0 0 0 1px ${agent.accent}` }
            : { background: vivant ? agent.accent : 'rgb(var(--c-line))' }
        }
      />
      {ouverte && <span className={vivant ? 'text-muted' : 'text-muted/50'}>{nomCourt(id, agent.name)}</span>}
    </span>
  );
}

export function Sidebar() {
  const ouverte = useCockpit((s) => s.barreOuverte);
  const basculer = useCockpit((s) => s.basculerBarre);
  const lieu = useCockpit((s) => LIEU_DE[s.tab]);
  const setTab = useCockpit((s) => s.setTab);
  const mode = useCockpit((s) => s.mode);
  const sessions = useCockpit((s) => s.sessions);
  const sessionId = useCockpit((s) => s.sessionId);
  const demarrer = useCockpit((s) => s.demarrerSession);
  const ouvrir = useCockpit((s) => s.ouvrirSession);
  const renommer = useCockpit((s) => s.renommerSession);
  const supprimer = useCockpit((s) => s.supprimerSession);
  const [enEdition, setEnEdition] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');

  // Le cloisonnement est ici : on ne voit jamais que le tas du mode courant.
  // Puis le filtre, qui fouille titre ET contenu de chaque discussion.
  const liste = filtrer(parMode(sessions, mode), recherche);

  return (
    <aside
      className={cn(
        'relative z-10 flex shrink-0 flex-col border-r border-line/70 bg-panel/50 backdrop-blur-xl transition-[width] duration-200',
        ouverte ? 'w-60' : 'w-[52px]',
      )}
    >
      <div className={cn('flex px-2.5 pt-2.5', ouverte ? 'justify-start' : 'justify-center')}>
        <button
          onClick={basculer}
          title={ouverte ? 'Replier la barre' : 'Déplier la barre'}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-panel2/60 hover:text-ink"
        >
          <ChevronLeft size={15} className={cn('transition-transform', !ouverte && 'rotate-180')} />
        </button>
      </div>

      <div className="px-2.5 pb-1 pt-1.5">
        <button
          onClick={() => {
            demarrer();
            // Le fil repart à zéro à l'écran ; il doit aussi repartir à zéro
            // chez l'agent, sinon Claude garde l'ancien contexte et son
            // compteur de coût continue de grimper sur la même session.
            for (const id of AGENTS_DU_MODE[mode]) sendCommand({ t: 'chat.reset', id });
          }}
          title="Nouvelle discussion"
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border border-line bg-panel2/60 px-2.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand/50 hover:bg-panel2',
            !ouverte && 'justify-center px-0',
          )}
        >
          <Plus size={15} className="shrink-0 text-brand" />
          {ouverte && <span className="truncate">Nouvelle discussion</span>}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-2.5">
        {LIEUX.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(PAGE_DE[id])}
            title={label}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
              lieu === id ? 'bg-brand/12 text-ink' : 'text-muted hover:bg-panel2/60 hover:text-ink',
              !ouverte && 'justify-center px-0',
            )}
          >
            <Icon size={15} className={cn('shrink-0', lieu === id && 'text-brand')} />
            {ouverte && <span className="truncate">{label}</span>}
          </button>
        ))}
      </nav>

      {ouverte && (
        <>
          <div className="mt-4 px-4 pb-1.5">
            {/* Dire quel tas on regarde : sans ça, une liste qui change toute
                seule au changement de mode passe pour un bug. */}
            <span className="kicker">{ETIQUETTE[mode]}</span>
          </div>

          <div className="px-2.5 pb-1.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-line/70 bg-base/40 px-2 py-1.5">
              <Search size={12} className="shrink-0 text-muted" />
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Chercher une discussion…"
                className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-muted/70"
              />
              {recherche && (
                <button onClick={() => setRecherche('')} title="Effacer" className="shrink-0 text-muted hover:text-ink">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
            {liste.length === 0 && (
              <p className="px-2 py-3 text-[12px] text-muted">
                {recherche ? 'Aucune discussion ne correspond.' : 'Rien encore ici.'}
              </p>
            )}
            {liste.map((s) => {
              const active = s.id === sessionId;
              return (
                <div
                  key={s.id}
                  className={cn(
                    'group relative flex items-center rounded-lg pr-1 transition-colors',
                    active ? 'bg-panel2' : 'hover:bg-panel2/60',
                  )}
                >
                  {enEdition === s.id ? (
                    <input
                      autoFocus
                      defaultValue={s.titre}
                      onBlur={(e) => {
                        renommer(s.id, e.currentTarget.value);
                        setEnEdition(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEnEdition(null);
                      }}
                      className="w-full rounded-md bg-base/60 px-2.5 py-2 text-[12.5px] text-ink outline-none ring-1 ring-brand/50"
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => ouvrir(s.id)}
                        className="min-w-0 flex-1 px-2.5 py-2 text-left"
                        title={s.titre}
                      >
                        <div className={cn('truncate text-[12.5px]', active ? 'text-ink' : 'text-muted')}>
                          {s.titre}
                        </div>
                        <div className="text-[10.5px] text-muted/70">{quand(s.vu)}</div>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            title="Actions"
                            className="shrink-0 rounded-md p-1 text-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onSelect={() => setEnEdition(s.id)}>
                            <Pencil /> Renommer
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => supprimer(s.id)}>
                            <Trash2 /> Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {!ouverte && <div className="flex-1" />}

      <div className={cn('flex flex-col gap-2 border-t border-line/70 p-3', !ouverte && 'items-center')}>
        {EQUIPE.map((id) => (
          <Membre key={id} id={id} />
        ))}
      </div>
    </aside>
  );
}
