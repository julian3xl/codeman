/**
 * @fileoverview Fork-only (julian3xl/codeman): the unified session list shows
 * only sessions that belong to a case.
 *
 * "Belongs to a case" is the same rule the frontend uses for the `#case` label
 * (`_resolveCaseLabel` in terminal-ui.js): the working directory IS a case path
 * or sits under one. A transcript row whose `worktreeRepo` is inside a case
 * counts too, so a git worktree of a case repo stays listed.
 *
 * The cases are the ones `GET /api/cases` lists (case-routes.ts), read from
 * disk on every call so a deleted case takes its sessions out of the list:
 * - every directory in the shared cases dir (`getCasesDir()`) with a valid
 *   case name,
 * - in multi-user mode, every `<user spaces>/<user>/cases/<case>` directory
 *   (unscoped: the list feeds a shared search index, and the route applies
 *   multi-user scoping separately),
 * - linked cases whose directory still exists, docker case workspaces and remote
 *   case paths (a remote path cannot be checked from here).
 *
 * Live sessions are never filtered: an open tab stays in the list wherever it
 * runs, and so do the persisted and transcript rows that fold into it.
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getCasesDir } from '../config/cases-dir.js';
import { dataPath, getDataDir } from '../config/instance.js';
import { getUserSpacesDir, isMultiUserMode } from '../config/multiuser.js';
import { readDockerCases } from '../docker-hosts.js';
import { readRemoteCases } from '../remote-hosts.js';

/** Case paths: a path equal to or under one of them is inside a case. */
export type CaseRoots = { cases: string[] };

/** Same pattern `GET /api/cases` uses for directories in the cases dir. */
const SAFE_CASE_NAME = /^[a-zA-Z0-9_-]+$/;

const trimSlash = (p: string): string => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
const within = (path: string, root: string): boolean => path === root || path.startsWith(root + '/');

/** Case directories directly inside `dir`. A missing dir has none. */
async function caseDirsIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && SAFE_CASE_NAME.test(e.name)).map((e) => join(dir, e.name));
}

/** Gather every case on this machine. Missing or unreadable registries count as empty. */
export async function loadCaseRoots(): Promise<CaseRoots> {
  const cases: string[] = await caseDirsIn(getCasesDir());
  if (isMultiUserMode()) {
    const spaces = getUserSpacesDir();
    for (const user of await readdir(spaces, { withFileTypes: true }).catch(() => [])) {
      if (user.isDirectory()) cases.push(...(await caseDirsIn(join(spaces, user.name, 'cases'))));
    }
  }
  try {
    const linked = JSON.parse(await readFile(dataPath('linked-cases.json'), 'utf-8')) as Record<string, unknown>;
    for (const p of Object.values(linked)) if (typeof p === 'string' && p && existsSync(p)) cases.push(p);
  } catch {
    // no linked cases
  }
  try {
    for (const d of await readDockerCases(getDataDir())) if (d.hostWorkspacePath) cases.push(d.hostWorkspacePath);
  } catch {
    // no docker cases
  }
  try {
    for (const r of await readRemoteCases(getDataDir())) if (r.remotePath) cases.push(r.remotePath);
  } catch {
    // no remote cases
  }
  return { cases: cases.map(trimSlash) };
}

/** True when `path` is a case directory or lies inside one. */
export function isInCase(path: string | undefined, roots: CaseRoots): boolean {
  if (!path) return false;
  const p = trimSlash(path);
  return roots.cases.some((c) => within(p, c));
}

type Row = { id: string; workingDir?: string; claudeSessionId?: string };
type HistoryRow = { sessionId: string; workingDir: string; worktreeRepo?: string };

/**
 * Drop persisted and transcript rows outside every case. Live rows, and the
 * persisted/transcript rows that belong to a live session, always pass.
 */
export function keepCaseSessions<P extends Row, H extends HistoryRow>(
  live: ReadonlyArray<Row>,
  persisted: P[],
  history: H[],
  roots: CaseRoots
): { persisted: P[]; history: H[] } {
  const liveIds = new Set(live.map((l) => l.id));
  const keptPersisted = persisted.filter((p) => liveIds.has(p.id) || isInCase(p.workingDir, roots));
  // Transcript ids that fold into a kept row (resumed sessions carry the conversation id separately).
  const owned = new Set<string>(liveIds);
  for (const r of [...live, ...keptPersisted]) if (r.claudeSessionId) owned.add(r.claudeSessionId);
  const keptHistory = history.filter(
    (h) => owned.has(h.sessionId) || isInCase(h.workingDir, roots) || isInCase(h.worktreeRepo, roots)
  );
  return { persisted: keptPersisted, history: keptHistory };
}
