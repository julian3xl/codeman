/**
 * @fileoverview Fork-only: closed shell sessions stay out of the unified list
 * (src/fork/closed-shell-sessions.ts).
 */
import { describe, it, expect } from 'vitest';
import { dropClosedShellSessions, isShellKindMode } from '../src/fork/closed-shell-sessions.js';
import { mergeUnifiedSessions } from '../src/services/unified-session-service.js';

const shell = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `sh-${id}`,
  mode: 'shell',
  status: 'stopped',
  workingDir: '/tmp/x',
  ...extra,
});

describe('isShellKindMode', () => {
  it('reads the registry kind', () => {
    expect(isShellKindMode('shell')).toBe(true);
    expect(isShellKindMode('claude')).toBe(false);
    expect(isShellKindMode('codex')).toBe(false);
    expect(isShellKindMode(undefined)).toBe(false);
    expect(isShellKindMode('no-such-cli')).toBe(false);
  });
});

describe('dropClosedShellSessions', () => {
  it('keeps a live shell', () => {
    expect(dropClosedShellSessions([shell('a')], [{ id: 'a' }], [])).toHaveLength(1);
  });

  it('keeps a detached shell whose mux pane is still running', () => {
    expect(dropClosedShellSessions([shell('a')], [], [{ sessionId: 'a' }])).toHaveLength(1);
  });

  it('drops a closed shell, pinned or not', () => {
    const out = dropClosedShellSessions([shell('a'), shell('b', { pinned: true, pinnedAt: 1 })], [], []);
    expect(out).toEqual([]);
  });

  it('never touches a non-shell record', () => {
    const claude = { id: 'c', mode: 'claude', status: 'stopped', pinned: true };
    const legacy = { id: 'd', status: 'stopped' }; // no mode = legacy claude
    expect(dropClosedShellSessions([claude, legacy], [], [])).toEqual([claude, legacy]);
  });
});

describe('unified list with closed shells filtered', () => {
  it('lists live and mux-backed shells but not closed ones', () => {
    const persisted = [shell('live'), shell('detached'), shell('closed', { pinned: true, pinnedAt: 5 })];
    const live = [{ id: 'live', mode: 'shell', status: 'idle' }];
    const mux = [{ sessionId: 'detached', mode: 'shell' }];
    const lifecycle = [{ sessionId: 'closed', mode: 'shell', name: 'sh-closed', ts: 10, event: 'deleted' }];

    const ids = mergeUnifiedSessions({
      live,
      persisted: dropClosedShellSessions(persisted, live, mux),
      lifecycle,
      mux,
    }).map((s) => s.sessionId);

    expect(ids).toContain('live');
    expect(ids).toContain('detached');
    expect(ids).not.toContain('closed');
  });
});
