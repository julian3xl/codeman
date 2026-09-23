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
