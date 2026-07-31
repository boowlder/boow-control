import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useCockpit } from '../store/useCockpit';
import { sendCommand } from '../store/useSocket';
import { requestNotifPermission } from '../lib/fx';
import { nomCourt } from '../lib/agentNames';
import { Repertoire } from '../components/reglages/Repertoire';
import { Switch } from '../components/ui/switch';
import { cn } from '../lib/utils';

// Une liste de lignes qui se déplient, pas une mosaïque de panneaux.
//
// Les réglages se consultent rarement et se cherchent par leur nom. Sept
// lignes lisibles battent sept cartes qu'il faut balayer des yeux — et repliées,
// la page tient d'un coup d'œil.

function Ligne({ nom, resume, children, action }: {
  nom: string;
  resume: string;
  children?: ReactNode;
  /** Bouton à droite au lieu du dépliant (ex. « Ouvrir » pour une modale). */
  action?: { label: string; onClick: () => void };
}) {
  const [ouvert, setOuvert] = useState(false);
  const depliable = !!children;
  return (
    <div className="rounded-xl border border-line/70 bg-panel/40">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] text-ink">{nom}</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{resume}</div>
        </div>
        {action ? (
          <button
            onClick={action.onClick}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
          >
            {action.label}
          </button>
        ) : (
          depliable && (
            <button
              onClick={() => setOuvert((o) => !o)}
              aria-expanded={ouvert}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
            >
              <span className="mr-1.5">{ouvert ? 'Fermer' : 'Ouvrir'}</span>
              <ChevronDown size={12} className={cn('inline transition-transform', ouvert && 'rotate-180')} />
            </button>
          )
        )}
      </div>
      {ouvert && children && <div className="border-t border-line/70 px-4 py-3">{children}</div>}
    </div>
  );
}

function Pref({ label, aide, on, onChange }: { label: string; aide: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{label}</div>
        <div className="text-[11.5px] leading-snug text-muted">{aide}</div>
      </div>
      <Switch checked={on} onCheckedChange={onChange} />
    </div>
  );
}

interface Cerveaux {
  swapUp: boolean;
  active: string[];
  brains: { coder: string; vision: string; reasoning: string; fast: string };
}

/**
 * Lit l'état des cerveaux locaux.
 *
 * Le hook vit dans la page et pas dans la section repliée : sinon le résumé de
 * la ligne resterait sur « chargement… » tant qu'on ne l'a pas ouverte, ce qui
 * lui enlève tout intérêt.
 */
function useCerveaux(): Cerveaux | null {
  const [b, setB] = useState<Cerveaux | null>(null);
  useEffect(() => {
    let vivant = true;
    const lire = () =>
      fetch('/api/brains')
        .then((r) => r.json())
        .then((d: Cerveaux) => vivant && setB(d))
        .catch(() => {});
    lire();
    const iv = setInterval(lire, 4000);
    return () => {
      vivant = false;
      clearInterval(iv);
    };
  }, []);
  return b;
}

function CerveauxLocaux({ b }: { b: Cerveaux | null }) {
  const lignes = [
    { cle: 'coder', label: 'Code et texte', modele: b?.brains.coder },
    { cle: 'vision', label: 'Images — l’œil', modele: b?.brains.vision },
    { cle: 'reasoning', label: 'Raisonnement', modele: b?.brains.reasoning },
    { cle: 'fast', label: 'Réponses courtes', modele: b?.brains.fast },
  ];

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] leading-snug text-muted">
        {b?.swapUp
          ? 'Le routeur charge le bon modèle selon la tâche et décharge le précédent — un seul à la fois sur la carte.'
          : 'Routeur non détecté : un seul modèle à la fois, sans bascule automatique.'}
      </p>
      {lignes.map((l) => {
        const charge = !!l.modele && (b?.active ?? []).includes(l.modele);
        return (
          <div key={l.cle} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel2/40 px-3 py-2">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', charge ? 'bg-brand' : 'bg-line')} />
            <span className="flex-1 text-[12.5px] text-ink">{l.label}</span>
            <span className="tnum truncate text-[11px] text-muted" title={l.modele}>
              {l.modele ?? '—'}
            </span>
            {charge && <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 text-[10px] text-brand">chargé</span>}
          </div>
        );
      })}
    </div>
  );
}

interface Config {
  ports: { daemon: number; web: number };
  endpoints: Record<string, string>;
}

