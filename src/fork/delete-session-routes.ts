/**
 * @fileoverview Fork-only (julian3xl/codeman): permanently delete a session
 * from the unified list (the ⋯ menu's "Delete session", src/web/public/fork.js).
 *
 * `DELETE /api/fork/sessions/:id?claude=<uuid>&codex=<threadId>` removes,
 * in order:
 * 1. the live Codeman session, if any (killed with its tmux, like the tab's
 *    "Kill Tmux" close);
 * 2. a detached tmux pane still running for it, and its `state.json` record,
 *    pin included (a delete overrides the pin's keep-after-kill protection);
 * 3. its conversation files: Claude's `~/.claude/projects/<project>/<uuid>.jsonl`
 *    plus the `<uuid>/` sidecar dir (subagents, tool results), and codex's
 *    `~/.codex/sessions/**\/rollout-*-<threadId>.jsonl`.
 *
 * Transcript ids come from the row (its own id, tried as both a Claude and a
 * codex id, plus `claudeSessionId` and `resumeId`)
 * and from the persisted record (`resumeSessionId`, `codexConfig`). Each one is
 * validated as a plain id token and only ever matched against file NAMES inside
 * those two fixed roots, never joined from a client path, so the request cannot
 * reach any other file. omp keeps its id inside the file, so omp rows are not
 * offered the action (fork.js).
 *
 * Irreversible, and host-wide for transcripts: admin-only in multi-user mode.
 * Registered with one line in server.ts; nothing upstream calls it.
 */

import type { FastifyInstance } from 'fastify';
import { readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isMultiUserMode } from '../config/multiuser.js';
import { requireAdmin } from '../web/route-helpers.js';
import { SseEvent } from '../web/sse-events.js';
import type { ConfigPort, EventPort, InfraPort, SessionPort } from '../web/ports/index.js';

/** A conversation id: uuid-like, no path characters. */
const ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const CODEX_MAX_DEPTH = 5;

export function isIdToken(v: unknown): v is string {
  return typeof v === 'string' && ID_TOKEN.test(v);
}

function claudeProjectsRoot(): string {
  return join(process.env.HOME || homedir(), '.claude', 'projects');
}

function codexSessionsRoot(): string {
  return join(process.env.CODEX_HOME || join(process.env.HOME || homedir(), '.codex'), 'sessions');
}

/** Delete `<project>/<id>.jsonl` and the `<project>/<id>/` sidecar in every Claude project dir. */
export async function deleteClaudeTranscripts(ids: Iterable<string>, root = claudeProjectsRoot()): Promise<string[]> {
  const wanted = [...new Set([...ids].filter(isIdToken))];
  if (wanted.length === 0) return [];
  const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    for (const id of wanted) {
      for (const target of [join(root, p.name, `${id}.jsonl`), join(root, p.name, id)]) {
        if (await stat(target).catch(() => null)) {
          await rm(target, { recursive: true, force: true });
          removed.push(target);
        }
      }
    }
  }
  return removed;
}

/** Delete every codex rollout whose file name ends in `-<threadId>.jsonl`. */
export async function deleteCodexRollouts(ids: Iterable<string>, root = codexSessionsRoot()): Promise<string[]> {
  const suffixes = [...new Set([...ids].filter(isIdToken))].map((id) => `-${id}.jsonl`);
  if (suffixes.length === 0) return [];
  const removed: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > CODEX_MAX_DEPTH) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && e.name.startsWith('rollout-') && suffixes.some((s) => e.name.endsWith(s))) {
        await rm(full, { force: true });
        removed.push(full);
      }
    }
  };
  await walk(root, 0);
  return removed;
}

export function registerForkDeleteSessionRoutes(
  app: FastifyInstance,
  ctx: SessionPort & EventPort & ConfigPort & InfraPort
): void {
  app.delete('/api/fork/sessions/:id', async (req, reply) => {
    if (isMultiUserMode() && !requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const query = req.query as { claude?: string; codex?: string };
    if (!isIdToken(id)) {
      reply.code(400);
      return { success: false, error: 'Invalid session id', errorCode: 'INVALID_INPUT' };
    }

    const claudeIds = new Set<string>([id]);
    // A codex history row is keyed by its own thread id, so the row id is a codex candidate too.
    const codexIds = new Set<string>([id]);
    if (isIdToken(query.claude)) claudeIds.add(query.claude);
    if (isIdToken(query.codex)) codexIds.add(query.codex);

    const live = ctx.sessions.get(id);
    if (live?.claudeSessionId) claudeIds.add(live.claudeSessionId);
    const record = ctx.store.getSession(id);
    if (record?.resumeSessionId) claudeIds.add(record.resumeSessionId);
    if (record?.codexConfig?.resumeSessionId) codexIds.add(record.codexConfig.resumeSessionId);

    let codemanSession = false;
    if (live) {
      await ctx.cleanupSession(id, true, 'user_delete');
      codemanSession = true;
    }
    if (await ctx.mux.killSession(id).catch(() => false)) codemanSession = true;
    if (ctx.store.getSession(id)) {
      ctx.store.removeSession(id);
      codemanSession = true;
    }
    if (codemanSession) ctx.broadcast(SseEvent.SessionDeleted, { id });

    const files = [...(await deleteClaudeTranscripts(claudeIds)), ...(await deleteCodexRollouts(codexIds))];
    return { success: true, data: { codemanSession, files: files.length } };
  });
}
