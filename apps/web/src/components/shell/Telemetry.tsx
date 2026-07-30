import type { GpuStatus, SystemService } from '@boow/shared';
import { useCockpit } from '../../store/useCockpit';
import { sendCommand } from '../../store/useSocket';
import { NotificationCenter } from '../NotificationCenter';
import { cn } from '../../lib/utils';

// L'état de la machine, sur une ligne. Quatre pastilles, la mémoire vidéo, les
// deux jauges d'abonnement, l'interrupteur « tout local ». Rien d'autre : c'est
// une bande de contrôle, pas un tableau de bord.

/** Vert tant que c'est confortable, ambre au-delà de 70 %, rouge au-delà de 90 %. */
function couleur(pct: number): string {
  if (pct >= 90) return 'rgb(var(--c-danger))';
  if (pct >= 70) return 'rgb(var(--c-warn))';
  return 'rgb(var(--c-ok))';
}

/** « dans 2 h 10 » — quand la fenêtre se remet à zéro. */
function dansCombien(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'bientôt';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  if (h >= 24) return `dans ${Math.round(h / 24)} j`;
  return h > 0 ? `dans ${h} h ${String(m).padStart(2, '0')}` : `dans ${m} min`;
}

function Jauge({ label, pct, titre }: { label: string; pct: number; titre: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5" title={titre}>
      <span className="text-muted">{label}</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${p}%`, background: couleur(p) }}
        />
      </span>
      <span className="tnum text-muted">{Math.round(p)} %</span>
    </span>
  );
}

/** « 14,3/16,3 Go » — la contrainte qui décide quel cerveau tient sur la carte. */
function Gpu({ gpu }: { gpu: GpuStatus }) {
  const go = (mo: number) => (mo / 1024).toFixed(1).replace('.', ',');
  const pct = (gpu.utiliseMo / gpu.totalMo) * 100;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      title={`${gpu.nom ?? 'GPU'} — ${Math.round(pct)} % de la mémoire vidéo occupée`}
    >
      <span className="text-muted">gpu</span>
      <span className="tnum" style={{ color: pct >= 92 ? 'rgb(var(--c-warn))' : undefined }}>
        {go(gpu.utiliseMo)}/{go(gpu.totalMo)} Go
      </span>
    </span>
  );
}

function Pastille({ s, cerveaux }: { s: SystemService; cerveaux?: { actifs: string[]; oeil: string } }) {
  // La pastille du cerveau a TROIS états : éteint · prêt mais endormi (la
  // veille a rendu la mémoire vidéo — anneau vide) · chargé (pleine). Un point
  // vert qui voudrait dire « le serveur répond » laisserait croire que le
  // cerveau est là alors qu'il dort. Les autres services restent à deux états.
  const endormi = s.id === 'brain' && s.ok && !!cerveaux && cerveaux.actifs.length === 0;
  const charges = s.id === 'brain' && s.ok && cerveaux ? cerveaux.actifs : [];
  const titre =
    charges.length > 0
      ? `${s.label} — chargé : ${charges.join(', ')}`
      : endormi
        ? `${s.label} — prêt, endormi (0 Go de mémoire vidéo) · se réveille à la première question`
        : `${s.label}${s.detail ? ` — ${s.detail}` : ''}`;
  return (
    <span title={titre} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={
          endormi
            ? { background: 'transparent', boxShadow: 'inset 0 0 0 1px rgb(var(--c-ok))' }
            : { background: s.ok ? 'rgb(var(--c-ok))' : '#4a5160' }
        }
      />
      <span className={s.ok ? 'text-muted' : 'text-muted/50'}>{s.label}</span>
    </span>
  );
}

/** Noms courts : la bande doit tenir sur une ligne, même en fenêtre étroite. */
const COURT: Record<string, string> = {
  brain: 'cerveau',
  // Longtemps étiqueté « routeur » par erreur : cette pastille sonde Chrome
  // (l'outil de captures), pas le routeur de cerveaux.
  'chrome-cdp': 'chrome',
  hermes: 'hermès',
  claude: 'claude',
};

export function Telemetry() {
  const connected = useCockpit((s) => s.connected);
  const system = useCockpit((s) => s.system);
  const usage = useCockpit((s) => s.claudeUsage);
  const localOnly = useCockpit((s) => s.localOnly);

  const services = (system?.services ?? []).map((s) => ({ ...s, label: COURT[s.id] ?? s.label }));

  return (
    <header className="relative z-20 flex h-9 shrink-0 items-center gap-3.5 border-b border-line/70 bg-panel/60 px-3 text-[11px] backdrop-blur-xl">
      <span
        className="flex shrink-0 items-center gap-1.5 font-semibold tracking-tight"
        title={connected ? 'Cockpit connecté au daemon' : 'Daemon injoignable'}
      >
        <span
          className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-ok' : 'bg-danger')}
        />
        <span className="text-[12.5px] text-ink">boow</span>
      </span>

      <div className="flex min-w-0 items-center gap-3.5 overflow-x-auto">
        {services.map((s) => (
          <Pastille key={s.id} s={s} cerveaux={system?.cerveaux} />
        ))}
      </div>

      {system?.gpu && <Gpu gpu={system.gpu} />}

      {!localOnly && usage?.available && (
        <>
          {usage.fiveHour?.pct != null && (
            <Jauge
              label="5 h"
              pct={usage.fiveHour.pct}
              titre={`Fenêtre de 5 h — remise à zéro ${dansCombien(usage.fiveHour.resetsAt)}`}
            />
          )}
          {usage.sevenDay?.pct != null && (
            <Jauge
              label="sem"
              pct={usage.sevenDay.pct}
              titre={`Fenêtre de 7 jours — remise à zéro ${dansCombien(usage.sevenDay.resetsAt)}`}
            />
          )}
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <NotificationCenter />
        <button
          onClick={() => sendCommand({ t: 'local.only', on: !localOnly })}
          title={
            localOnly
              ? 'Tout local : aucun appel à Claude ne part. Clique pour le rebrancher.'
              : 'Claude est joignable. Clique pour tout basculer en local.'
          }
          className={cn(
            'shrink-0 rounded-md border px-2.5 py-1 font-medium transition-colors',
            localOnly
              ? 'border-warn/50 bg-warn/10 text-warn'
              : 'border-line text-muted hover:border-brand/40 hover:text-ink',
          )}
        >
          tout local
        </button>
      </div>
    </header>
  );
}
