import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import { useCockpit } from '../../store/useCockpit';
import { cn } from '../../lib/utils';

// La mention @, comme dans Claude Code : taper « @ » ouvre la liste des
// fichiers du dossier de travail, on filtre en tapant, Entrée insère le
// chemin. L'arbre vient du daemon (/api/files/arbre) — jamais node_modules,
// et il est mis en cache par dossier : un seul appel par changement de projet.

const VISIBLES = 10;

export function useMention(
  texte: string,
  zone: RefObject<HTMLTextAreaElement | null>,
  setTexte: (v: string) => void,
) {
  const cwd = useCockpit((s) => s.claudeConfigs['claude-code']?.cwd);
  const [arbre, setArbre] = useState<{ cwd: string; fichiers: string[] } | null>(null);
  const [requete, setRequete] = useState<{ debut: number; texte: string } | null>(null);
  const [sel, setSel] = useState(0);

  // « @quelque-chose » juste avant le curseur ? Un @ au milieu d'un mot
  // (adresse mail…) ne compte pas.
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    const avant = texte.slice(0, el.selectionStart ?? texte.length);
    const m = avant.match(/(?:^|[\s(])@([\w./-]*)$/);
    if (!m) {
      setRequete(null);
      return;
    }
    setRequete({ debut: avant.length - m[1].length - 1, texte: m[1] });
    setSel(0);
  }, [texte, zone]);

  // L'arbre du dossier courant, chargé à la première mention.
  useEffect(() => {
    if (!requete || !cwd || arbre?.cwd === cwd) return;
    fetch(`/api/files/arbre?path=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((d: { fichiers?: string[] }) => setArbre({ cwd, fichiers: d.fichiers ?? [] }))
      .catch(() => setArbre({ cwd, fichiers: [] }));
  }, [requete, cwd, arbre]);

  const resultats = useMemo(() => {
    if (!requete || !arbre) return [];
    const q = requete.texte.toLowerCase();
    const trouves = q ? arbre.fichiers.filter((f) => f.toLowerCase().includes(q)) : arbre.fichiers;
    // Les chemins courts d'abord : ce qu'on cherche est rarement enfoui.
    return trouves
      .slice()
      .sort((a, b) => a.length - b.length)
      .slice(0, VISIBLES);
  }, [requete, arbre]);

  const inserer = useCallback(
    (chemin: string) => {
      if (!requete) return;
      const el = zone.current;
      const fin = el?.selectionStart ?? texte.length;
      setTexte(`${texte.slice(0, requete.debut)}@${chemin} ${texte.slice(fin)}`);
      setRequete(null);
      requestAnimationFrame(() => {
        el?.focus();
        const pos = requete.debut + chemin.length + 2;
        el?.setSelectionRange(pos, pos);
      });
    },
    [requete, texte, setTexte, zone],
  );

  /** Rend `true` si la touche a été consommée par la liste. */
  const surTouche = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!requete) return false;
      if (e.key === 'Escape') {
        e.preventDefault();
        setRequete(null);
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
        inserer(resultats[sel]);
        return true;
      }
      return false;
    },
    [requete, resultats, sel, inserer],
  );

  return {
    ouverte: !!requete,
    chargement: !!requete && !!cwd && arbre?.cwd !== cwd,
    resultats,
    sel,
    inserer,
    surTouche,
  };
}

export function Mention({ m }: { m: ReturnType<typeof useMention> }) {
  if (!m.ouverte || (!m.chargement && m.resultats.length === 0)) return null;
  return (
    <div className="absolute bottom-full left-3 z-30 mb-2 w-[440px] max-w-[90%] overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
      <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-muted">
        Fichiers du dossier de travail
      </div>
      {m.chargement && (
        <p className="flex items-center gap-2 px-3 pb-2.5 text-[12px] text-muted">
          <LoaderCircle size={12} className="animate-spin" /> Lecture du dossier…
        </p>
      )}
      {m.resultats.map((f, i) => (
        <button
          key={f}
          // onMouseDown + preventDefault : le clic ne doit pas voler le focus
          // de la zone de saisie.
          onMouseDown={(e) => {
            e.preventDefault();
            m.inserer(f);
          }}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors',
            i === m.sel ? 'bg-panel2 text-ink' : 'text-muted hover:bg-panel2/60',
          )}
        >
          <FileText size={12} className="shrink-0 text-brand" />
          <span className="truncate">{f}</span>
        </button>
      ))}
    </div>
  );
}
