import { useEffect } from 'react';
import { useCockpit, type Toast } from '../store/useCockpit';

const COLOR: Record<Toast['level'], string> = {
  info: '#7aa2ff',
  warn: '#fbbf24',
  error: '#f87171',
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useCockpit((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4200);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);
  return (
    <div className="flex animate-slideup items-start gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm shadow-lg">
      <span className="mt-1.5 h-1.5 w-1.5 rounded-full" style={{ background: COLOR[toast.level] }} />
      <span className="text-ink/90">{toast.text}</span>
    </div>
  );
}

export function Toasts() {
  const toasts = useCockpit((s) => s.toasts);
  // En haut à droite, sous les jauges : en bas ils recouvraient Envoyer.
  return (
    <div className="pointer-events-none fixed right-4 top-11 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
