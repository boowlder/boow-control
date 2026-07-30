import { useCallback, useEffect, useMemo, useState } from 'react';
import { Blocks, Boxes, Check, Download, LoaderCircle, Plug, Plus, RotateCw, Search, Sparkles, Store, Trash2, X, type LucideIcon } from 'lucide-react';
import { useCockpit } from '../../store/useCockpit';
import { cn } from '../../lib/utils';
import { CatalogueMcp } from './CatalogueMcp';

// Le répertoire : ce que la machine sait faire, et ce qu'elle peut apprendre.
//
// Tout vient du CLI `claude`, qui est la source de vérité — la même que celle
// qu'on utiliserait au terminal. Rien n'est recopié dans un catalogue maison
// qui périmerait au premier plugin publié.

type Rayon = 'catalogue' | 'competences' | 'connecteurs' | 'plugins';

const RAYONS: { id: Rayon; label: string; icon: LucideIcon }[] = [
  { id: 'catalogue', label: 'Catalogue', icon: Boxes },
  { id: 'competences', label: 'Compétences', icon: Sparkles },
  { id: 'connecteurs', label: 'Connecteurs', icon: Plug },
  { id: 'plugins', label: 'Plugins', icon: Blocks },
];

interface Plugin {
  pluginId: string;
  name: string;
  description?: string;
  marketplaceName?: string;
  installCount?: number;
  url?: string;
  installe: boolean;
}
interface Connecteur {
  nom: string;
  cible: string;
  etat: 'ok' | 'auth' | 'ko' | 'inconnu';
  detail: string;
}
interface Place {
  name: string;
  source?: string;
}
interface Contenu {
  plugins: Plugin[];
  places: Place[];
}

/** « 1 017 241 » -> « 1 M ». Le chiffre exact n'apporte rien, l'ordre si. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(n);
}

const ETAT: Record<Connecteur['etat'], { texte: string; classe: string }> = {
  ok: { texte: 'connecté', classe: 'text-ok' },
  auth: { texte: 'à connecter', classe: 'text-warn' },
  ko: { texte: 'en échec', classe: 'text-danger' },
  // L'affichage instantané : la ligne est là, sa santé arrive derrière.
  inconnu: { texte: 'contrôle…', classe: 'text-muted' },
};

/** Combien de cartes on rend d'un coup — 259 d'un bloc rame pour rien. */
const PAR_PAGE = 40;

