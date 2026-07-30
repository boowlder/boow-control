import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Volume2 } from 'lucide-react';
import { useCockpit, type ChatMsg } from '../store/useCockpit';
import { STATE_META } from '../lib/state-meta';
import { renderMarkdown } from '../lib/markdown';
import { nomCourt } from '../lib/agentNames';
import { speak } from '../lib/tts';
import { Composeur } from '../components/composer/Composeur';
import { OperationScreen } from './Operation';
import { cn } from '../lib/utils';

// L'écran principal : la conversation, et rien d'autre.
//
// Le composeur ne vit que sur cette page — dans Routines ou Réglages, une barre
// de saisie n'aurait personne à qui parler.

/* ── Chemins de fichiers cités dans une réponse ──────────────────────────── */
const CHEMIN_RE = /(~?\/[\w.@+-]+(?:\/[\w.@+-]+)+\.\w{1,6})/g;
const IMAGE_RE = /\.(?:png|jpe?g|webp|gif|bmp)$/i;

function chemins(texte: string): string[] {
  return [...new Set(texte.match(CHEMIN_RE) ?? [])].slice(0, 4);
}
/** Retire les lignes « Fichiers joints » ajoutées à l'envoi — bruit à l'écran. */
function sansLignesJointes(texte: string): string {
  return texte.replace(/\n*Fichiers joints \(chemins lisibles par l'agent\)\s*:\n(?:- .*\n?)*/g, '').trim();
}

function Fichier({ p }: { p: string }) {
  return (
    <a
      href={`/api/files/raw?path=${encodeURIComponent(p.replace(/^~/, ''))}`}
      target="_blank"
      rel="noreferrer"
      title={p}
      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-panel2/60 px-2.5 py-1.5 text-[11.5px] text-muted transition-colors hover:border-brand/40 hover:text-ink"
    >
      <span className="shrink-0 text-brand">▤</span>
      <span className="truncate font-mono">{p}</span>
    </a>
  );
}

const VERBE: Record<string, string> = { write: 'créé', edit: 'modifié', delete: 'supprimé', move: 'déplacé' };

/**
 * Un fichier produit par un agent, sous sa réponse — pas de fenêtre ni d'onglet
 * (décision de l'utilisateur). « aperçu » ouvre le fichier dans un onglet (marche à
 * distance) ; « dossier » ouvre l'explorateur Windows (PC seulement — masqué
 * si le daemon dit qu'il ne peut pas).
 */
function FichierProduit({ f }: { f: { path: string; action: string } }) {
  const nom = f.path.split('/').pop() ?? f.path;
  const supprime = f.action === 'delete';
  const reveler = async () => {
    try {
      const r = await fetch('/api/system/reveler', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: f.path }),
      });
      if (!r.ok) useCockpit.getState().pushToast('error', "Impossible d'ouvrir le dossier.");
    } catch {
      useCockpit.getState().pushToast('error', "Impossible d'ouvrir le dossier.");
    }
  };
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11.5px]" title={f.path}>
      <span className="shrink-0">📄</span>
      <span className={cn('truncate font-mono', supprime ? 'text-muted line-through' : 'text-ink')}>{nom}</span>
      <span className="shrink-0 text-muted/70">{VERBE[f.action] ?? 'touché'}</span>
      {!supprime && (
        <>
          <a
            href={`/api/files/raw?path=${encodeURIComponent(f.path.replace(/^~/, ''))}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-brand hover:underline"
          >
            aperçu
          </a>
          <span className="shrink-0 text-muted/40">·</span>
          <button onClick={reveler} className="shrink-0 text-muted hover:text-ink hover:underline">
            dossier
          </button>
        </>
      )}
    </div>
  );
}

/** Les fichiers produits, pliés au-delà de trois pour ne pas noyer la réponse. */
function FichiersProduits({ fichiers }: { fichiers: { path: string; action: string }[] }) {
  const [ouvert, setOuvert] = useState(fichiers.length <= 3);
  if (fichiers.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-line/60 bg-panel2/30 px-2.5 py-1.5">
      {!ouvert ? (
        <button onClick={() => setOuvert(true)} className="text-[11.5px] text-muted hover:text-ink">
          📄 {fichiers.length} fichiers touchés — voir
        </button>
      ) : (
        fichiers.map((f, i) => <FichierProduit key={`${f.path}-${i}`} f={f} />)
      )}
    </div>
  );
}

function Bulle({ m, agentId }: { m: ChatMsg; agentId: string }) {
  const moi = m.role === 'user';
  const corps = moi ? sansLignesJointes(m.text) : m.text;
  const images = moi ? (m.text.match(CHEMIN_RE) ?? []).filter((p) => IMAGE_RE.test(p)) : [];
  const fichiers = moi ? [] : chemins(m.text).filter((p) => !IMAGE_RE.test(p));

  return (
    <div className={cn('group flex animate-fadein items-end gap-1.5', moi ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[86%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed',
          moi ? 'rounded-br-md bg-panel2 text-ink' : 'rounded-bl-md border border-line/80 bg-panel/40 text-ink',
        )}
      >
        {!moi && !m.streaming ? (
          <span className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(corps) }} />
        ) : (
          <span className="whitespace-pre-wrap">{corps}</span>
        )}
        {m.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-breathe bg-current align-middle" />}

        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((p, i) => (
              <img
                key={i}
                src={`/api/files/raw?path=${encodeURIComponent(p)}`}
                alt=""
                className="max-h-44 rounded-lg border border-line object-contain"
              />
            ))}
          </div>
        )}
        {fichiers.map((p) => (
          <Fichier key={p} p={p} />
        ))}
        {!moi && m.fichiers && m.fichiers.length > 0 && <FichiersProduits fichiers={m.fichiers} />}
      </div>

      {!moi && !m.streaming && m.text.trim() && (
        <button
          onClick={() => speak(m.text, agentId)}
          title="Lire à voix haute"
          className="mb-1 shrink-0 rounded-md p-1 text-muted opacity-0 transition-opacity hover:text-brand group-hover:opacity-100"
        >
          <Volume2 size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Le cerveau dort (la veille rend la mémoire vidéo après 5 min — voulu).
 * Sans cette ligne, la première question après une pause reste ~30 s sans
 * signe de vie et ressemble à une panne. Retirée au premier mot reçu.
 */
function Reveil({ text }: { text: string }) {
  return (
    <div className="flex animate-fadein items-center justify-center gap-2 py-1 text-xs text-muted">
      <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-brand" />
      {text}
    </div>
  );
}

/**
 * « RÉPOND : CERVEAU LOCAL 35B · 2,1 S · 0 € »
 *
 * Qui a répondu, en combien de temps, pour combien. La durée est mesurée entre
 * le message de l'utilisateur et la réponse — pas une estimation. Le coût vient du
 * compteur de session de Claude ; en local il n'y en a pas, et c'est le
 * point : voir « 0 € » à chaque tour, c'est ce qui rend le mode normal lisible.
 */
function Entete() {
  const mode = useCockpit((s) => s.mode);
  const selected = useCockpit((s) => s.selectedAgent);
  const agents = useCockpit((s) => s.agents);
  const chats = useCockpit((s) => s.chats);
  const etat = useCockpit((s) => s.states[selected]?.state ?? 'idle');
  const cout = useCockpit((s) => s.claudeConfigs['claude-code']?.costUsd);

  const msgs = chats[selected] ?? [];
  const agent = agents.find((a) => a.id === selected);

  // Durée du dernier échange : de la question de l'utilisateur à la FIN de la réponse.
  // Sans `finTs`, on ne mesurerait que le délai avant le premier mot.
  const duree = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const rep = msgs[i];
      if (rep.role !== 'assistant' || rep.streaming) continue;
      for (let j = i - 1; j >= 0; j--) {
        if (msgs[j].role === 'user') return ((rep.finTs ?? rep.ts) - msgs[j].ts) / 1000;
      }
      return undefined;
    }
    return undefined;
  }, [msgs]);

  if (!agent) return null;
  const meta = STATE_META[etat];
  const local = mode === 'normal';

  return (
    <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3 text-[10px] uppercase tracking-[0.14em] text-muted">
      <span>Répond :</span>
      <span className="font-semibold text-ink" title={agent.name}>{nomCourt(agent.id, agent.name)}</span>
      {duree != null && <span className="tnum">· {duree.toFixed(1).replace('.', ',')} s</span>}
      <span className="tnum">· {local ? '0 €' : `${(cout ?? 0).toFixed(2).replace('.', ',')} $`}</span>
      {meta.active && (
        <span className="ml-auto inline-flex items-center gap-1.5 normal-case tracking-normal" style={{ color: meta.color }}>
          <span className="h-1.5 w-1.5 animate-breathe rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </span>
      )}
    </div>
  );
}

export function Travail() {
  const mode = useCockpit((s) => s.mode);
  const selected = useCockpit((s) => s.selectedAgent);
  const chats = useCockpit((s) => s.chats);
  // Les lignes système restent hors du fil — sauf la bulle de réveil, qui
  // existe justement pour être vue.
  const msgs = (chats[selected] ?? []).filter((m) => m.role !== 'system' || m.reveil);

  const filRef = useRef<HTMLDivElement>(null);
  const dernier = msgs[msgs.length - 1]?.text;
  useEffect(() => {
    filRef.current?.scrollTo({ top: filRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, dernier]);

  // Une opération ne vit pas dans `chats` mais dans son propre objet : sans
  // cet aiguillage, envoyer un message en mode opération n'affichait rien.
  if (mode === 'operation') return <OperationScreen />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {msgs.length > 0 && <Entete />}

      <div ref={filRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="mx-auto max-w-[820px] space-y-3">
          {msgs.length === 0 ? (
            <div className="grid h-full place-items-center py-20 text-center">
              <div className="animate-fadein">
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-panel2/50 text-brand">
                  <Sparkles size={22} />
                </div>
                <div className="text-xl font-semibold text-ink">Comment puis-je t’aider&nbsp;?</div>
                <div className="mt-1.5 text-sm text-muted">
                  {/* Le sous-titre dit la vérité du mode : en ClaudeCODE personne ne « choisit ». */}
                  {mode === 'claude'
                    ? 'Claude Code répond — avec ses outils, dans ton dossier de travail.'
                    : 'Écris ta demande en bas — je choisis qui répond.'}
                </div>
              </div>
            </div>
          ) : (
            msgs.map((m) => (m.reveil ? <Reveil key={m.id} text={m.text} /> : <Bulle key={m.id} m={m} agentId={selected} />))
          )}
        </div>
      </div>

      <Composeur />
    </div>
  );
}
