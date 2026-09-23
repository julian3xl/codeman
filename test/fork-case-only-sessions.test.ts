/**
 * @fileoverview Fork-only: the unified list keeps only sessions inside a case
 * (src/fork/case-only-sessions.ts, src/fork/unified-inputs.ts).
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { isInCase, keepCaseSessions, loadCaseRoots, type CaseRoots } from '../src/fork/case-only-sessions.js';
import { applyForkSessionFilters } from '../src/fork/unified-inputs.js';
import { getCasesDir } from '../src/config/cases-dir.js';
import { dataPath } from '../src/config/instance.js';

const roots: CaseRoots = {
  cases: ['/home/u/codeman-cases/app', '/work/linked-app'],
};

describe('isInCase', () => {
  it('matches a case path and its subdirs', () => {
    expect(isInCase('/home/u/codeman-cases/app', roots)).toBe(true);
    expect(isInCase('/home/u/codeman-cases/app/', roots)).toBe(true);
    expect(isInCase('/home/u/codeman-cases/app/sub/dir', roots)).toBe(true);
    expect(isInCase('/work/linked-app/src', roots)).toBe(true);
  });

  it('rejects look-alikes, parents, other cases dir entries and missing paths', () => {
    expect(isInCase('/work/linked-app2', roots)).toBe(false);
    expect(isInCase('/home/u/codeman-cases', roots)).toBe(false);
    expect(isInCase('/home/u/codeman-cases/deleted-case', roots)).toBe(false);
    expect(isInCase('/home/u', roots)).toBe(false);
    expect(isInCase(undefined, roots)).toBe(false);
    expect(isInCase('', roots)).toBe(false);
  });
});

describe('keepCaseSessions', () => {
  const hist = (sessionId: string, workingDir: string, extra: Record<string, unknown> = {}) => ({
    sessionId,
    workingDir,
    sizeBytes: 1,
    lastModified: '2026-09-23T00:00:00Z',
    ...extra,
  });

  it('keeps case rows and drops the rest', () => {
    const out = keepCaseSessions(
      [],
      [
        { id: 'p-in', workingDir: '/work/linked-app' },
        { id: 'p-out', workingDir: '/home/u' },
      ],
      [hist('h-in', '/home/u/codeman-cases/app'), hist('h-out', '/tmp/x')],
      roots
    );
    expect(out.persisted.map((p) => p.id)).toEqual(['p-in']);
    expect(out.history.map((h) => h.sessionId)).toEqual(['h-in']);
  });

  it('keeps a transcript whose worktree belongs to a case repo', () => {
    const out = keepCaseSessions([], [], [hist('wt', '/elsewhere/wt', { worktreeRepo: '/work/linked-app' })], roots);
    expect(out.history).toHaveLength(1);
  });

  it('never drops a live session or the rows that fold into it', () => {
    const live = [{ id: 'live', workingDir: '/home/u', claudeSessionId: 'conv-1' }];
    const out = keepCaseSessions(
      live,
      [{ id: 'live', workingDir: '/home/u' }],
      [hist('live', '/home/u'), hist('conv-1', '/home/u'), hist('other', '/home/u')],
      roots
    );
    expect(out.persisted.map((p) => p.id)).toEqual(['live']);
    expect(out.history.map((h) => h.sessionId)).toEqual(['live', 'conv-1']);
  });
});

describe('loadCaseRoots + applyForkSessionFilters', () => {
  it('lists existing case dirs and linked cases only, so a deleted case drops its sessions', async () => {
    const casesDir = getCasesDir();
    mkdirSync(join(casesDir, 'app'), { recursive: true });
    writeFileSync(join(casesDir, 'not-a-dir'), '');
    const linkedDir = mkdtempSync(join(tmpdir(), 'fork-linked-'));
    const linked = dataPath('linked-cases.json');
    mkdirSync(dirname(linked), { recursive: true });
    writeFileSync(linked, JSON.stringify({ mine: linkedDir, gone: '/no/such/linked/dir' }));

    const r = await loadCaseRoots();
    expect(r.cases).toContain(join(casesDir, 'app'));
    expect(r.cases).toContain(linkedDir);
    expect(r.cases).not.toContain(join(casesDir, 'not-a-dir'));
    expect(r.cases).not.toContain('/no/such/linked/dir');

    const out = await applyForkSessionFilters({
      live: [],
      persisted: [
        { id: 'shell-closed', mode: 'shell', workingDir: linkedDir },
        { id: 'claude-in', mode: 'claude', workingDir: `${linkedDir}/src` },
        { id: 'claude-out', mode: 'claude', workingDir: '/nowhere' },
      ],
      lifecycle: [],
      history: [
        hist2('h-case', join(casesDir, 'app')),
        hist2('h-deleted-case', join(casesDir, 'deleted-case')),
        hist2('h-out', '/nowhere'),
      ],
      mux: [],
    });
    expect(out.persisted.map((p) => p.id)).toEqual(['claude-in']);
    expect(out.history.map((h) => h.sessionId)).toEqual(['h-case']);
  });
});

function hist2(sessionId: string, workingDir: string) {
  return { sessionId, workingDir, sizeBytes: 1, lastModified: '2026-09-23T00:00:00Z' };
}
