import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import { Eraser, LayoutGrid, MessageSquarePlus, Square, Wand2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BoowMode } from '@boow/shared';
import { useCockpit } from '../../store/useCockpit';
import { sendCommand } from '../../store/useSocket';
import { cn } from '../../lib/utils';

// Le menu slash, réflexe Claude Code : taper « / » en début de saisie ouvre une
// courte liste de commandes (nouvelle discussion, arrêter, changer de mode…).
// C'est du sucre par-dessus l'existant — mêmes actions que la palette Ctrl+K et
// les boutons — pour qui préfère le clavier. On filtre en tapant, Entrée exécute.

interface Commande {
  cle: string;
  libelle: string;
  hint: string;
  alias?: string[];
  icone: LucideIcon;
  run: () => void;
}

export function useSlash(texte: string, setTexte: (v: string) => void) {
  const setMode = useCockpit((s) => s.setMode);
  const demarrer = useCockpit((s) => s.demarrerSession);
  const setPalette = useCockpit((s) => s.setPalette);
  const agentActif = useCockpit((s) => s.selectedAgent);
  const [sel, setSel] = useState(0);

  // Actif seulement quand toute la saisie est « /commande-en-cours » : un « / »
  // au milieu d'un texte (chemin, date…) ne déclenche rien.
  const requete = useMemo(() => {
    const m = texte.match(/^\/([a-zà-ÿ-]*)$/i);
    return m ? m[1].toLowerCase() : null;
  }, [texte]);

  const commandes = useMemo<Commande[]>(
    () => [
      { cle: 'neuf', libelle: 'Nouvelle discussion', hint: 'session', alias: ['nouveau', 'new'], icone: MessageSquarePlus, run: () => demarrer() },
      { cle: 'stop', libelle: 'Arrêter la génération', hint: 'stop', alias: ['arreter', 'arrêter'], icone: Square, run: () => sendCommand({ t: 'chat.cancel', id: agentActif }) },
      { cle: 'effacer', libelle: 'Vider la mémoire du cerveau', hint: 'reset', alias: ['reset', 'clear'], icone: Eraser, run: () => sendCommand({ t: 'chat.reset', id: agentActif }) },
      { cle: 'normal', libelle: 'Mode Normal (local)', hint: 'mode', icone: Wand2, run: () => setMode('normal' as BoowMode) },
      { cle: 'operation', libelle: 'Mode Opération', hint: 'mode', icone: Wand2, run: () => setMode('operation' as BoowMode) },
      { cle: 'claude', libelle: 'Mode ClaudeCODE', hint: 'mode', icone: Wand2, run: () => setMode('claude' as BoowMode) },
      { cle: 'palette', libelle: 'Ouvrir la palette de commandes', hint: 'Ctrl+K', alias: ['cmd', 'k'], icone: LayoutGrid, run: () => setPalette(true) },
    ],
    [setMode, demarrer, setPalette, agentActif],
  );

  const resultats = useMemo(() => {
    if (requete === null) return [];
    if (!requete) return commandes;
    return commandes.filter((c) => c.cle.startsWith(requete) || (c.alias ?? []).some((a) => a.startsWith(requete)));
  }, [requete, commandes]);

  const executer = useCallback(
    (c: Commande) => {
      c.run();
      setTexte('');
      setSel(0);
    },
    [setTexte],
  );

  const surTouche = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (requete === null) return false;
      if (e.key === 'Escape') {
        e.preventDefault();
        setTexte('');
        return true;
      }
      if (resultats.length === 0) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => (s + 1) % resultats.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => (s - 1 + resultats.length) % resultats.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        executer(resultats[Math.min(sel, resultats.length - 1)]);
        return true;
      }
      return false;
    },
    [requete, resultats, sel, executer, setTexte],
  );

  return { ouverte: resultats.length > 0, resultats, sel: Math.min(sel, Math.max(0, resultats.length - 1)), executer, surTouche };
}

export function SlashMenu({ s }: { s: ReturnType<typeof useSlash> }) {
  if (!s.ouverte) return null;
  return (
    <div className="absolute bottom-full left-3 z-30 mb-2 w-[360px] max-w-[90%] overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
      <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-muted">Commandes</div>
      {s.resultats.map((c, i) => {
        const Ic = c.icone;
        return (
          <button
            key={c.cle}
            onMouseDown={(e) => {
              e.preventDefault();
              s.executer(c);
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors',
              i === s.sel ? 'bg-panel2 text-ink' : 'text-muted hover:bg-panel2/60',
            )}
          >
            <Ic size={12} className="shrink-0 text-brand" />
            <span className="flex-1 truncate">
              <span className="font-mono text-muted">/{c.cle}</span> · {c.libelle}
            </span>
            <span className="shrink-0 rounded border border-line bg-panel2/50 px-1.5 py-0.5 text-[10px] text-muted">{c.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
