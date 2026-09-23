/**
 * @fileoverview Fork-only behavior overrides (julian3xl/codeman).
 *
 * Loaded LAST (defer) from index.html, after every upstream mixin, so the
 * methods assigned here replace upstream's on CodemanApp.prototype before
 * DOMContentLoaded instantiates the app. Everything this fork changes in
 * frontend behavior lives here instead of in the upstream modules, which keeps
 * rebases onto Ark0N/Codeman down to the single <script> line in index.html
 * (same approach as custom.css for styles).
 *
 * @dependency app.js (CodemanApp, paneExitLabel, closeSession, goHome)
 * @loadorder 17 (after image-input.js)
 */

Object.assign(CodemanApp.prototype, {
  /**
   * Close a tab without asking (replaces upstream's confirmation dialog).
   * Reached from the tab's ×, a middle click and the tab rail's "Close session".
   *
   * - The process in the pane has exited (`session.paneExit`, the same signal as
   *   the tab's "exited" badge): close the tab and kill its tmux session.
   * - Otherwise the process is running, or Codeman cannot tell (remote, docker,
   *   direct-PTY sessions never carry paneExit): leave the session alone, exactly
   *   like clicking the logo (`goHome()`), so it stays live under OPEN TABS. A ×
   *   on a background tab of a running session therefore changes nothing.
   */
  requestCloseSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (paneExitLabel(session.paneExit)) {
      void this.closeSession(sessionId, true);
      return;
    }
    if (this.activeSessionId === sessionId) this.goHome();
  },
});

// ── Session row menu: "Delete session" ─────────────────────────────────────
// Wraps upstream's ⋯ menu (terminal-ui.js _openSessionRowMenu, shared by the
// home history list and the Session Manager) and appends one item to the menu
// it just built, so the upstream builder stays untouched. The server side is
// src/fork/delete-session-routes.ts.

const forkUpstreamOpenSessionRowMenu = CodemanApp.prototype._openSessionRowMenu;

Object.assign(CodemanApp.prototype, {
  _openSessionRowMenu(anchorEl, s, cases, item, detail) {
    forkUpstreamOpenSessionRowMenu.call(this, anchorEl, s, cases, item, detail);
    const menu = this._openRowMenuEl;
    // omp keeps its conversation id inside the file, so the server cannot find it by name.
    if (!menu || !s || s.mode === 'omp') return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'session-row-menu-item fork-row-menu-delete';
    btn.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.className = 'session-row-menu-label';
    label.textContent = 'Delete session';
    btn.appendChild(label);
    btn.addEventListener('click', (ev) => {
      // Same guard as upstream's items: never reach the row's resume handler.
      ev.stopPropagation();
      ev.preventDefault();
      this._openRowMenuClose?.();
      void this._forkDeleteSession(s, item);
    });
    menu.appendChild(btn);

    // The menu grew by one row after upstream positioned it: keep it on screen.
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 4) {
      menu.style.top = `${Math.max(4, window.innerHeight - 4 - rect.height)}px`;
    }
  },

  /** Confirm, then permanently delete the session behind a list row. */
  async _forkDeleteSession(s, item) {
    const name = this._historyRowLabel ? this._historyRowLabel(s, s.workingDir || s.sessionId) : s.sessionId;
    const ok = window.confirm(
      `Delete "${name}"?\n\nThis permanently removes the conversation from disk and cannot be undone.`
    );
    if (!ok) return;

    const params = new URLSearchParams();
    if (s.claudeSessionId && s.claudeSessionId !== s.sessionId) params.set('claude', s.claudeSessionId);
    if (s.resumeId) params.set('codex', s.resumeId);
    const qs = params.toString();
    const url = CodemanBase.url(`/api/fork/sessions/${encodeURIComponent(s.sessionId)}${qs ? `?${qs}` : ''}`);
    try {
      const res = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) throw new Error(data?.error || `HTTP ${res.status}`);
      item?.remove();
      if (Array.isArray(this._historyAll)) {
        this._historyAll = this._historyAll.filter((x) => x.sessionId !== s.sessionId);
      }
      if (!data.data?.codemanSession && !data.data?.files) {
        this.showToast('Nothing found to delete for this session', 'warning');
        return;
      }
      this.showToast('Session deleted', 'success');
      void this.loadHistorySessions?.();
    } catch (err) {
      this.showToast(`Delete failed: ${err.message}`, 'error');
    }
  },
});

// ── Case picker: no phantom "testcase" ─────────────────────────────────────
// Upstream's picker (session-ui.js buildCasePickerOptions) always appends a
// bare { name: 'testcase' } when the server did not list one, so a deleted
// testcase keeps showing up. Drop that synthetic entry; a real testcase (one the
// server lists, which carries a path) stays.

const forkUpstreamBuildCasePickerOptions = CodemanApp.prototype.buildCasePickerOptions;

Object.assign(CodemanApp.prototype, {
  buildCasePickerOptions(cases = []) {
    return forkUpstreamBuildCasePickerOptions
      .call(this, cases)
      .filter((option) => !(option.name === 'testcase' && !option.case?.path));
  },
});
