import type { FastifyInstance } from 'fastify';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Claude : ~/.claude/skills/<nom>/SKILL.md
// Hermes : ~/.hermes/skills/<catégorie>/<nom>/SKILL.md (+ DESCRIPTION.md de catégorie)
const CLAUDE_SKILLS = path.join(os.homedir(), '.claude', 'skills');
const HERMES_SKILLS = path.join(os.homedir(), '.hermes', 'skills');

interface SkillInfo {
  name: string;
  description: string;
  category?: string;
}

/** Parse le frontmatter YAML simple d'un SKILL.md. */
function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\s*([\s\S]*?)\s*---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([\w-]+):\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

async function readSkill(dir: string): Promise<SkillInfo | null> {
  try {
    const md = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
    const meta = frontmatter(md);
    return { name: meta.name ?? path.basename(dir), description: meta.description ?? '' };
  } catch {
    return null;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

const slug = (s: string) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/skills', async () => {
    const claude: SkillInfo[] = [];
    const hermes: SkillInfo[] = [];
    try {
      for (const d of await readdir(CLAUDE_SKILLS)) {
        if (!(await isDir(path.join(CLAUDE_SKILLS, d)))) continue;
        const s = await readSkill(path.join(CLAUDE_SKILLS, d));
        if (s) claude.push(s);
      }
    } catch {
      /* dossier absent */
    }
    try {
      for (const cat of await readdir(HERMES_SKILLS)) {
        const catDir = path.join(HERMES_SKILLS, cat);
        if (!(await isDir(catDir))) continue;
        for (const sk of await readdir(catDir)) {
          if (!(await isDir(path.join(catDir, sk)))) continue;
          const s = await readSkill(path.join(catDir, sk));
          if (s) hermes.push({ ...s, category: cat });
        }
      }
    } catch {
      /* dossier absent */
    }
    claude.sort((a, b) => a.name.localeCompare(b.name));
    hermes.sort((a, b) => (a.category! + a.name).localeCompare(b.category! + b.name));
    return { claude, hermes };
  });

  app.post('/api/skills', async (req, reply) => {
    const b = req.body as { agent?: string; name?: string; description?: string; instructions?: string; category?: string };
    const name = slug(b.name ?? '');
    if (!name) {
      reply.code(400);
      return { error: 'nom requis' };
    }
    const desc = (b.description ?? '').replace(/\r?\n/g, ' ').slice(0, 300);
    const md = `---\nname: ${name}\ndescription: ${desc}\n---\n\n${(b.instructions ?? '').trim()}\n`;
    try {
      if (b.agent === 'hermes') {
        const cat = slug(b.category ?? '') || 'custom';
        const dir = path.join(HERMES_SKILLS, cat, name);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, 'SKILL.md'), md, 'utf8');
        const catDesc = path.join(HERMES_SKILLS, cat, 'DESCRIPTION.md');
        try {
          await stat(catDesc);
        } catch {
          await writeFile(catDesc, `---\ndescription: Skills personnalisés (${cat}).\n---\n`, 'utf8');
        }
        return { ok: true, agent: 'hermes', path: dir };
      }
      const dir = path.join(CLAUDE_SKILLS, name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'SKILL.md'), md, 'utf8');
      return { ok: true, agent: 'claude', path: dir };
    } catch (e) {
      reply.code(500);
      return { error: (e as Error).message };
    }
  });
}
