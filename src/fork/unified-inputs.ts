/**
 * @fileoverview Fork-only (julian3xl/codeman): the single hook the fork puts on
 * the unified session list. `gatherUnifiedInputs()` (session-routes.ts) returns
 * its inputs through here, so every consumer (the unified route, the search
 * index and its refresher) sees the same filtered view, and upstream code stays
 * untouched beyond that one call.
 *
 * Filters, in order:
 * 1. closed shells (closed-shell-sessions.ts),
 * 2. sessions outside every case (case-only-sessions.ts).
 */

import type {
  HistoryInput,
  LifecycleInput,
  LiveSessionInput,
  MuxStatInput,
  PersistedSessionInput,
} from '../services/unified-session-service.js';
import { dropClosedShellSessions } from './closed-shell-sessions.js';
import { keepCaseSessions, loadCaseRoots } from './case-only-sessions.js';

type UnifiedInputs = {
  live: LiveSessionInput[];
  persisted: PersistedSessionInput[];
  lifecycle: LifecycleInput[];
  history: HistoryInput[];
  mux: MuxStatInput[];
};

export async function applyForkSessionFilters(inputs: UnifiedInputs): Promise<UnifiedInputs> {
  const { live, lifecycle, mux } = inputs;
  const persisted = dropClosedShellSessions(inputs.persisted, live, mux);
  const scoped = keepCaseSessions(live, persisted, inputs.history, await loadCaseRoots());
  return { live, persisted: scoped.persisted, lifecycle, history: scoped.history, mux };
}
