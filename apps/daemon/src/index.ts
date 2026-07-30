import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config, isAllowedOrigin } from './config';
import { Bus } from './bus';
import { Registry } from './registry';
import { healthRoutes } from './routes/health';
import { systemRoutes } from './routes/system';
import { filesRoutes } from './routes/files';
import { metricsRoutes } from './routes/metrics';
import { uploadRoutes } from './routes/upload';
import { skillsRoutes } from './routes/skills';
import { brainsRoutes } from './routes/brains';
import { projectsRoutes } from './routes/projects';
import { ttsRoutes } from './routes/tts';
import { oreilleRoutes, shutdownOreille } from './routes/oreille';
import { memoireRoutes } from './routes/memoire';
import { arreterEmbeddings } from './memoire/serveur';
import { repertoireRoutes } from './routes/repertoire';
import { attachWs, syncOnline } from './ws/gateway';
import { checkSystem } from './probes/services';
import { TaskManager } from './task-manager';
import { shutdownHermes } from './agents/hermes';
import { shutdownClaude } from './agents/claude';
import { chargerOperations } from './operations';
import { arreterHorloge, chargerRoutines } from './routines';
import { enregistrerOutilsNatifs } from './outils/natifs';
import { demarrerMcp, arreterMcp } from './outils/mcp';

async function main(): Promise<void> {
  const bus = new Bus();
  const registry = new Registry(bus);
  const tasks = new TaskManager(bus);

  // La boîte à outils des cerveaux locaux : recherche web, fichiers, etc.
  enregistrerOutilsNatifs();
  // Les serveurs MCP configurés (~/.boow/mcp.json), en tâche de fond : leur
  // connexion ne doit pas retarder le démarrage du cockpit.
  void demarrerMcp()
    .then((r) => r.serveurs && console.log(`  MCP         🔌  ${r.serveurs} serveur(s), ${r.outils} outil(s)`))
    .catch(() => {});

  const app = Fastify({ logger: false });
  // CORS verrouillé : seules les origines web locales (ou les requêtes sans origine, ex. curl) passent.
  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  });
  // Corps binaire brut — /api/upload (octet-stream) et /api/oreille (audio).
  app.addContentTypeParser(
    ['application/octet-stream', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );
  // En-têtes de sécurité sur toutes les réponses de l'API.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
  });
  await app.register(healthRoutes);
  await app.register(systemRoutes);
  await app.register(filesRoutes);
  await app.register(metricsRoutes);
  await app.register(uploadRoutes);
  await app.register(skillsRoutes);
  await app.register(brainsRoutes);
  await app.register(projectsRoutes);
  await app.register(ttsRoutes);
  await app.register(oreilleRoutes);
  await app.register(memoireRoutes);
  await app.register(repertoireRoutes);

  // Mode production : sert l'app web buildée (apps/web/dist) sur le même port + fallback SPA.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, '../../web/dist');
  const servingWeb = existsSync(path.join(webDist, 'index.html'));
  if (servingWeb) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && req.url !== '/ws') {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'not found' });
    });
  }

  // Relit opérations et routines des sessions précédentes avant d'accepter des clients.
  await chargerOperations();
  await chargerRoutines(bus, registry);

  await app.listen({ port: config.daemonPort, host: config.host });
  attachWs(app.server, bus, registry, tasks);

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      arreterHorloge();
      shutdownHermes();
      shutdownClaude();
      shutdownOreille();
      arreterEmbeddings();
      void arreterMcp();
      process.exit(0);
    });
  }

  // Sonde périodique -> push system.status à tous les clients connectés.
  const tick = async () => {
    try {
      const system = await checkSystem();
      syncOnline(system, registry);
      bus.emit({ t: 'system.status', system });
    } catch {
      /* ignore */
    }
  };
  setInterval(tick, 15000);

  console.log(`\n  boow-daemon ⚙   http://${config.host}:${config.daemonPort}`);
  console.log(`  WebSocket   ⚡   ws://${config.host}:${config.daemonPort}/ws`);
  if (servingWeb) console.log(`  app (prod)  🛰    http://localhost:${config.daemonPort}\n`);
  else console.log(`  web (Vite)  🛰    http://localhost:${config.webPort}\n`);
}

main().catch((err) => {
  console.error('boow-daemon failed to start:', err);
  process.exit(1);
});
