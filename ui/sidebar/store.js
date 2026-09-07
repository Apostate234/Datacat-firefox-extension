"use strict";

/**
 * ui/sidebar/store.js — Pincat sidebar UI store (Phase 5).
 *
 * Single-source-of-truth state container for the sidebar UI. Provides
 * getState / dispatch / subscribe plus a reducer over internal UI action
 * types (NOT chrome message types). The tab-state acceptance logic
 * (stale epoch/revision rejection) that previously lived in
 * `shouldAcceptIncomingState` / `pageStateCoordinator` in sidebar.js is
 * ported here as pure, injectable helpers so it can be unit tested from Node
 * and reused by the runtime.
 *
 * Loaded as a plain <script> in the browser (attaches to
 * globalThis.SourceVaultSidebarStore) and require()-able from Node for tests
 * (module.exports mirrors the same surface, the shared/* pattern).
 */
(function (globalScope) {
  function getCore() {
    return (globalScope && globalScope.SourceVaultCore) || {};
  }

  // ---- Internal UI action types (dispatched from broadcast handlers) ----
  const ActionTypes = Object.freeze({
    TAB_STATE_RECEIVED: "TAB_STATE_RECEIVED",
    CURRENT_STATE_REPLACED: "CURRENT_STATE_REPLACED",
    ACTIVE_TAB_CHANGED: "ACTIVE_TAB_CHANGED",
    RETRIEVED_LIST_LOADED: "RETRIEVED_LIST_LOADED",
    UPLOAD_STATUS_UPDATED: "UPLOAD_STATUS_UPDATED",
    QUEUE_UPDATED: "QUEUE_UPDATED",
    DATACAT_STATE_UPDATED: "DATACAT_STATE_UPDATED",
    PREFLIGHT_UPDATED: "PREFLIGHT_UPDATED",
    SET_MAIN_TAB: "SET_MAIN_TAB",
    OPEN_RETRIEVED_DETAIL: "OPEN_RETRIEVED_DETAIL",
    OPEN_INSPECTION: "OPEN_INSPECTION",
    CLOSE_INSPECTION: "CLOSE_INSPECTION",
    CREATOR_UPDATED: "CREATOR_UPDATED",
    UPLOAD_VISIBILITY_UPDATED: "UPLOAD_VISIBILITY_UPDATED",
    SOURCE_ACCOUNT_APPROVALS_UPDATED: "SOURCE_ACCOUNT_APPROVALS_UPDATED",
    DEBUG_LOG: "DEBUG_LOG",
    STORAGE_CLEARED: "STORAGE_CLEARED",
  });

  // ---------------------------------------------------------------------------
  // Pure acceptance helpers (ported verbatim from sidebar.js so behaviour is
  // identical). They read from an explicit `coordinator` + `currentState` +
  // `core` rather than module globals, so they are testable and reusable.
  // ---------------------------------------------------------------------------

  function normalizeSourceKind(value, core) {
    const c = core || getCore();
    if (typeof c.normalizeSourceKind === "function") {
      return c.normalizeSourceKind(value);
    }
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "sauce" || normalized === "saucepan") return "saucepan";
    if (normalized === "janitor" || normalized === "janitorai" || normalized === "janny") return "janitor";
    return null;
  }

  function isGenericCharacterTitle(value, sourceKind, core) {
    const c = core || getCore();
    if (typeof c.isGenericSourceCharacterTitle === "function") {
      return c.isGenericSourceCharacterTitle(sourceKind, value);
    }
    const text = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) return true;
    if ([
      "character profile",
      "chats",
      "create a character",
      "followers",
      "following",
      "janitor",
      "janitor ai",
      "my chats",
      "new chat",
      "search",
    ].includes(text)) {
      return true;
    }
    return (
      /^janitor(?:ai)?(?:\.com)?\b/.test(text) ||
      /janitor\s*(?:ai)?\s*[-|:–—]\s*build,\s*share,\s*and\s*explore/.test(text) ||
      /search for characters/.test(text)
    );
  }

  function isCharacterStateSettled(character, page, core) {
    const c = core || getCore();
    const pageRoot = page && typeof page === "object" ? page : {};
    if (!pageRoot.isCharacterPage) return true;
    const root = character && typeof character === "object" ? character : null;
    const sourceKind = normalizeSourceKind(pageRoot.sourceKind || (root && root.sourceKind), c);
    if (typeof c.isSettledSourceCharacterState === "function") {
      return c.isSettledSourceCharacterState(sourceKind, root, pageRoot);
    }
    if (!root || !root.name || isGenericCharacterTitle(root.name, sourceKind, c)) return false;
    if (
      ["document_body", "document_fallback", "document_og_title", "document_title", "document_twitter_title", "url"]
        .includes(String(root.source || "").trim())
    ) {
      return false;
    }
    return true;
  }

  function isStateDisplaySettled(state, core) {
    const c = core || getCore();
    const root = state && typeof state === "object" ? state : {};
    const page = root.page && typeof root.page === "object" ? root.page : {};
    if (!root.page || page.pendingNavigation || page.navigationPhase === "loading") return false;
    if (page.isCharacterPage) return isCharacterStateSettled(root.character, page, c);
    return true;
  }

  function normalizeComparableSourceUrl(value) {
    try {
      const url = new URL(String(value || ""));
      url.hash = "";
      return `${url.origin}${url.pathname}${url.search}`.toLowerCase();
    } catch (_) {
      return String(value || "").replace(/#.*$/, "").toLowerCase();
    }
  }

  function getComparableSourceIdentity(value, core) {
    const c = core || getCore();
    const url = String(value || "").trim();
    if (!url) return null;
    const parsers = [
      ["janitor-character", c.parseJanitorCharacterUrl, "characterId"],
      ["janitor-creator", c.parseJanitorCreatorUrl, "creatorId"],
      ["saucepan-character", c.parseSaucepanCompanionUrl, "companionId"],
      ["saucepan-creator", c.parseSaucepanCreatorUrl, "handle"],
    ];
    for (const [kind, parser, idKey] of parsers) {
      if (typeof parser !== "function") continue;
      const parsed = parser(url);
      const id = parsed && parsed.valid ? parsed[idKey] : null;
      if (id) return `${kind}:${String(id).trim().toLowerCase()}`;
    }
    return normalizeComparableSourceUrl(url);
  }

  function sourceUrlsMatch(left, right, core) {
    const c = core || getCore();
    const leftIdentity = getComparableSourceIdentity(left, c);
    const rightIdentity = getComparableSourceIdentity(right, c);
    return !!(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
  }

  function getHttpUrlOrigin(value) {
    try {
      const url = new URL(String(value || ""));
      return /^https?:$/i.test(url.protocol) ? url.origin.toLowerCase() : null;
    } catch (_) {
      return null;
    }
  }

  function isDatacatNavigationRedirect(pendingUrl, state, datacatOrigin) {
    const root = state && typeof state === "object" ? state : {};
    const page = root.page && typeof root.page === "object" ? root.page : {};
    if (page.isDatacatSite !== true) return false;
    const pendingOrigin = getHttpUrlOrigin(pendingUrl);
    const stateOrigin = getHttpUrlOrigin(page.normalizedUrl || page.url);
    const configuredOrigin = getHttpUrlOrigin(datacatOrigin || page.datacatOrigin);
    return !!(
      pendingOrigin &&
      stateOrigin &&
      configuredOrigin &&
      pendingOrigin === configuredOrigin &&
      stateOrigin === configuredOrigin
    );
  }

  function getStatePageSignature(state, core) {
    const c = core || getCore();
    const root = state && typeof state === "object" ? state : {};
    const page = root.page && typeof root.page === "object" ? root.page : {};
    const character = root.character && typeof root.character === "object" ? root.character : {};
    return JSON.stringify({
      url: page.url || page.normalizedUrl || "",
      sourceKind: normalizeSourceKind(page.sourceKind, c) || (page.isDatacatSite ? "datacat" : "unknown"),
      isCharacterPage: page.isCharacterPage === true,
      isCreatorPage: page.isCreatorPage === true,
      isDatacatSite: page.isDatacatSite === true,
      unsupported: page.unsupported === true,
      characterId: character.id || character.characterId || character.companionId || page.characterId || page.companionId || null,
      creatorId: page.creatorId || character.creatorId || null,
      creatorHandle: page.creatorHandle || character.creatorHandle || null,
    });
  }

  function getStateRevision(state) {
    const value = Number(state && state.revision);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function getStateNavigationId(state) {
    const page = state && state.page && typeof state.page === "object" ? state.page : {};
    const value = Number(page.navigationId);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function getStateContextKey(tabId, state, core) {
    const c = core || getCore();
    const page = state && state.page && typeof state.page === "object" ? state.page : {};
    const instanceId = String(state && state.instanceId || page.contentInstanceId || "background");
    const identity = getComparableSourceIdentity(page.normalizedUrl || page.url || "", c) || getStatePageSignature(state, c);
    return `${Number(tabId || 0)}:${instanceId}:${getStateNavigationId(state)}:${identity}`;
  }

  /**
   * Decide whether an incoming tab state should replace the current one.
   * Ported from sidebar.js `shouldAcceptIncomingState`. All external inputs
   * (coordinator/currentState/fromFlightOwner/core) are passed explicitly.
   */
  function shouldAcceptIncomingState(tabId, state, options = {}) {
    if (!state || typeof state !== "object") return false;
    const coordinator = options.coordinator;
    if (!coordinator) return false;
    const currentState = options.currentState || null;
    const fromFlightOwner = options.fromFlightOwner === true;
    const core = options.core || getCore();

    if (tabId && coordinator.activeTabId && Number(tabId) !== Number(coordinator.activeTabId) && !fromFlightOwner) {
      return false;
    }
    const page = state.page && typeof state.page === "object" ? state.page : {};
    const stateUrl = page.normalizedUrl || page.url || "";
    if (
      coordinator.expectedUrl &&
      stateUrl &&
      !sourceUrlsMatch(coordinator.expectedUrl, stateUrl, core) &&
      !fromFlightOwner
    ) {
      return false;
    }
    const contextKey = getStateContextKey(tabId, state, core);
    const revision = getStateRevision(state);
    const pageInstanceId = String(state.instanceId || page.contentInstanceId || "background");
    const instanceKey = `${Number(tabId || 0)}:${pageInstanceId}`;
    const navigationId = getStateNavigationId(state);
    const acceptedNavigationId = Number(coordinator.acceptedNavigationIds.get(instanceKey) || 0);
    if (navigationId && acceptedNavigationId && navigationId < acceptedNavigationId) return false;
    const acceptedRevision = Number(coordinator.acceptedRevisions.get(contextKey) || 0);
    if (revision && acceptedRevision && revision < acceptedRevision) return false;
    const currentContextKey = currentState ? getStateContextKey(tabId, currentState, core) : null;
    if (
      currentContextKey === contextKey &&
      coordinator.settledContexts.has(contextKey) &&
      !isStateDisplaySettled(state, core)
    ) {
      return false;
    }
    const requestSequence = Number(options.requestSequence || 0);
    if (requestSequence && requestSequence < coordinator.latestAcceptedRequestSequence) return false;
    return true;
  }

  /** Record acceptance bookkeeping on the coordinator (ported verbatim). */
  function recordAcceptedIncomingState(coordinator, tabId, state, options = {}) {
    if (!coordinator) return;
    const core = options.core || getCore();
    const contextKey = getStateContextKey(tabId, state, core);
    const revision = getStateRevision(state);
    const page = state && state.page && typeof state.page === "object" ? state.page : {};
    const pageInstanceId = String(state.instanceId || page.contentInstanceId || "background");
    const instanceKey = `${Number(tabId || 0)}:${pageInstanceId}`;
    const navigationId = getStateNavigationId(state);
    if (navigationId) coordinator.acceptedNavigationIds.set(instanceKey, navigationId);
    if (revision) coordinator.acceptedRevisions.set(contextKey, revision);
    if (isStateDisplaySettled(state, core)) coordinator.settledContexts.add(contextKey);
    const requestSequence = Number(options.requestSequence || 0);
    if (requestSequence) {
      coordinator.latestAcceptedRequestSequence = Math.max(
        coordinator.latestAcceptedRequestSequence,
        requestSequence,
      );
    }
  }

  function createCoordinator() {
    return {
      activeTabId: null,
      expectedUrl: null,
      navigationEpoch: 0,
      eventRevision: 0,
      requestSequence: 0,
      latestAcceptedRequestSequence: 0,
      acceptedRevisions: new Map(),
      acceptedNavigationIds: new Map(),
      settledContexts: new Set(),
      fallbackTimer: null,
    };
  }

  function createEmptyQueueState() {
    return {
      revision: 0,
      status: "idle",
      activeItem: null,
      activeItemId: null,
      pending: [],
      finished: [],
      counts: { outstanding: 0, pending: 0, finished: 0, total: 0 },
    };
  }

  function createInitialState() {
    return {
      currentState: null,
      activeBrowserTabId: null,
      coordinator: createCoordinator(),
      activeMainTab: "detected",
      retrievedList: [],
      retrievedDetailId: null,
      inspection: { active: false, kind: null, characterId: null, origin: null },
      latestSavedCharacter: null,
      queueState: createEmptyQueueState(),
      datacatState: {
        origin: "https://datacat.run",
        authenticated: false,
        connected: false,
        canUpload: false,
        sessionReady: false,
        message: "Connect Datacat to save.",
      },
      uploadVisibility: "public",
      preflightState: null,
      sourceAccountApprovals: {},
      creatorDetail: { active: false, loading: false, error: null, record: null, freshness: null, request: null, phase: null },
      debugLogs: [],
    };
  }

  function normalizeUploadVisibility(value) {
    return String(value || "").trim().toLowerCase() === "mine" ? "mine" : "public";
  }

  function patchListUpload(list, characterId, upload) {
    if (!Array.isArray(list)) return list;
    return list.map((item) => {
      if (!item || item.id !== characterId) return item;
      return { ...item, upload: upload || item.upload };
    });
  }

  function reducer(state, action) {
    if (!action || typeof action !== "object") return state;
    switch (action.type) {
      case ActionTypes.TAB_STATE_RECEIVED: {
        const tabId = action.tabId || null;
        const tabState = action.state;
        const accepted = shouldAcceptIncomingState(tabId, tabState, {
          coordinator: state.coordinator,
          currentState: state.currentState,
          fromFlightOwner: action.fromFlightOwner === true,
          requestSequence: action.requestSequence || 0,
          core: action.core,
        });
        if (!accepted) return state;
        recordAcceptedIncomingState(state.coordinator, tabId, tabState, {
          requestSequence: action.requestSequence || 0,
          core: action.core,
        });
        const next = { ...state, currentState: tabState };
        if (tabId && action.fromFlightOwner !== true) {
          next.activeBrowserTabId = tabId;
          state.coordinator.activeTabId = Number(tabId);
          const page = tabState.page && typeof tabState.page === "object" ? tabState.page : {};
          if (!state.coordinator.expectedUrl && (page.normalizedUrl || page.url)) {
            state.coordinator.expectedUrl = page.normalizedUrl || page.url;
          }
        }
        return next;
      }
      case ActionTypes.CURRENT_STATE_REPLACED:
        return { ...state, currentState: action.state || null };
      case ActionTypes.ACTIVE_TAB_CHANGED: {
        return { ...state, activeBrowserTabId: action.tabId || state.activeBrowserTabId };
      }
      case ActionTypes.RETRIEVED_LIST_LOADED: {
        return { ...state, retrievedList: Array.isArray(action.list) ? action.list : state.retrievedList };
      }
      case ActionTypes.UPLOAD_STATUS_UPDATED: {
        const list = Array.isArray(action.list)
          ? action.list
          : patchListUpload(state.retrievedList, action.characterId, action.upload);
        const next = { ...state, retrievedList: list };
        if (state.latestSavedCharacter && state.latestSavedCharacter.id === action.characterId) {
          next.latestSavedCharacter = {
            ...state.latestSavedCharacter,
            upload: action.upload || state.latestSavedCharacter.upload,
          };
        }
        return next;
      }
      case ActionTypes.QUEUE_UPDATED: {
        const incoming = action.queue && typeof action.queue === "object" ? action.queue : null;
        if (!incoming) return state;
        if (Number(incoming.revision || 0) < Number(state.queueState && state.queueState.revision || 0)) return state;
        return { ...state, queueState: incoming };
      }
      case ActionTypes.DATACAT_STATE_UPDATED: {
        return { ...state, datacatState: action.state || state.datacatState };
      }
      case ActionTypes.UPLOAD_VISIBILITY_UPDATED: {
        return { ...state, uploadVisibility: normalizeUploadVisibility(action.visibility) };
      }
      case ActionTypes.PREFLIGHT_UPDATED: {
        return { ...state, preflightState: action.preflight || null };
      }
      case ActionTypes.SET_MAIN_TAB: {
        return { ...state, activeMainTab: action.tab === "recent" ? "recent" : "detected" };
      }
      case ActionTypes.OPEN_RETRIEVED_DETAIL: {
        return { ...state, retrievedDetailId: action.characterId || null };
      }
      case ActionTypes.OPEN_INSPECTION: {
        return {
          ...state,
          inspection: {
            active: true,
            kind: action.kind || "character",
            characterId: action.characterId || null,
            origin: action.origin || null,
          },
        };
      }
      case ActionTypes.CLOSE_INSPECTION: {
        return {
          ...state,
          inspection: { active: false, kind: null, characterId: null, origin: null },
        };
      }
      case ActionTypes.CREATOR_UPDATED: {
        return { ...state, creatorDetail: { ...state.creatorDetail, ...(action.creatorDetail || {}) } };
      }
      case ActionTypes.SOURCE_ACCOUNT_APPROVALS_UPDATED: {
        return { ...state, sourceAccountApprovals: action.approvals && typeof action.approvals === "object" ? action.approvals : {} };
      }
      case ActionTypes.DEBUG_LOG: {
        const limit = Number.isFinite(action.limit) ? action.limit : 120;
        return { ...state, debugLogs: [...state.debugLogs, action.entry].slice(-limit) };
      }
      case ActionTypes.STORAGE_CLEARED: {
        const fresh = createInitialState();
        fresh.coordinator = state.coordinator; // preserve tab-tracking across clear
        fresh.datacatState = state.datacatState;
        fresh.uploadVisibility = state.uploadVisibility;
        return fresh;
      }
      default:
        return state;
    }
  }

  function createStore(preloadedState) {
    let state = preloadedState || createInitialState();
    const listeners = new Set();
    function getState() {
      return state;
    }
    function dispatch(action) {
      state = reducer(state, action);
      listeners.forEach((listener) => {
        try {
          listener(state, action);
        } catch (_) {}
      });
      return action;
    }
    function subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    return { getState, dispatch, subscribe };
  }

  function shouldAcceptSourceAccountApprovalRead(
    requestSequence,
    currentRequestSequence,
    decisionSequenceAtStart,
    currentDecisionSequence,
  ) {
    return (
      Number(requestSequence || 0) === Number(currentRequestSequence || 0) &&
      Number(decisionSequenceAtStart || 0) === Number(currentDecisionSequence || 0)
    );
  }

  function isCurrentRequestSequence(requestSequence, currentRequestSequence) {
    return Number(requestSequence || 0) === Number(currentRequestSequence || 0);
  }

  const api = {
    ActionTypes,
    createStore,
    reducer,
    createInitialState,
    createCoordinator,
    createEmptyQueueState,
    // pure helpers (exported for reuse by the runtime + tests)
    shouldAcceptIncomingState,
    recordAcceptedIncomingState,
    isStateDisplaySettled,
    isCharacterStateSettled,
    isGenericCharacterTitle,
    normalizeSourceKind,
    normalizeComparableSourceUrl,
    getComparableSourceIdentity,
    sourceUrlsMatch,
    isDatacatNavigationRedirect,
    getStatePageSignature,
    getStateRevision,
    getStateNavigationId,
    getStateContextKey,
    normalizeUploadVisibility,
    patchListUpload,
    isCurrentRequestSequence,
    shouldAcceptSourceAccountApprovalRead,
  };

  if (globalScope) {
    globalScope.SourceVaultSidebarStore = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
