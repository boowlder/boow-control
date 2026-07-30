import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentId, ClientCommand, ServerEvent, SystemStatus } from '@boow/shared';
import type { Bus } from '../bus';
import type { Registry } from '../registry';
import type { TaskManager } from '../task-manager';
import { isAllowedOrigin } from '../config';
import { checkSystem } from '../probes/services';
import { cancelChat, resetQwen, runQwenChat } from '../agents/qwen';
import {
  cancelClaude,
  checkClaudeAuth,
  getClaudeConfig,
  isLocalOnly,
  resetClaudeSession,
  runClaude,
  setClaudeApiKey,
  setClaudeConfig,
  setLocalOnly,
} from '../agents/claude';
import {
  cachedCapabilities,
  cachedUsage,
  claudeCapabilities,
  claudeUsage,
} from '../agents/claude-probe';
import { cancelHermes, getLocalConfig, resetHermes, runHermes, setLocalPermissionMode } from '../agents/hermes';
import { repondrePermission } from '../permissions';
import { decide } from '../routing';
import {
  arreterOperation,
  brainstormer,
  dresserCarte,
  lancerOperationDirecte,
  listerOperations,
  reprendreOperation,
} from '../operations';
import {
  basculerRoutine,
  creerRoutine,
  modifierRoutine,
  executerRoutine,
  listerRoutines,
  supprimerRoutine,
} from '../routines';

/** Reflète l'état des services sur les agents (brain->qwen, CLI->claude-code/hermes). */
export function syncOnline(system: SystemStatus, registry: Registry): void {
  const claudeOk = system.services.find((s) => s.id === 'claude')?.ok ?? false;
  const cerveauOk = system.services.find((s) => s.id === 'brain')?.ok ?? false;
  registry.setOnline('qwen', cerveauOk);
  // L'œil vit derrière le même serveur de modèles que le cerveau.
  registry.setOnline('oeil', cerveauOk);
  registry.setOnline('claude-code', claudeOk);
  registry.setOnline('hermes', system.services.find((s) => s.id === 'hermes')?.ok ?? false);
}

/** Annule l'activité en cours d'un agent selon son provider. */
function cancelAgent(bus: Bus, registry: Registry, id: AgentId): void {
  const meta = registry.get(id);
  if (meta?.provider === 'claude-code') cancelClaude(bus, id);
  else if (meta?.provider === 'hermes-acp') cancelHermes(bus);
  else cancelChat(id);
}

/** Lance un prompt sur l'agent selon son provider. Retourne false si non routable. */
function dispatch(bus: Bus, registry: Registry, agentId: AgentId, prompt: string, attachments?: string[]): boolean {
  const meta = registry.get(agentId);
  if (meta?.provider === 'qwen') void runQwenChat(bus, registry, agentId, prompt, attachments);
  else if (meta?.provider === 'claude-code') void runClaude(bus, registry, agentId, prompt);
  else if (meta?.provider === 'hermes-acp') void runHermes(bus, registry, agentId, prompt);
  else return false;
  return true;
}

/** Attache le serveur WebSocket sur /ws et relaie commandes <-> évènements. */
export function attachWs(server: Server, bus: Bus, registry: Registry, tasks: TaskManager): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '';
    const origin = req.headers.origin;
    // /ws uniquement, et origine autorisée (loopback + IP privées WSL/LAN ; sans origine = ok).
    if (pathname !== '/ws' || !isAllowedOrigin(origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', async (ws: WebSocket) => {
    const send = (e: ServerEvent) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
    };
    const unsubscribe = bus.subscribe(send);

    // Handshake : snapshot complet de l'état.
    const system = await checkSystem();
    syncOnline(system, registry);
    send({
      t: 'hello',
      agents: registry.list(),
      states: registry.allStates(),
      system,
      tasks: tasks.list(),
      localOnly: isLocalOnly(),
      localConfig: getLocalConfig(),
      operations: listerOperations(),
      routines: listerRoutines(),
    });
    send({ t: 'agent.config', id: 'claude-code', config: getClaudeConfig('claude-code') });

    // Capacités et consommation : on envoie tout de suite ce qu'on a en cache,
    // puis la version fraîche dès qu'elle arrive (la sonde prend ~3 s).
    const caps = cachedCapabilities();
    if (caps) send({ t: 'claude.capabilities', caps });
    const usage = cachedUsage();
    if (usage) send({ t: 'claude.usage', usage });
    void claudeCapabilities()
      .then((c) => send({ t: 'claude.capabilities', caps: c }))
      .catch(() => {
        /* sans capacités, l'UI retombe sur ses valeurs par défaut */
      });
    void claudeUsage()
      .then((u) => send({ t: 'claude.usage', usage: u }))
      .catch(() => {
        /* la jauge n'est pas critique */
      });

    ws.on('message', (raw) => {
      handleCommand(raw.toString(), bus, registry, tasks).catch((e) =>
        console.error('[ws] command error', e),
      );
    });
    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
  });
}

