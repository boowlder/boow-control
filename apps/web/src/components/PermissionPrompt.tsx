import { Check, ShieldQuestion, X } from 'lucide-react';
import { useCockpit } from '../store/useCockpit';
import { sendCommand } from '../store/useSocket';

// Quand un agent tourne en mode « me demander », chaque outil passe par ici.
// Visible depuis n'importe quelle page : une action attend une réponse, elle
// ne doit pas pouvoir se cacher derrière un écran.

/** Un mot simple pour dire ce que l'outil va faire. */
const CE_QUE_CA_FAIT: Record<string, string> = {
  // Outils Claude
  Write: 'écrire un fichier',
  Edit: 'modifier un fichier',
  MultiEdit: 'modifier plusieurs fichiers',
  NotebookEdit: 'modifier un notebook',
  Bash: 'lancer une commande',
  WebFetch: 'aller chercher une page web',
  WebSearch: 'faire une recherche web',
  Read: 'lire un fichier',
  // Catégories ACP, celles qu'annonce Hermès
  read: 'lire un fichier',
  edit: 'modifier un fichier',
  delete: 'supprimer',
  move: 'déplacer ou renommer',
  execute: 'lancer une commande',
  search: 'chercher',
  fetch: 'aller chercher une page web',
  switch_mode: 'changer son propre mode',
  other: 'utiliser un outil',
};

export function PermissionPrompt() {
  const permissions = useCockpit((s) => s.permissions);
  const agents = useCockpit((s) => s.agents);
  const ask = permissions[0];
  if (!ask) return null;

  const nom = agents.find((a) => a.id === ask.agentId)?.name ?? ask.agentId;
  const quoi = CE_QUE_CA_FAIT[ask.tool];
  const repondre = (allow: boolean) => sendCommand({ t: 'permission.answer', reqId: ask.reqId, allow });

  return (
    <div
      key={ask.reqId}
      className="fixed bottom-5 left-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 animate-in fade-in-0 slide-in-from-bottom-4"
    >
      <div className="overflow-hidden rounded-xl border border-warn/40 bg-panel shadow-pop">
          <header className="flex items-center gap-2.5 border-b border-line/70 bg-warn/10 px-4 py-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-warn/15 text-warn">
              <ShieldQuestion size={15} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">
                {nom} demande une autorisation
              </div>
              <div className="text-[11px] text-muted">
                {quoi ? `Il veut ${quoi}.` : `Outil : ${ask.tool}`}
              </div>
            </div>
            {permissions.length > 1 && (
              <span className="ml-auto shrink-0 rounded-full bg-panel2 px-2 py-0.5 text-[10px] text-muted">
                +{permissions.length - 1} en attente
              </span>
            )}
          </header>

          <div className="px-4 py-3">
            <div className="break-all rounded-md border border-line bg-panel2/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink">
              {ask.summary}
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-line/70 px-4 py-2.5">
            <span className="text-[11px] text-muted">Sans réponse, l'action est refusée au bout de 5 min.</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => repondre(false)}
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger/50 hover:text-danger"
              >
                <X size={13} /> Refuser
              </button>
              <button
                onClick={() => repondre(true)}
                autoFocus
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-onbrand transition-[filter] hover:brightness-110"
              >
                <Check size={13} /> Autoriser
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}
