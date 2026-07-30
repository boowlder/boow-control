import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Compass, LoaderCircle, Send, Square } from 'lucide-react';
import type { Operation as Op, OperationEtape } from '@boow/shared';
import { useCockpit } from '../store/useCockpit';
import { sendCommand } from '../store/useSocket';
import { renderMarkdown } from '../lib/markdown';
import { Composeur } from '../components/composer/Composeur';
import { cn } from '../lib/utils';

// Le mode opération : on discute le projet avec Claude, puis on l'envoie aux
// locaux. Deux phases, deux affichages — la discussion, puis la carte.
//
// Les boutons « Envoyer aux locaux » et « Abandonner » vivent dans l'en-tête,
// pas dans le fil : dans la fenêtre de conversation, on risque de cliquer
// avant d'avoir fini d'écrire.

const STATUT_ETAPE: Record<string, { libelle: string; couleur: string }> = {
  attente: { libelle: 'en attente', couleur: 'text-muted' },
  encours: { libelle: 'en cours', couleur: 'text-brand' },
  ok: { libelle: 'fait', couleur: 'text-ok' },
  echec: { libelle: 'échec', couleur: 'text-danger' },
  ignore: { libelle: 'passée', couleur: 'text-muted' },
};

function Etape({ e }: { e: OperationEtape }) {
  const s = STATUT_ETAPE[e.statut] ?? STATUT_ETAPE.attente;
  return (
    <div className="flex gap-3 rounded-xl border border-line/70 bg-panel/40 px-3.5 py-3">
      <span className="mt-1 shrink-0">
        {e.statut === 'encours' ? (
          <LoaderCircle size={14} className="animate-spin text-brand" />
        ) : (
          <span
            className={cn(
              'block h-2.5 w-2.5 rounded-full',
              e.statut === 'ok' ? 'bg-ok' : e.statut === 'echec' ? 'bg-danger' : 'bg-line',
            )}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{e.titre}</div>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{e.critere}</p>
        {e.detail && <p className="mt-1 text-[11.5px] leading-snug text-muted/80">{e.detail}</p>}
      </div>
      <span className="shrink-0 text-right">
        <span className={cn('text-[11px]', s.couleur)}>{s.libelle}</span>
        <span className="block text-[10px] text-muted/60">{e.executant}</span>
      </span>
    </div>
  );
}

/** Ce que l'opération a déjà coûté, et ce qu'il reste au compteur automatique. */
function Compteurs({ op }: { op: Op }) {
  const pct = op.budget > 0 ? Math.min(100, (op.appelsAuto / op.budget) * 100) : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-2 pt-3 text-[11px] text-muted">
      <span>
        Discussion : <b className="tnum text-ink">{op.appelsClaude - op.appelsAuto}</b> échange
        {op.appelsClaude - op.appelsAuto > 1 ? 's' : ''} — libre
      </span>
      <span className="h-3 w-px bg-line" />
      <span className="inline-flex items-center gap-2">
        Automatique : <b className="tnum text-ink">{op.appelsAuto}</b> / {op.budget}
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
          <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span className="h-3 w-px bg-line" />
      <span className="tnum">{op.coutUsd.toFixed(2).replace('.', ',')} $</span>
    </div>
  );
}

/** Réglages de l'envoi aux locaux : le budget que l'utilisateur accepte de laisser filer. */
function Envoi({ op, onFerme }: { op: Op; onFerme: () => void }) {
  const [budget, setBudget] = useState(op.budget || 6);
  const [revue, setRevue] = useState(op.revueFinale);
  return (
    <div className="mx-auto mb-3 max-w-[820px] rounded-xl border border-brand/40 bg-panel/60 p-4">
      <h3 className="text-[13px] font-semibold text-ink">Envoyer aux locaux</h3>
      <p className="mt-1 text-[12px] leading-snug text-muted">
        Claude va transformer la discussion en carte d'exécution, puis les modèles locaux
        l'exécutent seuls. Le budget ne borne que cette partie automatique — la discussion
        que vous venez d'avoir reste hors compte.
      </p>

      <label className="mt-3 block text-[12px] text-ink">
        Appels à Claude autorisés sans toi : <b className="tnum text-brand">{budget}</b>
        <input
          type="range"
          min={1}
          max={30}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="mt-1 w-full accent-brand"
        />
      </label>

      <label className="mt-2 flex items-center gap-2 text-[12px] text-ink">
        <input type="checkbox" checked={revue} onChange={(e) => setRevue(e.target.checked)} className="accent-brand" />
        Revue finale par Claude quand tout est fini
      </label>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => {
            sendCommand({ t: 'operation.carte', id: op.id, budget, revueFinale: revue });
            onFerme();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[12.5px] font-semibold text-onbrand transition-[filter] hover:brightness-110"
        >
          <Send size={13} /> Dresser la carte et lancer
        </button>
        <button
          onClick={onFerme}
          className="rounded-lg border border-line px-3 py-2 text-[12.5px] text-muted transition-colors hover:text-ink"
        >
          Pas encore
        </button>
      </div>
    </div>
  );
}

export function OperationScreen() {
  const operations = useCockpit((s) => s.operations);
  const op = operations[0];
  const [envoiOuvert, setEnvoiOuvert] = useState(false);

  const filRef = useRef<HTMLDivElement>(null);
  const dernier = op?.echanges[op.echanges.length - 1]?.texte;
  useEffect(() => {
    filRef.current?.scrollTo({ top: filRef.current.scrollHeight, behavior: 'smooth' });
    // envoiOuvert dans les dépendances : à l'ouverture du panneau, on défile
    // jusqu'à lui pour qu'il soit visible sans avoir à chercher.
  }, [op?.echanges.length, dernier, op?.etapes.length, envoiOuvert]);

  const enDiscussion = op?.statut === 'brainstorm';
  const enCours = op?.statut === 'encours';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {op && (
        <>
          <Compteurs op={op} />
          <div className="flex items-center gap-2 border-b border-line/70 px-4 pb-2.5">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{op.titre}</span>
            {enDiscussion && (
              <>
                <button
                  onClick={() => setEnvoiOuvert((o) => !o)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-onbrand transition-[filter] hover:brightness-110"
                >
                  <Send size={12} /> Envoyer aux locaux
                </button>
                <button
                  onClick={() => sendCommand({ t: 'operation.stop', id: op.id })}
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-danger/50 hover:text-danger"
                >
                  Abandonner
                </button>
              </>
            )}
            {enCours && (
              <button
                onClick={() => sendCommand({ t: 'operation.stop', id: op.id })}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-danger/50 hover:text-danger"
              >
                <Square size={11} /> Arrêter
              </button>
            )}
          </div>
        </>
      )}

      <div ref={filRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="mx-auto max-w-[820px] space-y-3">
          {!op && (
            <div className="grid place-items-center py-20 text-center">
              <div className="animate-fadein">
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-panel2/50 text-brand">
                  <Compass size={22} />
                </div>
                <div className="text-xl font-semibold text-ink">Parle-moi du projet</div>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
                  Claude et toi en discutez d'abord, autant que tu veux — c'est gratuit tant que
                  tu tapes. Quand c'est clair, tu cliques « Envoyer aux locaux » et il en fait
                  une carte que tes modèles exécutent.
                </p>
              </div>
            </div>
          )}

          {op?.echanges.map((e, i) => (
            <div key={i} className={cn('flex animate-fadein', e.role === 'moi' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[86%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed',
                  e.role === 'moi'
                    ? 'rounded-br-md bg-panel2 text-ink'
                    : 'rounded-bl-md border border-line/80 bg-panel/40 text-ink',
                )}
              >
                {e.role === 'moi' ? (
                  <span className="whitespace-pre-wrap">{e.texte}</span>
                ) : (
                  <span className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(e.texte) }} />
                )}
              </div>
            </div>
          ))}

          {/* Le panneau d'envoi s'ouvre À LA SUITE de la discussion, là où
              l'utilisateur vient de finir d'écrire — pas tout en haut, ce qui l'obligeait
              à remonter tout le fil pour dresser la carte. */}
          {envoiOuvert && op && <Envoi op={op} onFerme={() => setEnvoiOuvert(false)} />}

          {op && op.etapes.length > 0 && (
            <div className="space-y-2 pt-2">
              <span className="kicker">Carte d'exécution</span>
              {op.etapes.map((e) => (
                <Etape key={e.id} e={e} />
              ))}
            </div>
          )}

          {op?.message && (
            <p className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-3 text-[12.5px] text-warn">
              <CircleAlert size={14} className="mt-0.5 shrink-0" />
              {op.message}
            </p>
          )}

          {op?.revue && (
            <div className="rounded-xl border border-line/70 bg-panel/40 px-3.5 py-3">
              <span className="kicker">Revue finale</span>
              <div className="md mt-1.5 text-[13px] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(op.revue) }} />
            </div>
          )}
        </div>
      </div>

      <Composeur />
    </div>
  );
}
