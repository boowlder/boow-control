import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, KeyRound, LoaderCircle, Sparkles, Trash2, X } from 'lucide-react';
import { useCockpit } from '../../store/useCockpit';
import { cn } from '../../lib/utils';

// Le rayon Catalogue (chantier 12) : la liste curée de ce que les cerveaux —
// surtout les LOCAUX — peuvent brancher. Chaque connecteur montre son type
// (①sans clé / ②jeton / ③Claude), les mains qui peuvent l'utiliser, et pour les
// OAuth la voie « jeton » qui les rend accessibles hors Claude. Installer un ②
// demande de coller le(s) secret(s) ; tout passe par le daemon (mcp.json 0600).

type TypeConn = 'local' | 'jeton' | 'oauth';
type Main = 'claude' | 'locaux' | 'hermes';
interface SecretRequis {
  cle: string;
  libelle: string;
  aide: string;
}
interface Connecteur {
  id: string;
  nom: string;
  categorie: string;
  logo: string;
  description: string;
  types: TypeConn[];
  mains: Main[];
  local?: { secrets?: SecretRequis[] };
  alternativeJeton?: string;
  oauthNote?: string;
  competence?: string;
  note?: string;
}
interface Data {
  categories: string[];
  connecteurs: Connecteur[];
  installesLocaux: string[];
}

const BADGE: Record<TypeConn, { rond: string; texte: string; classe: string; titre: string }> = {
  local: { rond: '①', texte: 'sans clé', classe: 'text-ok', titre: 'Fonctionne sur les locaux, gratuitement, sans clé' },
  jeton: { rond: '②', texte: 'jeton', classe: 'text-warn', titre: 'Fonctionne sur les locaux avec une clé/un jeton à coller' },
  oauth: { rond: '③', texte: 'Claude', classe: 'text-muted', titre: 'OAuth distant : réservé à Claude' },
};

const MAINS: { id: Main; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'locaux', label: 'Locaux' },
  { id: 'hermes', label: 'Hermès' },
];

