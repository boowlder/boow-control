import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import type { BoowMode } from '@boow/shared';
import { useCockpit, type TabId } from '../store/useCockpit';
import { sendCommand } from '../store/useSocket';

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const TAB_LABELS: Record<TabId, string> = {
  travail: 'Travail',
  routines: 'Routines',
  reglages: 'Réglages',
};

const MODES: { v: BoowMode; label: string }[] = [
  { v: 'normal', label: 'Normal' },
  { v: 'operation', label: 'Opération' },
  { v: 'claude', label: 'ClaudeCODE' },
];

export function CommandPalette() {
  const open = useCockpit((s) => s.paletteOpen);
  const setPalette = useCockpit((s) => s.setPalette);
  const setTab = useCockpit((s) => s.setTab);
  const setMode = useCockpit((s) => s.setMode);
  const demarrer = useCockpit((s) => s.demarrerSession);
  const agents = useCockpit((s) => s.agents.filter((a) => a.kind !== 'subagent'));
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];
    (Object.keys(TAB_LABELS) as TabId[]).forEach((t) =>
      list.push({ id: `tab:${t}`, label: `Aller à ${TAB_LABELS[t]}`, hint: 'onglet', run: () => setTab(t) }),
    );
    MODES.forEach((m) =>
      list.push({ id: `mode:${m.v}`, label: `Mode ${m.label}`, hint: 'mode', run: () => setMode(m.v) }),
    );
    list.push({ id: 'neuve', label: 'Nouvelle discussion', hint: 'session', run: () => demarrer() });
    list.push({ id: 'refresh', label: 'Rafraîchir le statut système', hint: 'système', run: () => sendCommand({ t: 'system.refresh' }) });
    ['sonnet', 'opus', 'haiku'].forEach((m) =>
      list.push({ id: `model:${m}`, label: `Claude Code → ${m}`, hint: 'modèle', run: () => sendCommand({ t: 'claude.config', id: 'claude-code', model: m }) }),
    );
    agents
      .filter((a) => a.chattable)
      .forEach((a) =>
        list.push({ id: `reset:${a.id}`, label: `Nouvelle session : ${a.name}`, hint: 'session', run: () => sendCommand({ t: 'chat.reset', id: a.id }) }),
      );
    return list;
  }, [agents, setTab, setMode, demarrer]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cmds;
    return cmds.filter((c) => c.label.toLowerCase().includes(s) || (c.hint ?? '').includes(s));
  }, [q, cmds]);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);
  useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  const run = (c?: Cmd) => {
    if (!c) return;
    c.run();
    setPalette(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(filtered[idx]);
    } else if (e.key === 'Escape') {
      setPalette(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fadein items-start justify-center bg-black/60 pt-[12vh] backdrop-blur-sm"
      onClick={() => setPalette(false)}
    >
      <div
        className="glass w-[580px] max-w-[92vw] animate-slideup overflow-hidden rounded-2xl shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line/70 px-4">
          <Search size={16} className="text-brand" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Tape une commande…"
            className="w-full bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-muted"
          />
          <kbd className="rounded-md border border-line bg-panel2/60 px-1.5 py-0.5 font-mono text-[10px] text-muted">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-auto p-2">
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Aucune commande</li>}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                onMouseEnter={() => setIdx(i)}
                onClick={() => run(c)}
                className={`relative flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                  i === idx ? 'bg-panel2 text-ink ring-1 ring-brand/25' : 'text-muted hover:bg-panel2/50'
                }`}
              >
                {i === idx && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-grad-brand" />}
                <span>{c.label}</span>
                {c.hint && (
                  <span className="rounded-md border border-line bg-panel2/50 px-1.5 py-0.5 text-[10px] text-muted">{c.hint}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
