/**
 * @fileoverview Fork-only: DELETE /api/fork/sessions/:id and its file helpers
 * (src/fork/delete-session-routes.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isIdToken,
  deleteClaudeTranscripts,
  deleteCodexRollouts,
  registerForkDeleteSessionRoutes,
} from '../src/fork/delete-session-routes.js';

const UUID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '{}\n');
}

describe('isIdToken', () => {
  it('accepts uuids and rejects anything path-like', () => {
    expect(isIdToken(UUID)).toBe(true);
    for (const bad of ['', 'short', '../../etc/passwd', 'a/b/c/d/e/f', '.hidden-file-x', `${UUID}/..`, undefined, 42]) {
      expect(isIdToken(bad)).toBe(false);
    }
  });
});

describe('file helpers', () => {
  it('deletes a Claude transcript and its sidecar in any project, nothing else', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fork-claude-'));
    touch(join(root, 'proj-a', `${UUID}.jsonl`));
    touch(join(root, 'proj-a', UUID, 'subagents', 'agent-1.jsonl'));
    touch(join(root, 'proj-a', `${OTHER}.jsonl`));
    const removed = await deleteClaudeTranscripts([UUID, '../../x'], root);
    expect(removed).toHaveLength(2);
    expect(existsSync(join(root, 'proj-a', `${UUID}.jsonl`))).toBe(false);
    expect(existsSync(join(root, 'proj-a', UUID))).toBe(false);
    expect(existsSync(join(root, 'proj-a', `${OTHER}.jsonl`))).toBe(true);
  });

  it('deletes only the codex rollout named after the thread id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fork-codex-'));
    const mine = join(root, '2026', '09', '23', `rollout-2026-09-23T10-00-00-${UUID}.jsonl`);
    const other = join(root, '2026', '09', '23', `rollout-2026-09-23T11-00-00-${OTHER}.jsonl`);
    touch(mine);
    touch(other);
    expect(await deleteCodexRollouts([UUID], root)).toEqual([mine]);
    expect(existsSync(mine)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });
});

describe('DELETE /api/fork/sessions/:id', () => {
  let app: FastifyInstance;
  let records: Record<string, Record<string, unknown>>;
  const calls: string[] = [];

  beforeEach(async () => {
    calls.length = 0;
    records = { [UUID]: { id: UUID, pinned: true, resumeSessionId: OTHER } };
    const ctx = {
      sessions: new Map(),
      store: {
        getSession: (id: string) => records[id] ?? null,
        removeSession: (id: string) => {
          calls.push(`remove:${id}`);
          delete records[id];
        },
      },
      mux: { killSession: async (id: string) => (calls.push(`kill:${id}`), true) },
      cleanupSession: async () => calls.push('cleanup'),
      broadcast: (event: string) => calls.push(`broadcast:${event}`),
    };
    app = Fastify();
    registerForkDeleteSessionRoutes(app, ctx as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('kills the detached pane, drops the pinned record and deletes both transcripts', async () => {
    const projects = join(process.env.HOME as string, '.claude', 'projects', 'p');
    touch(join(projects, `${UUID}.jsonl`));
    touch(join(projects, `${OTHER}.jsonl`));

    const res = await app.inject({ method: 'DELETE', url: `/api/fork/sessions/${UUID}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { codemanSession: true, files: 2 } });
    expect(calls).toEqual([`kill:${UUID}`, `remove:${UUID}`, 'broadcast:session:deleted']);
    expect(existsSync(join(projects, `${UUID}.jsonl`))).toBe(false);
    expect(existsSync(join(projects, `${OTHER}.jsonl`))).toBe(false);
  });

  it('rejects a path-like id', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/fork/sessions/..%2F..%2Fetc` });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
  });
});
