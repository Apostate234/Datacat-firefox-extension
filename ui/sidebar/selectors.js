"use strict";

/**
 * ui/sidebar/selectors.js — derived view models from store state (Phase 5).
 *
 * Intentionally thin for Phase 5: it exposes a small set of pure derivations
 * used by views/tests. It will grow as more of the legacy render helpers are
 * migrated to read from `getState()` in later phases. Browser: attaches to
 * globalThis.SourceVaultSidebarSelectors. Node: module.exports.
 */
(function (globalScope) {
  function getRetrievedList(state) {
    return (state && Array.isArray(state.retrievedList)) ? state.retrievedList : [];
  }

  function selectRetrievedItem(state, characterId) {
    if (!characterId) return null;
    return getRetrievedList(state).find((item) => item && item.id === characterId) || null;
  }

  function selectActiveMainTab(state) {
    return state && state.activeMainTab === "recent" ? "recent" : "detected";
  }

  function selectCurrentPage(state) {
    const cur = state && state.currentState;
    return cur && cur.page && typeof cur.page === "object" ? cur.page : null;
  }

  function selectQueueOutstanding(state) {
    const queue = state && state.queueState;
    if (!queue || !queue.counts) return 0;
    return Number(queue.counts.outstanding || 0);
  }

  function selectIsDatacatConnected(state) {
    const dc = state && state.datacatState;
    return !!(dc && dc.connected === true);
  }

  function selectIsDisplaySettled(state, storeApi) {
    const impl = storeApi
      || (globalScope && globalScope.SourceVaultSidebarStore)
      || (typeof require === "function" ? require("./store.js") : null);
    if (!impl || typeof impl.isStateDisplaySettled !== "function") return true;
    return impl.isStateDisplaySettled(state && state.currentState);
  }

  const api = {
    getRetrievedList,
    selectRetrievedItem,
    selectActiveMainTab,
    selectCurrentPage,
    selectQueueOutstanding,
    selectIsDatacatConnected,
    selectIsDisplaySettled,
  };

  if (globalScope) {
    globalScope.SourceVaultSidebarSelectors = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
