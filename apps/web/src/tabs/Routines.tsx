import { useState } from 'react';
import { CalendarClock, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { BoowMode, Recurrence, Routine } from '@boow/shared';
import { useCockpit } from '../store/useCockpit';
import { sendCommand } from '../store/useSocket';
import { cn } from '../lib/utils';

// Les tâches programmées. Une liste, pas un calendrier : on a rarement plus de
// dix routines, et ce qu'on veut savoir c'est « quand » et « ça a donné quoi ».

const REPETITIONS: { v: Recurrence; label: string }[] = [
  { v: 'unique', label: 'une seule fois' },
  { v: 'horaire', label: 'toutes les heures' },
  { v: 'quotidien', label: 'tous les jours' },
  { v: 'hebdomadaire', label: 'toutes les semaines' },
  { v: 'mensuel', label: 'tous les mois' },
];

const MODES: { v: BoowMode; label: string }[] = [
  { v: 'normal', label: 'Normal — local' },
  { v: 'operation', label: 'Opération' },
  { v: 'claude', label: 'ClaudeCODE' },
];

const libelleRep = (r: Recurrence) => REPETITIONS.find((x) => x.v === r)?.label ?? r;

/** « dans 14 h 20 », « le 25/07 à 09:00 » — selon que c'est proche ou lointain. */
function quand(ts: number): string {
  const d = ts - Date.now();
  if (d <= 0) return 'maintenant';
  if (d < 3_600_000) return `dans ${Math.round(d / 60_000)} min`;
  if (d < 86_400_000) {
    const h = Math.floor(d / 3_600_000);
    return `dans ${h} h ${String(Math.round((d % 3_600_000) / 60_000)).padStart(2, '0')}`;
  }
  return `le ${new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Un `datetime-local` attend « 2026-07-23T07:30 » en heure locale. */
function versChamp(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
const versTs = (v: string): number => new Date(v).getTime();

interface Brouillon {
  id?: string;
  titre: string;
  consigne: string;
  mode: BoowMode;
  recurrence: Recurrence;
  prochaine: string;
}

function vide(): Brouillon {
  return {
    titre: '',
    consigne: '',
    mode: 'normal',
    recurrence: 'quotidien',
    // Demain à la même heure : une routine créée par erreur ne part pas tout de suite.
    prochaine: versChamp(Date.now() + 86_400_000),
  };
}

function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}

const champClasse =
  'w-full rounded-lg border border-line bg-base/50 px-2.5 py-2 text-[13px] text-ink outline-none transition-colors focus:border-brand/60';

function Edition({ b, onChange, onValider, onAnnuler }: {
  b: Brouillon;
  onChange: (b: Brouillon) => void;
  onValider: () => void;
  onAnnuler: () => void;
}) {
  const pret = b.consigne.trim().length > 0 && Number.isFinite(versTs(b.prochaine));
  return (
    <div className="space-y-3 rounded-xl border border-brand/40 bg-panel/60 p-4">
      <Champ label="Ce qu'elle fait">
        <input
          autoFocus
          value={b.consigne}
          onChange={(e) => onChange({ ...b, consigne: e.target.value })}
          placeholder="Résume mes courriels et écris-les dans ~/work/veille.md"
          className={champClasse}
        />
      </Champ>

      <div className="flex flex-wrap gap-3">
        <Champ label="Nom">
          <input
            value={b.titre}
            onChange={(e) => onChange({ ...b, titre: e.target.value })}
            placeholder="Veille du matin"
            className={champClasse}
          />
        </Champ>
        <Champ label="Prochaine fois">
          <input
            type="datetime-local"
            value={b.prochaine}
            onChange={(e) => onChange({ ...b, prochaine: e.target.value })}
            className={champClasse}
          />
        </Champ>
      </div>

      <div className="flex flex-wrap gap-3">
        <Champ label="Répétition">
          <select
            value={b.recurrence}
            onChange={(e) => onChange({ ...b, recurrence: e.target.value as Recurrence })}
            className={champClasse}
          >
            {REPETITIONS.map((r) => (
              <option key={r.v} value={r.v}>
                {r.label}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Mode">
          <select
            value={b.mode}
            onChange={(e) => onChange({ ...b, mode: e.target.value as BoowMode })}
            className={champClasse}
          >
            {MODES.map((m) => (
              <option key={m.v} value={m.v}>
                {m.label}
              </option>
            ))}
          </select>
        </Champ>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onValider}
          disabled={!pret}
          className="rounded-lg bg-brand px-3.5 py-2 text-[12.5px] font-semibold text-onbrand transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
        >
          Enregistrer
        </button>
        <button
          onClick={onAnnuler}
          className="rounded-lg border border-line px-3 py-2 text-[12.5px] text-muted transition-colors hover:text-ink"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

function Acte({ titre, onClick, danger, children }: {
  titre: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={titre}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-lg border border-line text-muted transition-colors',
        danger ? 'hover:border-danger/50 hover:text-danger' : 'hover:border-brand/50 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function Ligne({ r, onModifier }: { r: Routine; onModifier: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line/70 bg-panel/40 px-3.5 py-3">
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', r.encours ? 'animate-breathe bg-brand' : r.actif ? 'bg-ok' : 'bg-line')}
        title={r.encours ? 'en cours' : r.actif ? 'active' : 'en pause'}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-ink">{r.titre}</div>
        <div className="truncate text-[11.5px] text-muted">
          {r.actif ? `${libelleRep(r.recurrence)} · ${quand(r.prochaine)}` : 'en pause'} · {r.mode}
        </div>
      </div>

      {r.dernierResultat && (
        <span
          title={r.dernierResultat}
          className={cn(
            'hidden max-w-[220px] shrink-0 truncate rounded-md border px-2 py-1 text-[11px] sm:block',
            r.dernierOk ? 'border-ok/30 bg-ok/10 text-ok' : 'border-danger/30 bg-danger/10 text-danger',
          )}
        >
          {r.dernierResultat}
        </span>
      )}

      <div className="flex shrink-0 gap-1.5">
        <Acte titre="Lancer maintenant" onClick={() => sendCommand({ t: 'routine.run', id: r.id })}>
          <Play size={12} />
        </Acte>
        <Acte titre="Modifier" onClick={onModifier}>
          <Pencil size={12} />
        </Acte>
        <Acte
          titre={r.actif ? 'Mettre en pause' : 'Réactiver'}
          onClick={() => sendCommand({ t: 'routine.toggle', id: r.id, actif: !r.actif })}
        >
          {r.actif ? <Pause size={12} /> : <Play size={12} />}
        </Acte>
        <Acte
          titre="Supprimer"
          danger
          onClick={() => {
            // Une routine supprimée ne se récupère pas : on demande.
            if (window.confirm(`Supprimer « ${r.titre} » ?`)) sendCommand({ t: 'routine.delete', id: r.id });
          }}
        >
          <Trash2 size={12} />
        </Acte>
      </div>
    </div>
  );
}

export function Routines() {
  const routines = useCockpit((s) => s.routines);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);

  const enregistrer = () => {
    if (!brouillon) return;
    const titre = brouillon.titre.trim() || brouillon.consigne.trim().slice(0, 60);
    const commun = {
      titre,
      consigne: brouillon.consigne.trim(),
      mode: brouillon.mode,
      recurrence: brouillon.recurrence,
    };
    sendCommand(
      brouillon.id
        ? { t: 'routine.update', id: brouillon.id, ...commun, prochaine: versTs(brouillon.prochaine) }
        : { t: 'routine.create', ...commun, premiere: versTs(brouillon.prochaine) },
    );
    setBrouillon(null);
  };

  return (
    <div className="h-full overflow-auto px-4 py-4">
      <div className="mx-auto max-w-[820px] space-y-3">
        <div className="flex items-center gap-2">
          <span className="kicker flex-1">Routines</span>
          {!brouillon && (
            <button
              onClick={() => setBrouillon(vide())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2/60 px-3 py-1.5 text-[12.5px] text-ink transition-colors hover:border-brand/50"
            >
              <Plus size={13} className="text-brand" /> Nouvelle routine
            </button>
          )}
        </div>

        {brouillon && (
          <Edition
            b={brouillon}
            onChange={setBrouillon}
            onValider={enregistrer}
            onAnnuler={() => setBrouillon(null)}
          />
        )}

        {routines.length === 0 && !brouillon && (
          <div className="grid place-items-center py-20 text-center">
            <div>
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-panel2/50 text-brand">
                <CalendarClock size={22} />
              </div>
              <div className="text-lg font-semibold text-ink">Aucune routine</div>
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
                Une routine, c'est une consigne qui part toute seule à l'heure dite — une veille
                le matin, une sauvegarde le dimanche.
              </p>
            </div>
          </div>
        )}

        {routines.map((r) => (
          <Ligne
            key={r.id}
            r={r}
            onModifier={() =>
              setBrouillon({
                id: r.id,
                titre: r.titre,
                consigne: r.consigne,
                mode: r.mode,
                recurrence: r.recurrence,
                prochaine: versChamp(r.prochaine),
              })
            }
          />
        ))}

        {routines.length > 1 && (
          <p className="px-1 pt-1 text-[11.5px] text-muted">
            Une routine à la fois : deux en même temps se battraient pour la carte graphique.
          </p>
        )}
      </div>
    </div>
  );
}