export function Repertoire({ onFermer }: { onFermer: () => void }) {
  const caps = useCockpit((s) => s.claudeCaps);
  const pushToast = useCockpit((s) => s.pushToast);

  const [rayon, setRayon] = useState<Rayon>('catalogue');
  const [recherche, setRecherche] = useState('');
  const [catalogueCompte, setCatalogueCompte] = useState(0);
  const [contenu, setContenu] = useState<Contenu | null>(null);
  // Les connecteurs arrivent par une seconde requête : le CLI teste la santé
  // de chacun, ce qui prend une bonne minute. Faire attendre les trois pages
  // pour l'une d'elles serait absurde.
  const [cnx, setCnx] = useState<Connecteur[] | null>(null);
  const [chargement, setChargement] = useState(true);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [limite, setLimite] = useState(PAR_PAGE);
  const [formulaire, setFormulaire] = useState<'place' | 'connecteur' | null>(null);

  const lire = useCallback(
    (silencieux = false) => {
      if (!silencieux) setChargement(true);
      fetch('/api/repertoire')
        .then((r) => r.json())
        .then((d: Contenu) => setContenu(d))
        .catch(() => pushToast('error', 'Répertoire illisible — le CLI claude répond-il ?'))
        .finally(() => setChargement(false));
    },
    [pushToast],
  );

  const lireConnecteurs = useCallback((force = false) => {
    setCnx(null);
    // La liste d'abord (< 1 s, lue dans la config), la santé ensuite : le CLI
    // sonde chaque serveur distant et met une bonne minute. Comme dans l'appli
    // Claude : on voit tout de suite, les états se remplissent derrière.
    fetch(`/api/repertoire/connecteurs?instant=1${force ? '&force=1' : ''}`)
      .then((r) => r.json())
      .then((d: { connecteurs: Connecteur[]; sante?: boolean }) => {
        setCnx(d.connecteurs ?? []);
        if (d.sante) return undefined;
        return fetch('/api/repertoire/connecteurs')
          .then((r) => r.json())
          .then((s: { connecteurs: Connecteur[] }) => setCnx(s.connecteurs ?? []));
      })
      .catch(() => setCnx([]));
  }, []);

  useEffect(() => lire(), [lire]);
  // Seulement à l'ouverture du rayon : inutile de sonder vingt-deux serveurs
  // distants pour quelqu'un venu chercher un plugin.
  useEffect(() => {
    if (rayon === 'connecteurs' && cnx === null) lireConnecteurs();
  }, [rayon, cnx, lireConnecteurs]);

  /** Toute action passe par le daemon, qui appelle le CLI. */
  const agir = async (chemin: string, corps: Record<string, unknown>, cle: string, succes: string) => {
    setOccupe(cle);
    try {
      const r = await fetch(`/api/repertoire/${chemin}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        pushToast('info', succes);
        lire(true);
        if (chemin === 'connecteur') lireConnecteurs(true);
      } else {
        pushToast('error', String(d.message || d.error || 'Échec').slice(0, 180));
      }
    } catch {
      pushToast('error', 'Le daemon n’a pas répondu.');
    } finally {
      setOccupe(null);
    }
  };

  const q = recherche.trim().toLowerCase();
  useEffect(() => setLimite(PAR_PAGE), [q, rayon]);

  const plugins = useMemo(() => {
    const l = (contenu?.plugins ?? []).filter(
      (p) => !q || `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q),
    );
    // Les installés d'abord, puis les plus adoptés : la popularité est le seul
    // signal de qualité dont on dispose sans les avoir essayés.
    return l.sort(
      (a, b) => Number(b.installe) - Number(a.installe) || (b.installCount ?? 0) - (a.installCount ?? 0),
    );
  }, [contenu, q]);

  const connecteurs = (cnx ?? []).filter((c) => !q || `${c.nom} ${c.cible}`.toLowerCase().includes(q));
  const competences = (caps?.skills ?? []).filter(
    (s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q),
  );

  const compte: Record<Rayon, number> = {
    catalogue: catalogueCompte,
    competences: caps?.skills.length ?? 0,
    connecteurs: cnx?.length ?? 0,
    plugins: contenu?.plugins.length ?? 0,
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onFermer}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(680px,92vh)] w-[min(980px,96vw)] overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
      >
        {/* Rayons */}
        <div className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line/70 p-2.5">
          <span className="kicker px-2 pb-2 pt-1">Répertoire</span>
          {RAYONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setRayon(id)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors',
                rayon === id ? 'bg-brand/12 text-ink' : 'text-muted hover:bg-panel2/60 hover:text-ink',
              )}
            >
              <Icon size={14} className={cn('shrink-0', rayon === id && 'text-brand')} />
              <span className="flex-1 truncate">{label}</span>
              <span className="tnum shrink-0 text-[11px] text-muted">{compte[id]}</span>
            </button>
          ))}

          <div className="mt-4 px-2">
            <span className="kicker">Places de marché</span>
          </div>
          {(contenu?.places ?? []).map((p) => (
            <div key={p.name} className="group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px]">
              <Store size={12} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-muted" title={p.source}>
                {p.name}
              </span>
              <button
                onClick={() => agir('place', { action: 'remove', source: p.name }, `place:${p.name}`, 'Place retirée.')}
                title="Retirer cette place de marché"
                className="shrink-0 text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setFormulaire(formulaire === 'place' ? null : 'place')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-muted transition-colors hover:bg-panel2/60 hover:text-ink"
          >
            <Plus size={12} /> Ajouter un dépôt
          </button>

          <span className="flex-1" />
          <button
            onClick={() => {
              lire();
              if (rayon === 'connecteurs') lireConnecteurs(true);
            }}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
          >
            <RotateCw size={11} className={chargement ? 'animate-spin' : ''} /> Actualiser
          </button>
        </div>

        {/* Contenu */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line/70 p-3">
            <div className="relative min-w-0 flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder={rayon === 'plugins' ? 'Chercher parmi les plugins…' : rayon === 'catalogue' ? 'Chercher un connecteur…' : 'Chercher…'}
                className="w-full rounded-lg border border-line bg-base/50 py-2 pl-8 pr-2.5 text-[12.5px] text-ink outline-none focus:border-brand/60"
              />
            </div>
            {rayon === 'connecteurs' && (
              <button
                onClick={() => setFormulaire(formulaire === 'connecteur' ? null : 'connecteur')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-2 text-[12px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
              >
                <Plus size={12} /> Ajouter
              </button>
            )}
            <button
              onClick={onFermer}
              title="Fermer"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-panel2 hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
            {formulaire === 'place' && (
              <FormPlace
                occupe={occupe === 'place:add'}
                onValider={(source) => agir('place', { source }, 'place:add', 'Place de marché ajoutée.').then(() => setFormulaire(null))}
                onAnnuler={() => setFormulaire(null)}
              />
            )}
            {formulaire === 'connecteur' && rayon === 'connecteurs' && (
              <FormConnecteur
                occupe={occupe === 'mcp:add'}
                onValider={(nom, cible, transport) =>
                  agir('connecteur', { nom, cible, transport }, 'mcp:add', 'Connecteur ajouté.').then(() =>
                    setFormulaire(null),
                  )
                }
                onAnnuler={() => setFormulaire(null)}
              />
            )}

            {chargement && !contenu && rayon !== 'catalogue' && (
              <p className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-muted">
                <LoaderCircle size={14} className="animate-spin" /> Lecture depuis la machine…
              </p>
            )}

            {/* ── Catalogue (chantier 12) ── */}
            {rayon === 'catalogue' && <CatalogueMcp recherche={recherche} onCompte={setCatalogueCompte} />}

            {/* ── Plugins ── */}
            {rayon === 'plugins' &&
              plugins.slice(0, limite).map((p) => (
                <div key={p.pluginId} className="rounded-xl border border-line/70 bg-panel2/40 px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{p.name}</span>
                    {p.installCount != null && (
                      <span className="tnum shrink-0 text-[11px] text-muted" title={`${p.installCount} installations`}>
                        {compact(p.installCount)}
                      </span>
                    )}
                    <button
                      onClick={() =>
                        agir(
                          'plugin',
                          { action: p.installe ? 'uninstall' : 'install', id: p.installe ? p.name : p.pluginId },
                          `plug:${p.pluginId}`,
                          p.installe ? 'Plugin retiré.' : `${p.name} installé — il sera actif à la prochaine session.`,
                        )
                      }
                      disabled={occupe === `plug:${p.pluginId}`}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors disabled:opacity-50',
                        p.installe
                          ? 'border-ok/40 text-ok hover:border-danger/50 hover:text-danger'
                          : 'border-line text-muted hover:border-brand/50 hover:text-ink',
                      )}
                    >
                      {occupe === `plug:${p.pluginId}` ? (
                        <LoaderCircle size={11} className="animate-spin" />
                      ) : p.installe ? (
                        <Check size={11} />
                      ) : (
                        <Download size={11} />
                      )}
                      {p.installe ? 'installé' : 'installer'}
                    </button>
                  </div>
                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted" title={p.description}>
                      {p.description}
                    </p>
                  )}
                </div>
              ))}
            {rayon === 'plugins' && plugins.length > limite && (
              <button
                onClick={() => setLimite((l) => l + PAR_PAGE)}
                className="w-full rounded-lg border border-line py-2 text-[12px] text-muted transition-colors hover:border-brand/50 hover:text-ink"
              >
                Voir les {plugins.length - limite} suivants
              </button>
            )}

            {rayon === 'connecteurs' && cnx === null && (
              <p className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-muted">
                <LoaderCircle size={14} className="animate-spin" /> Lecture…
              </p>
            )}

            {/* ── Connecteurs ── */}
            {rayon === 'connecteurs' &&
              connecteurs.map((c) => (
                <div key={c.nom} className="group rounded-xl border border-line/70 bg-panel2/40 px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{c.nom}</span>
                    <span className={cn('shrink-0 text-[11px]', ETAT[c.etat].classe)} title={c.detail}>
                      {ETAT[c.etat].texte}
                    </span>
                    {/* MCP est un standard : ce serveur pourrait aussi servir à
                        Hermès. Le branchement côté Hermès n'est pas encore fait,
                        d'où la pastille éteinte plutôt qu'absente. */}
                    <span className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                      claude
                    </span>
                    <span
                      title="MCP est un standard, mais le branchement côté Hermès reste à faire."
                      className="shrink-0 rounded-md border border-line/40 px-1.5 py-0.5 text-[10px] text-muted/35"
                    >
                      hermès
                    </span>
                    <button
                      onClick={() => agir('connecteur', { action: 'remove', nom: c.nom }, `mcp:${c.nom}`, 'Connecteur retiré.')}
                      title="Retirer"
                      className="shrink-0 text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-muted" title={c.cible}>
                    {c.cible}
                  </p>
                </div>
              ))}

            {/* ── Compétences ── */}
            {rayon === 'competences' &&
              competences.map((s) => (
                <div key={s.name} className="rounded-xl border border-line/70 bg-panel2/40 px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.name}</span>
                    <span className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                      claude
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted" title={s.description}>
                    {s.description || 'aucune description'}
                  </p>
                </div>
              ))}

            {!chargement &&
              ((rayon === 'plugins' && plugins.length === 0) ||
                (rayon === 'connecteurs' && cnx !== null && connecteurs.length === 0) ||
                (rayon === 'competences' && competences.length === 0)) && (
                <p className="px-1 py-8 text-center text-[12.5px] text-muted">
                  {q ? 'Rien à ce nom.' : 'Rien ici pour le moment.'}
                </p>
              )}
          </div>

          <div className="border-t border-line/70 px-3.5 py-2.5 text-[11.5px] leading-snug text-muted">
            {rayon === 'plugins' && (
              <>
                Un plugin apporte des compétences, des connecteurs ou des commandes d'un coup.
                <span className="text-ink"> Installé, il devient actif à la prochaine session de Claude.</span>
              </>
            )}
            {rayon === 'connecteurs' && (
              <>
                Un connecteur MCP branche Claude sur un service — GitHub, une base, un agenda.
                <span className="text-ink"> « à connecter » veut dire qu'il attend que tu ouvres ta session chez eux.</span>
              </>
            )}
            {rayon === 'competences' && (
              <>
                Une compétence est un mode d'emploi que Claude charge quand il en a besoin.
                <span className="text-ink"> Le rayon Plugins en apporte des lots entiers.</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Formulaires ─────────────────────────────────────────────────────────── */

const champ =
  'w-full rounded-lg border border-line bg-base/50 px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-brand/60';

function FormPlace({ occupe, onValider, onAnnuler }: {
  occupe: boolean;
  onValider: (source: string) => void;
  onAnnuler: () => void;
}) {
  const [source, setSource] = useState('');
  return (
    <div className="space-y-2 rounded-xl border border-brand/40 bg-panel/60 p-3.5">
      <div className="text-[13px] text-ink">Ajouter une place de marché</div>
      <p className="text-[11.5px] leading-snug text-muted">
        Un dépôt GitHub qui publie des plugins. Écris <code className="md-code">proprio/depot</code>, ou colle
        l'adresse complète.
      </p>
      <input
        autoFocus
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && source.trim() && onValider(source.trim())}
        placeholder="anthropics/claude-plugins-official"
        className={champ}
      />
      <div className="flex gap-2">
        <button
          onClick={() => source.trim() && onValider(source.trim())}
          disabled={!source.trim() || occupe}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-onbrand disabled:opacity-40"
        >
          {occupe && <LoaderCircle size={11} className="animate-spin" />} Ajouter
        </button>
        <button onClick={onAnnuler} className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted">
          Annuler
        </button>
      </div>
    </div>
  );
}

function FormConnecteur({ occupe, onValider, onAnnuler }: {
  occupe: boolean;
  onValider: (nom: string, cible: string, transport: string) => void;
  onAnnuler: () => void;
}) {
  const [nom, setNom] = useState('');
  const [cible, setCible] = useState('');
  const [transport, setTransport] = useState('http');
  const pret = /^[\w@./-]{1,120}$/.test(nom) && /^https?:\/\//i.test(cible.trim());
  return (
    <div className="space-y-2 rounded-xl border border-brand/40 bg-panel/60 p-3.5">
      <div className="text-[13px] text-ink">Ajouter un connecteur</div>
      <p className="text-[11.5px] leading-snug text-muted">
        L'adresse d'un serveur MCP distant. Les serveurs qui lancent un programme en local
        s'ajoutent au terminal avec <code className="md-code">claude mcp add</code> — les lancer depuis le
        navigateur serait une porte ouverte.
      </p>
      <div className="flex gap-2">
        <input autoFocus value={nom} onChange={(e) => setNom(e.target.value)} placeholder="nom-court" className={champ} />
        <select value={transport} onChange={(e) => setTransport(e.target.value)} className={cn(champ, 'w-28 shrink-0')}>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </div>
      <input
        value={cible}
        onChange={(e) => setCible(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && pret && onValider(nom, cible.trim(), transport)}
        placeholder="https://mcp.exemple.com/mcp"
        className={champ}
      />
      <div className="flex gap-2">
        <button
          onClick={() => pret && onValider(nom, cible.trim(), transport)}
          disabled={!pret || occupe}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-onbrand disabled:opacity-40"
        >
          {occupe && <LoaderCircle size={11} className="animate-spin" />} Ajouter
        </button>
        <button onClick={onAnnuler} className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted">
          Annuler
        </button>
      </div>
    </div>
  );
}