export function Reglages() {
  const agents = useCockpit((s) => s.agents);
  const system = useCockpit((s) => s.system);
  const notif = useCockpit((s) => s.notifEnabled);
  const setNotif = useCockpit((s) => s.setNotif);
  const son = useCockpit((s) => s.soundEnabled);
  const setSon = useCockpit((s) => s.setSound);
  const tts = useCockpit((s) => s.ttsEnabled);
  const setTts = useCockpit((s) => s.setTts);
  const theme = useCockpit((s) => s.theme);
  const setTheme = useCockpit((s) => s.setTheme);
  const caps = useCockpit((s) => s.claudeCaps);
  const usage = useCockpit((s) => s.claudeUsage);
  const cfgClaude = useCockpit((s) => s.claudeConfigs['claude-code']);

  const cerveaux = useCerveaux();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [repertoireOuvert, setRepertoireOuvert] = useState(false);
  const [cle, setCle] = useState('');

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);

  const compte = caps?.account;
  const enLigne = agents.filter((a) => a.online).length;

  return (
    <div className="h-full overflow-auto px-4 py-4">
      <div className="mx-auto max-w-[820px] space-y-2.5">
        <span className="kicker block pb-1">Réglages</span>

        <Ligne
          nom="Répertoire"
          resume="compétences, connecteurs et plugins — en installer, en chercher"
          action={{ label: 'Ouvrir', onClick: () => setRepertoireOuvert(true) }}
        />

        <Ligne
          nom="Cerveaux locaux"
          resume={
            cerveaux
              ? `4 spécialités · ${cerveaux.active?.[0] ? `${cerveaux.active[0]} chargé` : 'aucun chargé'}`
              : 'chargement…'
          }
        >
          <CerveauxLocaux b={cerveaux} />
        </Ligne>

        <Ligne nom="Équipe" resume={`${enLigne} agent${enLigne > 1 ? 's' : ''} en ligne sur ${agents.length}`}>
          <ul className="space-y-1.5">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel2/40 px-3 py-2">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: a.online ? a.eyes : 'rgb(var(--c-line))' }}
                />
                <span className="text-[12.5px] text-ink">{nomCourt(a.id, a.name)}</span>
                <span className="flex-1 truncate text-[11.5px] text-muted">{a.tagline}</span>
                <span className={cn('shrink-0 text-[11px]', a.online ? 'text-ok' : 'text-muted/60')}>
                  {a.online ? 'en ligne' : 'hors ligne'}
                </span>
              </li>
            ))}
          </ul>
        </Ligne>

        <Ligne
          nom="Connexion Anthropic"
          resume={
            compte?.email
              ? `${compte.email}${compte.subscriptionType ? ` · ${compte.subscriptionType}` : ''}`
              : cfgClaude?.authed
                ? 'connecté'
                : 'non connecté — lance `claude` puis /login'
          }
        >
          <div className="space-y-2.5 text-[12.5px] text-ink">
            {usage?.available ? (
              <p className="text-muted">
                Fenêtre de 5 h : {usage.fiveHour?.pct ?? 0} % · semaine : {usage.sevenDay?.pct ?? 0} %
              </p>
            ) : (
              <p className="text-muted">Pas de plafond d'abonnement lisible (clé API ou fournisseur tiers).</p>
            )}

            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                value={cle}
                onChange={(e) => setCle(e.target.value)}
                placeholder={cfgClaude?.hasApiKey ? 'clé enregistrée — retape pour la remplacer' : 'clé API Anthropic (optionnelle)'}
                className="min-w-[240px] flex-1 rounded-lg border border-line bg-base/50 px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-brand/60"
              />
              <button
                onClick={() => {
                  if (!cle.trim()) return;
                  sendCommand({ t: 'claude.apikey', key: cle.trim() });
                  setCle('');
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
              >
                Enregistrer
              </button>
              <button
                onClick={() => sendCommand({ t: 'claude.auth.check' })}
                className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
              >
                Vérifier
              </button>
            </div>
            {/* La clé ne vit qu'en mémoire du daemon : elle n'est ni écrite sur
                disque ni renvoyée au navigateur. */}
            <p className="text-[11px] leading-snug text-muted">
              La connexion par <code className="md-code">claude /login</code> suffit dans la plupart
              des cas. Une clé saisie ici reste en mémoire du daemon, jamais sur le disque.
            </p>
          </div>
        </Ligne>

        <Ligne
          nom="Préférences"
          resume={[notif && 'notifications', son && 'sons', tts && 'voix', theme === 'light' && 'thème clair']
            .filter(Boolean)
            .join(' · ') || 'tout est éteint'}
        >
          <div className="divide-y divide-line/40">
            <Pref
              label="Notifications du navigateur"
              aide="Quand un agent termine ou attend ta décision, fenêtre en arrière-plan."
              on={notif}
              onChange={(v) => {
                setNotif(v);
                if (v) requestNotifPermission();
              }}
            />
            <Pref label="Sons" aide="Bips discrets en fin de tâche." on={son} onChange={setSon} />
            <Pref
              label="Lecture vocale"
              aide="Lit chaque réponse à voix haute, une voix par agent."
              on={tts}
              onChange={setTts}
            />
            <Pref
              label="Thème sombre"
              aide="Éteins pour le thème clair."
              on={theme === 'dark'}
              onChange={(v) => setTheme(v ? 'dark' : 'light')}
            />
          </div>
        </Ligne>

        <Ligne
          nom="Machine"
          resume={
            system
              ? `${system.services.filter((s) => s.ok).length}/${system.services.length} services · ${
                  system.gpu ? `${(system.gpu.utiliseMo / 1024).toFixed(1).replace('.', ',')} Go de VRAM` : 'pas de GPU'
                }`
              : 'chargement…'
          }
        >
          <div className="space-y-1.5">
            {system?.services.map((s) => (
              <div key={s.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel2/40 px-3 py-2">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: s.ok ? 'rgb(var(--c-ok))' : 'rgb(var(--c-line))' }}
                />
                <span className="flex-1 text-[12.5px] text-ink">{s.label}</span>
                <span className="truncate text-[11px] text-muted">{s.detail}</span>
              </div>
            ))}
            {cfg && (
              <p className="pt-1 text-[11.5px] text-muted">
                daemon :{cfg.ports.daemon} · web :{cfg.ports.web}
                {Object.entries(cfg.endpoints).map(([k, v]) => (
                  <span key={k}> · {k} {String(v)}</span>
                ))}
              </p>
            )}
          </div>
        </Ligne>
      </div>

      {repertoireOuvert && <Repertoire onFermer={() => setRepertoireOuvert(false)} />}
    </div>
  );
}
