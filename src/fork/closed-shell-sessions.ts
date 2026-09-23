/**
 * @fileoverview Fork-only (julian3xl/codeman): keep closed shell sessions out of
 * the unified session list.
 *
 * A shell has nothing to resume: "Resume" on a shell row creates a brand-new
 * login shell in the same directory and nothing of the old process survives. So
 * a shell row is only worth listing while its process still exists, either as a
 * live session or as a mux pane (a detached shell whose tmux pane is still
 * running keeps real state). The only source that can carry a closed shell is
 * `state.json` (a pinned shell demoted to `stopped`, a record left behind with
 * no session): shells write no transcript, and a lifecycle-only row with no
 * prompt is already dropped by the merge's meaningfulness floor.
 *
 * "Shell" is the registry's `kind: 'shell'`, never a CLI id, per the
 * no-id-branching rule (`test/cli-registry-no-id-branching.test.ts`).
 *
 * Applied through `applyForkSessionFilters()` (unified-inputs.ts), the fork's
 * one-line hook in `gatherUnifiedInputs()` (session-routes.ts).
 */

import { getCli } from '../config/cli-registry/index.js';

/** True when `mode` names a registry entry of `kind: 'shell'`. */
export function isShellKindMode(mode: string | undefined): boolean {
  return mode !== undefined && getCli(mode)?.kind === 'shell';
}

/**
 * Drop persisted shell records whose process is gone (neither a live session
 * nor a mux pane). Every other record passes through untouched.
 */
export function dropClosedShellSessions<T extends { id: string; mode?: string }>(
  persisted: T[],
  live: ReadonlyArray<{ id: string }>,
  mux: ReadonlyArray<{ sessionId: string }>,
  isShell: (mode: string | undefined) => boolean = isShellKindMode
): T[] {
  const running = new Set<string>([...live.map((l) => l.id), ...mux.map((m) => m.sessionId)]);
  return persisted.filter((p) => running.has(p.id) || !isShell(p.mode));
}
