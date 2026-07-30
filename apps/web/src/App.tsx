import { useEffect, type ComponentType } from 'react';
import { TtsEngine } from './components/TtsEngine';
import { Toasts } from './components/Toasts';
import { CommandPalette } from './components/CommandPalette';
import { PermissionPrompt } from './components/PermissionPrompt';
import { Sidebar } from './components/shell/Sidebar';
import { ModeBar } from './components/shell/ModeBar';
import { Telemetry } from './components/shell/Telemetry';
import { applyTheme, appliquerAccent, useCockpit, PAGE_DE, type TabId } from './store/useCockpit';
import { connectSocket } from './store/useSocket';
import { Travail } from './tabs/Travail';
import { Routines } from './tabs/Routines';
import { Reglages } from './tabs/Reglages';

const PAGES: Record<TabId, ComponentType> = {
  travail: Travail,
  routines: Routines,
  reglages: Reglages,
};

/** Les trois lieux, dans l'ordre de la barre latérale — pour les touches 1/2/3. */
const RACCOURCIS: TabId[] = [PAGE_DE.travail, PAGE_DE.routines, PAGE_DE.reglages];

export function App() {
  const tab = useCockpit((s) => s.tab);
  useEffect(() => {
    applyTheme(useCockpit.getState().theme);
    appliquerAccent(useCockpit.getState().mode);
    connectSocket();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useCockpit.getState().togglePalette();
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
      if (typing || useCockpit.getState().paletteOpen) return;
      const n = Number(e.key);
      if (n >= 1 && n <= RACCOURCIS.length) useCockpit.getState().setTab(RACCOURCIS[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const Page = PAGES[tab];
  return (
    <div className="flex h-full flex-col text-ink">
      <Telemetry />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <ModeBar />
          <div key={tab} className="min-h-0 flex-1 animate-fadein overflow-auto">
            <Page />
          </div>
        </main>
      </div>
      <Toasts />
      <PermissionPrompt />
      <CommandPalette />
      <TtsEngine />
    </div>
  );
}