export function CatalogueMcp({ recherche, onCompte }: { recherche: string; onCompte?: (n: number) => void }) {
  const pushToast = useCockpit((s) => s.pushToast);
  const [data, setData] = useState<Data | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  // Le formulaire jeton ouvert, et pour quelle cible (locaux ou Claude).
  const [formulaire, setFormulaire] = useState<{ id: string; cible: 'locaux' | 'claude' } | null>(null);

  const lire = useCallback(() => {
    fetch('/api/catalogue')
      .then((r) => r.json())
      .then((d: Data) => {
        setData(d);
        onCompte?.(d.connecteurs.length);
      })
      .catch(() => pushToast('error', 'Catalogue illisible.'));
  }, [pushToast, onCompte]);

  useEffect(() => lire(), [lire]);

  const installer = async (id: string, secrets: Record<string, string> | undefined, cible: 'locaux' | 'claude') => {
    setOccupe(id);
    try {
      const r = await fetch('/api/catalogue/installer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, cible, ...(secrets ? { secrets } : {}) }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        if (cible === 'claude') pushToast('info', 'Ajouté à Claude (claude mcp add).');
        else pushToast('info', d.branche ? `Branché sur les locaux (${d.outils} outils au total).` : 'Installé, mais le serveur n’a pas répondu — vérifie le jeton.');
        setFormulaire(null);
        lire();
      } else {
        pushToast('error', String(d.error || 'Échec de l’installation').slice(0, 180));
      }
    } catch {
      pushToast('error', 'Le daemon n’a pas répondu.');
    } finally {
      setOccupe(null);
    }
  };

  const desinstaller = async (id: string) => {
    setOccupe(id);
    try {
      const r = await fetch('/api/catalogue/desinstaller', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        pushToast('info', 'Connecteur retiré des locaux.');
        lire();
      } else pushToast('error', String(d.error || 'Échec').slice(0, 180));
    } catch {
      pushToast('error', 'Le daemon n’a pas répondu.');
    } finally {
      setOccupe(null);
    }
  };

  const parCategorie = useMemo(() => {
    if (!data) return [];
    const q = recherche.trim().toLowerCase();
    const garde = (c: Connecteur) =>
      !q || c.nom.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.categorie.toLowerCase().includes(q);
    return data.categories
      .map((cat) => ({ cat, items: data.connecteurs.filter((c) => c.categorie === cat && garde(c)) }))
      .filter((g) => g.items.length > 0);
  }, [data, recherche]);

  if (!data) {
    return (
      <p className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-muted">
        <LoaderCircle size={14} className="animate-spin" /> Lecture du catalogue…
      </p>
    );
  }

  const installe = (id: string) => data.installesLocaux.includes(id);

  return (
    <div className="space-y-4">
      {parCategorie.map(({ cat, items }) => (
        <div key={cat}>
          <div className="kicker px-1 pb-1.5">{cat}</div>
          <div className="space-y-2">
            {items.map((c) => (
              <div key={c.id} className="rounded-xl border border-line/70 bg-panel2/40 px-3.5 py-3">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-lg leading-none">{c.logo}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] text-ink">{c.nom}</span>
                      {c.types.map((t) => (
                        <span
                          key={t}
                          title={BADGE[t].titre}
                          className={cn('inline-flex items-center gap-1 rounded-md border border-line bg-base/40 px-1.5 py-0.5 text-[10px]', BADGE[t].classe)}
                        >
                          <span>{BADGE[t].rond}</span>
                          {BADGE[t].texte}
                        </span>
                      ))}
                      {installe(c.id) && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok">
                          <Check size={10} /> installé
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">{c.description}</p>

                    {/* Les trois mains : grisées quand le connecteur ne peut pas les servir. */}
                    <div className="mt-2 flex items-center gap-1.5">
                      {MAINS.map((m) => {
                        const ok = c.mains.includes(m.id);
                        return (
                          <span
                            key={m.id}
                            title={ok ? `Utilisable par ${m.label}` : `${m.label} ne peut pas utiliser ce connecteur`}
                            className={cn(
                              'rounded border px-1.5 py-0.5 text-[10px]',
                              ok ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line/60 text-muted opacity-40',
                            )}
                          >
                            {m.label}
                          </span>
                        );
                      })}
                    </div>

                    {c.alternativeJeton && (
                      <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn/90">
                        <KeyRound size={11} className="mb-0.5 mr-1 inline" />
                        {c.alternativeJeton}
                      </p>
                    )}

                    {c.note && <p className="mt-1.5 text-[10.5px] italic leading-snug text-muted">{c.note}</p>}
                    {c.competence && (
                      <p className="mt-1 text-[10.5px] leading-snug text-muted">
                        <Sparkles size={10} className="mb-0.5 mr-1 inline text-brand" />
                        Compétence suggérée : <span className="text-ink">{c.competence}</span>
                      </p>
                    )}

                    {/* Actions : installer sur les locaux et/ou sur Claude (les mains
                        possibles), ou retirer des locaux si déjà branché. */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {installe(c.id) && (
                        <button
                          onClick={() => desinstaller(c.id)}
                          disabled={occupe === c.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-50"
                        >
                          {occupe === c.id ? <LoaderCircle size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          Retirer des locaux
                        </button>
                      )}

                      {!installe(c.id) && c.local && c.mains.includes('locaux') && (
                        <button
                          onClick={() => (c.local!.secrets?.length ? setFormulaire({ id: c.id, cible: 'locaux' }) : installer(c.id, undefined, 'locaux'))}
                          disabled={occupe === c.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-[12px] font-medium text-onbrand transition-[filter] hover:brightness-110 disabled:opacity-50"
                        >
                          {occupe === c.id ? <LoaderCircle size={12} className="animate-spin" /> : c.local.secrets?.length ? <KeyRound size={12} /> : <Download size={12} />}
                          Sur les locaux
                        </button>
                      )}

                      {c.local && c.mains.includes('claude') && (
                        <button
                          onClick={() => (c.local!.secrets?.length ? setFormulaire({ id: c.id, cible: 'claude' }) : installer(c.id, undefined, 'claude'))}
                          disabled={occupe === c.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:border-brand/50 hover:text-ink disabled:opacity-50"
                        >
                          <Download size={12} /> Sur Claude
                        </button>
                      )}

                      {!c.local && <p className="text-[11px] italic text-muted">{c.oauthNote ?? 'Disponible via Claude uniquement.'}</p>}
                    </div>

                    {formulaire?.id === c.id && c.local?.secrets?.length && (
                      <FormJeton
                        secrets={c.local.secrets}
                        cible={formulaire.cible}
                        occupe={occupe === c.id}
                        onValider={(vals) => installer(c.id, vals, formulaire.cible)}
                        onAnnuler={() => setFormulaire(null)}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {parCategorie.length === 0 && <p className="py-10 text-center text-[12.5px] text-muted">Aucun connecteur ne correspond.</p>}
    </div>
  );
}

/** Le formulaire « coller le jeton » d'un connecteur ②. */
function FormJeton({
  secrets,
  cible,
  occupe,
  onValider,
  onAnnuler,
}: {
  secrets: SecretRequis[];
  cible: 'locaux' | 'claude';
  occupe: boolean;
  onValider: (vals: Record<string, string>) => void;
  onAnnuler: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const complet = secrets.every((s) => (vals[s.cle] ?? '').trim());
  return (
    <div className="mt-2.5 space-y-2 rounded-lg border border-line bg-base/40 p-3">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted">
        Installation sur {cible === 'claude' ? 'Claude' : 'les locaux'}
      </div>
      {secrets.map((s) => (
        <label key={s.cle} className="block">
          <span className="text-[11.5px] text-ink">{s.libelle}</span>
          <input
            type="password"
            autoComplete="off"
            value={vals[s.cle] ?? ''}
            onChange={(e) => setVals((v) => ({ ...v, [s.cle]: e.target.value }))}
            placeholder={s.cle}
            className="mt-1 w-full rounded-md border border-line bg-panel py-1.5 px-2.5 font-mono text-[12px] text-ink outline-none focus:border-brand/60"
          />
          <span className="mt-0.5 block text-[10.5px] leading-snug text-muted">{s.aide}</span>
        </label>
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={() => onValider(vals)}
          disabled={!complet || occupe}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-[12px] font-medium text-onbrand transition-[filter] hover:brightness-110 disabled:opacity-40"
        >
          {occupe ? <LoaderCircle size={12} className="animate-spin" /> : <Download size={12} />} Installer
        </button>
        <button onClick={onAnnuler} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-muted hover:text-ink">
          <X size={12} /> Annuler
        </button>
        <span className="flex-1" />
        <span className="text-[10.5px] text-muted">Stocké en local, fichier 0600.</span>
      </div>
    </div>
  );
}