async function handleCommand(
  raw: string,
  bus: Bus,
  registry: Registry,
  tasks: TaskManager,
): Promise<void> {
  let cmd: ClientCommand;
  try {
    cmd = JSON.parse(raw) as ClientCommand;
  } catch {
    return;
  }

  switch (cmd.t) {
    case 'chat.send': {
      const ok = dispatch(bus, registry, cmd.id, cmd.text, cmd.attachments);
      if (!ok) {
        bus.emit({
          t: 'notice',
          level: 'warn',
          text: `${registry.get(cmd.id)?.name ?? cmd.id} : chat live arrive plus tard.`,
        });
      }
      break;
    }

    case 'chat.route': {
      const hasImages = (cmd.attachments ?? []).some((p) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(p));
      const d = decide(cmd.mode, cmd.text, registry, { localOnly: isLocalOnly(), hasImages });

      if (d.refus) {
        bus.emit({ t: 'notice', level: 'warn', text: d.refus });
        break;
      }

      // Le front doit savoir dans quelle conversation écrire avant que ça parle.
      bus.emit({ t: 'chat.routed', mode: cmd.mode, id: d.agent, why: d.why, text: cmd.text });

      const ok = dispatch(bus, registry, d.agent, cmd.text, cmd.attachments);
      if (!ok) {
        bus.emit({
          t: 'notice',
          level: 'warn',
          text: `${registry.get(d.agent)?.name ?? d.agent} ne peut pas répondre pour l'instant.`,
        });
      }
      break;
    }

    case 'chat.cancel':
      cancelAgent(bus, registry, cmd.id);
      break;

    case 'chat.reset': {
      const meta = registry.get(cmd.id);
      if (meta?.provider === 'claude-code') {
        resetClaudeSession(cmd.id);
        bus.emit({ t: 'agent.config', id: cmd.id, config: getClaudeConfig(cmd.id) });
      } else if (meta?.provider === 'hermes-acp') {
        await resetHermes();
      } else {
        resetQwen(cmd.id);
        // Contexte remis à zéro : la jauge du composeur retombe tout de suite.
        bus.emit({ t: 'agent.context', id: cmd.id, used: 0, max: 0, ts: Date.now() });
      }
      bus.emit({ t: 'notice', level: 'info', text: `${meta?.name ?? cmd.id} : nouvelle session.` });
      break;
    }

    case 'claude.config': {
      const id = cmd.id ?? 'claude-code';
      const next = setClaudeConfig(id, {
        ...(cmd.model !== undefined ? { model: cmd.model } : {}),
        ...(cmd.effort !== undefined ? { effort: cmd.effort || undefined } : {}),
        ...(cmd.permissionMode !== undefined ? { permissionMode: cmd.permissionMode } : {}),
        ...(cmd.cwd !== undefined ? { cwd: cmd.cwd } : {}),
        ...(cmd.maxTurns !== undefined ? { maxTurns: cmd.maxTurns } : {}),
      });
      bus.emit({ t: 'agent.config', id, config: next });
      break;
    }

    case 'local.config': {
      const next = setLocalPermissionMode(cmd.permissionMode);
      bus.emit({ t: 'local.config', config: next });
      break;
    }

    case 'claude.apikey': {
      setClaudeApiKey(cmd.key);
      bus.emit({ t: 'agent.config', id: 'claude-code', config: getClaudeConfig('claude-code') });
      bus.emit({ t: 'notice', level: 'info', text: cmd.key.trim() ? 'Clé API Anthropic enregistrée.' : 'Clé API retirée.' });
      break;
    }

    case 'claude.auth.check': {
      const ok = await checkClaudeAuth();
      bus.emit({ t: 'agent.config', id: 'claude-code', config: getClaudeConfig('claude-code') });
      bus.emit({
        t: 'notice',
        level: ok ? 'info' : 'warn',
        text: ok ? 'Claude Code : connecté ✓' : 'Claude Code : non connecté — lance `claude` puis /login.',
      });
      break;
    }

    case 'permission.answer': {
      const agentId = repondrePermission(cmd.reqId, cmd.allow, cmd.reason);
      const ok = agentId !== null;
      // Que la demande ait encore été vivante ou non, le front doit fermer sa carte.
      bus.emit({ t: 'agent.permission.done', id: agentId ?? 'claude-code', reqId: cmd.reqId });
      if (ok) {
        bus.emit({
          t: 'notice',
          level: cmd.allow ? 'info' : 'warn',
          text: cmd.allow ? 'Action autorisée.' : 'Action refusée.',
        });
      }
      break;
    }

    case 'claude.capabilities.refresh': {
      const caps = await claudeCapabilities(true);
      bus.emit({ t: 'claude.capabilities', caps });
      bus.emit({
        t: 'notice',
        level: caps.error ? 'warn' : 'info',
        text: caps.error
          ? `Lecture des capacités Claude : ${caps.error}`
          : `Claude : ${caps.models.length} modèles, ${caps.skills.length} compétences, ${caps.mcp.length} connecteurs.`,
      });
      break;
    }

    case 'claude.usage.refresh': {
      const usage = await claudeUsage(true);
      bus.emit({ t: 'claude.usage', usage });
      break;
    }

    case 'local.only': {
      setLocalOnly(cmd.on);
      bus.emit({ t: 'local.only', on: cmd.on });
      bus.emit({
        t: 'notice',
        level: cmd.on ? 'warn' : 'info',
        text: cmd.on
          ? 'Tout local : les appels à Claude sont coupés.'
          : 'Claude est de nouveau joignable.',
      });
      break;
    }

    case 'operation.brainstorm': {
      const texte = cmd.text.trim();
      if (!texte) break;
      if (isLocalOnly()) {
        bus.emit({
          t: 'notice',
          level: 'warn',
          text: '« Tout local » est activé : la discussion du mode opération a besoin de Claude.',
        });
        break;
      }
      void brainstormer(bus, cmd.id, texte);
      break;
    }

    case 'operation.carte': {
      if (isLocalOnly()) {
        bus.emit({
          t: 'notice',
          level: 'warn',
          text: '« Tout local » est activé : la carte a besoin de Claude.',
        });
        break;
      }
      // Détaché : une opération dure des minutes, on ne bloque pas la passerelle.
      void dresserCarte(bus, registry, cmd.id, {
        budget: cmd.budget,
        revueFinale: cmd.revueFinale,
      });
      break;
    }

    case 'operation.start': {
      const objectif = cmd.objectif.trim();
      if (!objectif) break;
      if (isLocalOnly()) {
        bus.emit({
          t: 'notice',
          level: 'warn',
          text: "« Tout local » est activé : le mode opération a besoin de Claude pour dresser la carte.",
        });
        break;
      }
      void lancerOperationDirecte(bus, registry, objectif, {
        budget: cmd.budget,
        revueFinale: cmd.revueFinale,
      });
      break;
    }

    case 'operation.stop': {
      if (!arreterOperation(bus, cmd.id)) {
        bus.emit({ t: 'notice', level: 'warn', text: "Cette opération n'est plus en cours." });
      }
      break;
    }

    case 'operation.resume':
      void reprendreOperation(bus, registry, cmd.id, cmd.budgetSupplementaire ?? 0);
      break;

    case 'routine.create': {
      const consigne = cmd.consigne.trim();
      if (!consigne) break;
      const r = creerRoutine({
        titre: cmd.titre,
        consigne,
        mode: cmd.mode,
        recurrence: cmd.recurrence,
        premiere: cmd.premiere,
      });
      bus.emit({
        t: 'notice',
        level: 'info',
        text: `Routine « ${r.titre} » programmée pour le ${new Date(r.prochaine).toLocaleString('fr-FR')}.`,
      });
      break;
    }

    case 'routine.update': {
      const r = modifierRoutine(cmd.id, {
        ...(cmd.titre !== undefined ? { titre: cmd.titre } : {}),
        ...(cmd.consigne !== undefined ? { consigne: cmd.consigne } : {}),
        ...(cmd.mode !== undefined ? { mode: cmd.mode } : {}),
        ...(cmd.recurrence !== undefined ? { recurrence: cmd.recurrence } : {}),
        ...(cmd.prochaine !== undefined ? { prochaine: cmd.prochaine } : {}),
      });
      bus.emit({
        t: 'notice',
        level: r ? 'info' : 'warn',
        text: r ? `Routine « ${r.titre} » modifiée.` : "Cette routine n'existe plus.",
      });
      break;
    }

    case 'routine.toggle':
      if (!basculerRoutine(cmd.id, cmd.actif)) {
        bus.emit({ t: 'notice', level: 'warn', text: 'Routine introuvable.' });
      }
      break;

    case 'routine.delete':
      if (supprimerRoutine(cmd.id)) {
        bus.emit({ t: 'notice', level: 'info', text: 'Routine supprimée.' });
      }
      break;

    case 'routine.run':
      // Détaché : une routine peut durer plusieurs minutes.
      void executerRoutine(cmd.id);
      break;

    case 'system.refresh': {
      const system = await checkSystem();
      syncOnline(system, registry);
      bus.emit({ t: 'system.status', system });
      break;
    }

    case 'task.create': {
      // 'auto' = laisse Hermes décider (et déléguer).
      const executor: AgentId = cmd.target === 'auto' ? 'hermes' : cmd.target;
      const prompt = cmd.prompt ?? cmd.title;
      if (cmd.target === 'auto') {
        bus.emit({ t: 'agent.delegation', from: 'hermes', to: 'hermes', label: 'router la tâche' });
      }
      const ok = dispatch(bus, registry, executor, prompt);
      if (ok) {
        tasks.create(cmd.target, executor, cmd.title);
      } else {
        bus.emit({
          t: 'notice',
          level: 'warn',
          text: `${registry.get(executor)?.name ?? executor} ne peut pas exécuter de tâche.`,
        });
      }
      break;
    }

    case 'task.stop': {
      const agentId = tasks.stop(cmd.taskId);
      if (agentId) cancelAgent(bus, registry, agentId);
      break;
    }

    case 'ping':
      break;
  }
}
