import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useCockpit, type NotificationItem } from '../store/useCockpit';

const COLOR: Record<NotificationItem['level'], string> = {
  info: '#7aa2ff',
  warn: '#fbbf24',
  error: '#f87171',
};
const fmt = (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function NotificationCenter() {
  const notifs = useCockpit((s) => s.notifications);
  const markRead = useCockpit((s) => s.markNotificationsRead);
  const [open, setOpen] = useState(false);
  const unread = notifs.filter((n) => !n.read).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) markRead();
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        title="Notifications"
        className="relative grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:bg-panel2 hover:text-ink"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 animate-popin place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-onbrand">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 animate-in overflow-hidden rounded-2xl border border-line bg-panel shadow-pop fade-in-0 slide-in-from-top-2">
              <div className="flex items-center justify-between border-b border-line/70 px-3 py-2.5 text-sm">
                <span className="font-medium text-ink">Notifications</span>
                <span className="text-xs text-muted">{notifs.length}</span>
              </div>
              <ul className="max-h-80 overflow-auto">
                {notifs.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Rien pour l'instant.</li>}
                {notifs.map((n) => (
                  <li key={n.id} className="flex items-start gap-2.5 border-b border-line/40 px-3 py-2 last:border-0">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: COLOR[n.level] }} />
                    <span className="flex-1 text-sm text-ink/90">{n.text}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted">{fmt(n.ts)}</span>
                  </li>
                ))}
              </ul>
          </div>
        </>
      )}
    </div>
  );
}
