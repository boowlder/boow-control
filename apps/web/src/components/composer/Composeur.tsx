import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Loader2, Mic, Paperclip, Plus, Send, Square, X } from 'lucide-react';
import { Mention, useMention } from './Mention';
import { SlashMenu, useSlash } from './Slash';
import { useCockpit } from '../../store/useCockpit';
import { sendCommand } from '../../store/useSocket';
import { Dossier } from './Dossier';
import { ModeTravail } from './ModeTravail';
import { Modele } from './Modele';
import { Effort } from './Effort';
import { JaugeContexte } from './JaugeContexte';
import { cn } from '../../lib/utils';

// Une seule barre de saisie, dans Travail et nulle part ailleurs. Le daemon
// choisit qui répond selon le mode ; d'ici, on ne s'en occupe pas.

interface PieceJointe {
  name: string;
  path: string;
}

const PLACEHOLDER: Record<string, string> = {
  normal: 'Écris ta demande — je choisis le bon modèle local…',
  operation: 'Parle du projet à Claude — vous en discutez d’abord…',
  claude: 'Parle à Claude Code…',
};

export function Composeur() {
  const mode = useCockpit((s) => s.mode);
  const connected = useCockpit((s) => s.connected);
  const pushToast = useCockpit((s) => s.pushToast);
  const operationEnCours = useCockpit((s) => s.operations.find((o) => o.statut === 'brainstorm')?.id);
  // L'agent de la conversation courante et son état : sert au bouton Stop, qui
  // remplace « Envoyer » tant qu'une génération tourne (locaux, Claude, Hermès).
  const agentActif = useCockpit((s) => s.selectedAgent);
  const etatActif = useCockpit((s) => s.states[s.selectedAgent]?.state);
  const enCours = ['thinking', 'analyzing', 'planning', 'working', 'delegating', 'spawning'].includes(etatActif ?? '');

  const [texte, setTexte] = useState('');
  const [pieces, setPieces] = useState<PieceJointe[]>([]);
  const [envoiFichier, setEnvoiFichier] = useState(false);
  const zoneRef = useRef<HTMLTextAreaElement>(null);
  const fichierRef = useRef<HTMLInputElement>(null);

  const televerser = async (liste: FileList | null) => {
    if (!liste?.length) return;
    setEnvoiFichier(true);
    for (const f of Array.from(liste)) {
      try {
        // Le daemon attend le fichier BRUT (octet-stream) avec le nom dans
        // l'URL — pas un FormData multipart, qu'il ne sait pas lire. C'était
        // la cause du « refusé » sur toute pièce jointe.
        const r = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: f,
        });
        const d = await r.json();
        if (d?.path) setPieces((x) => [...x, { name: f.name, path: d.path }]);
        else pushToast('error', `Envoi de ${f.name} refusé${d?.error ? ` (${d.error})` : ''}.`);
      } catch {
        pushToast('error', `Impossible d'envoyer ${f.name}.`);
      }
    }
    setEnvoiFichier(false);
    if (fichierRef.current) fichierRef.current.value = '';
  };

  // Coller une capture d'écran = la joindre, comme dans l'appli Claude.
  const coller = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      void televerser(e.clipboardData.files);
    }
  };

  // Déposer un fichier n'importe où sur la page = le joindre. Le compteur
  // évite le clignotement de l'overlay quand on survole les enfants.
  const [glisse, setGlisse] = useState(false);
  const compteurGlisse = useRef(0);
  useEffect(() => {
    const avecFichiers = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const entre = (e: DragEvent) => {
      if (!avecFichiers(e)) return;
      compteurGlisse.current++;
      setGlisse(true);
    };
    const sort = (e: DragEvent) => {
      if (!avecFichiers(e)) return;
      compteurGlisse.current = Math.max(0, compteurGlisse.current - 1);
      if (compteurGlisse.current === 0) setGlisse(false);
    };
    const survole = (e: DragEvent) => {
      if (avecFichiers(e)) e.preventDefault();
    };
    const depose = (e: DragEvent) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      compteurGlisse.current = 0;
      setGlisse(false);
      void televerser(e.dataTransfer?.files ?? null);
    };
    window.addEventListener('dragenter', entre);
    window.addEventListener('dragleave', sort);
    window.addEventListener('dragover', survole);
    window.addEventListener('drop', depose);
    return () => {
      window.removeEventListener('dragenter', entre);
      window.removeEventListener('dragleave', sort);
      window.removeEventListener('dragover', survole);
      window.removeEventListener('drop', depose);
    };
    // televerser est stable dans ce composant : pas de dépendance utile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La mention @ : liste des fichiers du dossier de travail.
  const mention = useMention(texte, zoneRef, setTexte);
  // Le menu / : commandes rapides au clavier (nouvelle discussion, stop, mode…).
  const slash = useSlash(texte, setTexte);

  const envoyer = () => {
    const v = texte.trim();
    if (!v && pieces.length === 0) return;
    if (!connected) {
      pushToast('error', 'Daemon déconnecté — lance le cockpit : pnpm dev');
      return;
    }

    // Mode opération : on prépare le projet avec Claude. La carte n'est dressée
    // que quand l'utilisateur clique « Envoie aux locaux ».
    if (mode === 'operation') {
      sendCommand({ t: 'operation.brainstorm', ...(operationEnCours ? { id: operationEnCours } : {}), text: v });
      setTexte('');
      setPieces([]);
      return;
    }

    const lignes = pieces.length
      ? `\n\nFichiers joints (chemins lisibles par l'agent) :\n${pieces.map((p) => `- ${p.path}`).join('\n')}`
      : '';
    sendCommand({ t: 'chat.route', mode, text: `${v}${lignes}`.trim(), attachments: pieces.map((p) => p.path) });
    setTexte('');
    setPieces([]);
  };

  const touche = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Les menus @ et / ouverts captent flèches, Entrée, Tab et Échap.
    if (slash.surTouche(e)) return;
    if (mention.surTouche(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      envoyer();
    }
  };

  // Dictée locale : le micro passe par whisper sur la machine (route
  // /api/oreille), plus par la reconnaissance du navigateur qui envoyait la
  // voix chez Google. Disponible seulement si le worker est là.
  const mediaRef = useRef<MediaRecorder | null>(null);
  const morceauxRef = useRef<Blob[]>([]);
  const [ecoute, setEcoute] = useState(false);
  const [transcrit, setTranscrit] = useState(false);
  const [oreilleOk, setOreilleOk] = useState(false);

  useEffect(() => {
    let vivant = true;
    fetch('/api/oreille/status')
      .then((r) => r.json())
      .then((d: { disponible?: boolean }) => vivant && setOreilleOk(!!d.disponible && !!navigator.mediaDevices))
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, []);

  const micro = async () => {
    if (ecoute) {
      mediaRef.current?.stop();
      return;
    }
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(flux);
      morceauxRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && morceauxRef.current.push(e.data);
      rec.onstop = async () => {
        flux.getTracks().forEach((t) => t.stop());
        setEcoute(false);
        const blob = new Blob(morceauxRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        setTranscrit(true);
        try {
          const r = await fetch('/api/oreille', {
            method: 'POST',
            headers: { 'content-type': blob.type },
            body: blob,
          });
          const d = await r.json();
          if (d.texte) setTexte((t) => (t ? `${t} ${d.texte}` : d.texte));
          else if (d.error) pushToast('error', `Dictée : ${d.error}`);
        } catch {
          pushToast('error', 'La dictée locale a échoué.');
        } finally {
          setTranscrit(false);
          zoneRef.current?.focus();
        }
      };
      mediaRef.current = rec;
      rec.start();
      setEcoute(true);
    } catch {
      pushToast('error', "Micro inaccessible — autorise-le dans le navigateur.");
    }
  };

  return (
    <div className="shrink-0 px-4 pb-4">
      {glisse && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-base/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-brand px-8 py-6 text-sm text-ink">
            Dépose pour joindre
          </div>
        </div>
      )}
      <div className="relative mx-auto max-w-[820px] rounded-2xl border border-line/80 bg-panel/50 backdrop-blur-xl">
        <Mention m={mention} />
        <SlashMenu s={slash} />
        {pieces.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
            {pieces.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2/60 px-2 py-1 text-[11px] text-ink"
              >
                <Paperclip size={11} className="text-brand" />
                <span className="max-w-[160px] truncate">{p.name}</span>
                <button
                  onClick={() => setPieces((x) => x.filter((_, j) => j !== i))}
                  className="text-muted transition-colors hover:text-danger"
                  title="Retirer"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={zoneRef}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={touche}
          onPaste={coller}
          rows={2}
          placeholder={PLACEHOLDER[mode]}
          className="w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-muted"
        />

        {/* Disposition décidée avec l'utilisateur : à gauche ce qui cadre le travail
            (dossier, mode, pièces jointes) ; à droite ce qui règle Claude
            (modèle, effort), collé au bouton d'envoi. */}
        <div className="flex items-center gap-1.5 px-3 pb-3">
          <Dossier />
          <ModeTravail />

          <input ref={fichierRef} type="file" multiple className="hidden" onChange={(e) => televerser(e.target.files)} />
          <button
            onClick={() => fichierRef.current?.click()}
            title="Joindre un fichier ou une image"
            className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-panel2/60 hover:text-ink"
          >
            <Plus size={15} />
            {envoiFichier && <span className="absolute -right-1 -top-1 h-2 w-2 animate-ping rounded-full bg-brand" />}
          </button>

          {oreilleOk && (
            <button
              onClick={micro}
              disabled={transcrit}
              title={transcrit ? 'Transcription…' : ecoute ? 'Arrêter et transcrire' : 'Dicter (transcrit sur la machine)'}
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors',
                ecoute
                  ? 'animate-pulse text-danger'
                  : transcrit
                    ? 'text-brand'
                    : 'text-muted hover:bg-panel2/60 hover:text-ink',
              )}
            >
              {transcrit ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
            </button>
          )}

          <span className="flex-1" />

          {/* En mode normal, la jauge dit où en est le contexte du cerveau
              local (et donc quand la session va se compacter). */}
          {mode === 'normal' && <JaugeContexte />}

          {/* Modèle et effort ne servent qu'aux modes qui appellent Claude :
              en mode normal, c'est le routeur local qui choisit. */}
          {mode !== 'normal' && (
            <>
              <Modele />
              <Effort />
            </>
          )}

          {enCours ? (
            <button
              onClick={() => sendCommand({ t: 'chat.cancel', id: agentActif })}
              title="Arrêter la génération en cours"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/50 bg-danger/10 px-3.5 py-2 text-[12.5px] font-semibold text-danger transition-colors hover:bg-danger/20"
            >
              <Square size={11} className="fill-current" /> Arrêter
            </button>
          ) : (
            <button
              onClick={envoyer}
              disabled={!texte.trim() && pieces.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[12.5px] font-semibold text-onbrand transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
            >
              <Send size={13} /> Envoyer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
