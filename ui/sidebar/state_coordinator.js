function shouldAcceptIncomingState(tabId, state, options = {}) {
  return SourceVaultSidebarStore.shouldAcceptIncomingState(tabId, state, {
    coordinator: pageStateCoordinator,
    currentState,
    fromFlightOwner: isRetrievalFlightOwnerTab(tabId),
    requestSequence: options.requestSequence || 0,
    core: SourceVaultCore,
  });
}

function recordAcceptedIncomingState(tabId, state, options = {}) {
  SourceVaultSidebarStore.recordAcceptedIncomingState(pageStateCoordinator, tabId, state, {
    requestSequence: options.requestSequence || 0,
    core: SourceVaultCore,
  });
  if (pageStateCoordinator.fallbackTimer && isStateDisplaySettled(state)) {
    clearTimeout(pageStateCoordinator.fallbackTimer);
    pageStateCoordinator.fallbackTimer = null;
  }
}

function applyIncomingState(tabId, state, options = {}) {
  const previousState = sidebarStore.getState().currentState;
  const nextStoreState = dispatchSidebar({
    type: SourceVaultSidebarStore.ActionTypes.TAB_STATE_RECEIVED,
    tabId,
    state,
    fromFlightOwner: isRetrievalFlightOwnerTab(tabId),
    requestSequence: options.requestSequence || 0,
    core: SourceVaultCore,
  });
  if (nextStoreState.currentState === previousState) {
    debugLog("state_rejected_by_coordinator", {
      tabId,
      requestSequence: options.requestSequence || null,
      state: summarizeStateForDebug(state),
    });
    return false;
  }
  if (pageStateCoordinator.fallbackTimer && isStateDisplaySettled(state)) {
    clearTimeout(pageStateCoordinator.fallbackTimer);
    pageStateCoordinator.fallbackTimer = null;
  }
  if (options.updateFlight !== false) updateRetrievalFlightFromState(tabId, state);
  render(state);
  return true;
}

function schedulePendingStateFallback() {
  if (pageStateCoordinator.fallbackTimer) clearTimeout(pageStateCoordinator.fallbackTimer);
  pageStateCoordinator.fallbackTimer = setTimeout(() => {
    pageStateCoordinator.fallbackTimer = null;
    const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : {};
    if (page.pendingNavigation || !isStateDisplaySettled(currentState)) {
      requestState({ force: false, autoOpenRetrieval: true });
    }
  }, PAGE_STATE_FALLBACK_MS);
}

function stateMatchesPendingSourceNavigation(state, pendingUrl = pendingSourceNavigationUrl) {
  if (!pendingUrl) return true;
  const page = state && state.page && typeof state.page === "object" ? state.page : {};
  const candidates = [page.normalizedUrl, page.url].filter(Boolean);
  if (!candidates.length) return false;
  return candidates.some((candidate) => sourceUrlsMatch(candidate, pendingUrl));
}

function acceptPendingSourceNavigationState(tabId, state, options = {}) {
  const currentPage = currentState && currentState.page && typeof currentState.page === "object"
    ? currentState.page
    : {};
  const pendingUrl =
    pendingSourceNavigationUrl ||
    (currentPage.pendingNavigation === true ? pageStateCoordinator.expectedUrl : null);
  if (!pendingUrl) return true;
  const page = state && state.page && typeof state.page === "object" ? state.page : {};
  const actualUrl = page.normalizedUrl || page.url || null;
  const exactMatch = stateMatchesPendingSourceNavigation(state, pendingUrl);
  const activeTabId = Number(pageStateCoordinator.activeTabId || activeBrowserTabId || 0);
  const fromActiveTab = Number(tabId || 0) > 0 && Number(tabId) === activeTabId;
  const datacatOrigin =
    (datacatState && datacatState.origin) ||
    page.datacatOrigin ||
    null;
  const datacatRedirect =
    !exactMatch &&
    fromActiveTab &&
    SourceVaultSidebarStore.isDatacatNavigationRedirect(
      pendingUrl,
      state,
      datacatOrigin,
    );
  if (!exactMatch && !datacatRedirect) return false;
  if (datacatRedirect && actualUrl) pageStateCoordinator.expectedUrl = actualUrl;
  pendingSourceNavigationUrl = null;
  debugLog("pending_source_navigation_reconciled", {
    channel: options.channel || null,
    requestId: options.requestId || null,
    tabId: tabId || null,
    match: datacatRedirect ? "datacat_redirect" : "exact",
    pendingUrl,
    actualUrl,
  });
  return true;
}

function getSourceKindFromUrl(rawUrl) {
  if (SourceRegistry && typeof SourceRegistry.resolveUrl === "function") {
    const resolved = SourceRegistry.resolveUrl(rawUrl);
    if (resolved) return resolved.sourceKind;
  }
  try {
    const url = new URL(String(rawUrl || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "saucepan.ai") return "saucepan";
    if (host === "janitorai.com") return "janitor";
  } catch (_) {}
  return null;
}

function buildCreatorSourceUrl(request) {
  const root = request && typeof request === "object" ? request : {};
  const sourceKind = normalizeSourceKind(root.sourceKind) || (root.creatorHandle ? "saucepan" : "janitor");
  const descriptor = getSourceDescriptor(sourceKind);
  const creatorRoute = descriptor && Array.isArray(descriptor.routes)
    ? descriptor.routes.find((route) => route.type === "creator")
    : null;
  const routeIdentityKey = String(creatorRoute && creatorRoute.idKey || "").trim();
  let routeIdentity = routeIdentityKey ? root[routeIdentityKey] : null;
  if (!routeIdentity && routeIdentityKey === "creatorHandle") routeIdentity = root.creatorHandle || root.handle || null;
  if (!routeIdentity && routeIdentityKey === "creatorId") routeIdentity = root.creatorId || root.id || null;
  const normalizedRouteIdentity = String(routeIdentity || "").replace(/^@+/, "").trim();
  if (creatorRoute && creatorRoute.canonicalUrl && normalizedRouteIdentity) {
    return creatorRoute.canonicalUrl.replace("{id}", encodeURIComponent(normalizedRouteIdentity));
  }
  const existing = String(root.url || root.profileUrl || "").trim();
  if (/^https?:\/\//i.test(existing)) return existing;
  if (sourceKind === "saucepan") {
    const handle = String(root.creatorHandle || root.handle || "").replace(/^@+/, "").trim();
    return handle ? `https://saucepan.ai/u/${encodeURIComponent(handle)}` : null;
  }
  const creatorId = String(root.creatorId || root.id || "").trim();
  return creatorId ? `https://janitorai.com/profiles/${encodeURIComponent(creatorId)}` : null;
}

function buildPendingSourceNavigationState(rawUrl, status) {
  const urlText = String(rawUrl || "").trim();
  const sourceKind = getSourceKindFromUrl(urlText);
  const sourceLabel = sourceKind ? getSourceLabel(sourceKind) : null;
  const page = {
    isSupportedSite: !!sourceKind,
    isCharacterPage: false,
    isCreatorPage: false,
    isDatacatSite: false,
    unsupported: !sourceKind,
    sourceKind,
    sourceLabel,
    url: urlText || null,
    normalizedUrl: urlText || null,
    hostname: null,
    pendingNavigation: true,
    navigationId: Number(pageStateCoordinator.navigationEpoch || 0),
    navigationPhase: "loading",
    navigationStatus: status || "loading",
  };
  try {
    const parsedUrl = new URL(urlText);
    page.hostname = parsedUrl.hostname;
    const configuredDatacatOrigin = datacatState && datacatState.origin ? new URL(datacatState.origin).origin : null;
    if (configuredDatacatOrigin && parsedUrl.origin === configuredDatacatOrigin) {
      page.isDatacatSite = true;
      page.unsupported = false;
      page.sourceLabel = "Datacat";
    }
  } catch (_) {}
  const registered = SourceRegistry && typeof SourceRegistry.resolveUrl === "function"
    ? SourceRegistry.resolveUrl(urlText)
    : null;
  if (registered && (registered.isCharacterPage || registered.isCreatorPage)) {
    Object.assign(page, {
      sourceKind: registered.sourceKind,
      sourceLabel: registered.sourceLabel || getSourceLabel(registered.sourceKind),
      isCharacterPage: registered.isCharacterPage === true,
      isCreatorPage: registered.isCreatorPage === true,
      unsupported: false,
      characterId: registered.characterId || null,
      companionId: registered.companionId || null,
      creatorId: registered.creatorId || null,
      creatorHandle: registered.creatorHandle || null,
      normalizedUrl: registered.normalizedUrl || urlText,
    });
  }
  const janitorCharacter = SourceVaultCore.parseJanitorCharacterUrl ? SourceVaultCore.parseJanitorCharacterUrl(urlText) : null;
  const janitorCreator = SourceVaultCore.parseJanitorCreatorUrl ? SourceVaultCore.parseJanitorCreatorUrl(urlText) : null;
  const saucepanCharacter = SourceVaultCore.parseSaucepanCompanionUrl ? SourceVaultCore.parseSaucepanCompanionUrl(urlText) : null;
  const saucepanCreator = SourceVaultCore.parseSaucepanCreatorUrl ? SourceVaultCore.parseSaucepanCreatorUrl(urlText) : null;
  if (registered && (registered.isCharacterPage || registered.isCreatorPage)) {
    // Registry result above is authoritative; legacy parsers remain fallback.
  } else if (janitorCharacter && janitorCharacter.valid) {
    page.sourceKind = "janitor";
    page.sourceLabel = "Janitor";
    page.isCharacterPage = true;
    page.unsupported = false;
    page.characterId = janitorCharacter.characterId || null;
    page.normalizedUrl = janitorCharacter.normalizedUrl || urlText;
  } else if (saucepanCharacter && saucepanCharacter.valid) {
    page.sourceKind = "saucepan";
    page.sourceLabel = "Saucepan";
    page.isCharacterPage = true;
    page.unsupported = false;
    page.companionId = saucepanCharacter.companionId || null;
    page.normalizedUrl = saucepanCharacter.normalizedUrl || urlText;
  } else if (janitorCreator && janitorCreator.valid) {
    page.sourceKind = "janitor";
    page.sourceLabel = "Janitor";
    page.isCreatorPage = true;
    page.unsupported = false;
    page.creatorId = janitorCreator.creatorId || null;
    page.normalizedUrl = janitorCreator.normalizedUrl || urlText;
  } else if (saucepanCreator && saucepanCreator.valid) {
    page.sourceKind = "saucepan";
    page.sourceLabel = "Saucepan";
    page.isCreatorPage = true;
    page.unsupported = false;
    page.creatorHandle = saucepanCreator.handle || null;
    page.normalizedUrl = saucepanCreator.normalizedUrl || urlText;
  }
  const previousAuth = currentState && currentState.auth && currentState.page && currentState.page.sourceKind === page.sourceKind
    ? currentState.auth
    : { loggedIn: false, checking: true };
  return { auth: previousAuth, page, character: null, retrieval: null };
}

function enterPendingSourceNavigation(url, status) {
  const targetUrl = String(url || "").trim();
  debugLog("pending_source_navigation_enter", { url: targetUrl, status: status || "loading" });
  pendingSourceNavigationUrl = targetUrl || null;
  currentCreatorOpenSeq += 1;
  autoCreatorOpenKey = null;
  if (autoCreatorOpenTimer) {
    clearTimeout(autoCreatorOpenTimer);
    autoCreatorOpenTimer = null;
  }
  currentPageTerminalState = null;
  if (!isRetrievalFlightActive()) retrievalDisplayMachine.flight = null;
  preflightState = null;
  preflightError = null;
  preflightLoading = false;
  preflightKey = null;
  clearCurrentDetailState();
  setActiveMainTab("detected", { skipRefresh: true });
  const pendingState = buildPendingSourceNavigationState(targetUrl, status);
  dispatchSidebar({
    type: SourceVaultSidebarStore.ActionTypes.CURRENT_STATE_REPLACED,
    state: pendingState,
  });
  renderUploadOptionsPanel();
  renderPreflightStatus();
  renderRetrievalActivityPanel();
  renderCurrentPageCard();
  renderCurrentDetailsPanel();
}

function beginActiveBrowserPageContext(message) {
  const eventRevision = Number(message && message.eventRevision || 0);
  if (eventRevision && eventRevision < pageStateCoordinator.eventRevision) {
    debugLog("browser_context_event_ignored_stale", {
      type: message && message.type,
      tabId: message && message.tabId,
      eventRevision,
      acceptedEventRevision: pageStateCoordinator.eventRevision,
    });
    return { accepted: false, changed: false };
  }
  if (eventRevision) pageStateCoordinator.eventRevision = eventRevision;
  const tabId = message && message.tabId ? Number(message.tabId) : null;
  const url = String(message && message.url || "").trim() || null;
  const navigationEpoch = Number(message && message.navigationEpoch || 0);
  const status = String(message && message.status || "").trim().toLowerCase();
  const tabChanged = !!(tabId && Number(pageStateCoordinator.activeTabId || 0) !== tabId);
  const urlChanged = !!(
    url &&
    (!pageStateCoordinator.expectedUrl || !sourceUrlsMatch(url, pageStateCoordinator.expectedUrl))
  );
  const reloadStarted = !!(
    status === "loading" &&
    navigationEpoch > Number(pageStateCoordinator.navigationEpoch || 0)
  );
  const preserveActivity = shouldPreserveActivityForDatacatContext(tabId, url);
  const changed = tabChanged || urlChanged || reloadStarted;
  if (tabId) {
    pageStateCoordinator.activeTabId = tabId;
    activeBrowserTabId = tabId;
    retrievalDisplayMachine.focusTabId = tabId;
  }
  if (url) pageStateCoordinator.expectedUrl = url;
  if (navigationEpoch) pageStateCoordinator.navigationEpoch = navigationEpoch;
  if (!changed) return { accepted: true, changed: false };

  pageStateCoordinator.latestAcceptedRequestSequence = pageStateCoordinator.requestSequence;
  pendingSourceNavigationUrl = url;
  if (preserveActivity) {
    debugLog("activity_datacat_navigation_preserved", {
      tabId,
      url,
      activityId: selectedActivityId,
    });
    return { accepted: true, changed: true, preservedActivity: true };
  }
  if (isRetrievalFlightActive()) {
    renderRetrievalFlightState();
    return { accepted: true, changed: true, preservedFlight: true };
  }
  clearCurrentPageTerminalState();
  clearCurrentDetailState();
  if (url) {
    enterPendingSourceNavigation(url, status || "loading");
    schedulePendingStateFallback();
  } else {
    pendingSourceNavigationUrl = null;
    render(null);
  }
  return { accepted: true, changed: true };
}

function navigateSourcePageFromExtension(url, meta = {}) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    debugLog("source_navigation_blocked_empty_url", meta);
    return;
  }
  debugLog("source_navigation_requested", { url: targetUrl, reason: meta.reason || null });
  enterPendingSourceNavigation(targetUrl, "loading");
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_NAVIGATE_ACTIVE_SOURCE_PAGE, url: targetUrl, tabId: activeBrowserTabId, windowId: panelWindowId }, (response) => {
    if (!chrome.runtime.lastError && response && response.ok) {
      debugLog("source_navigation_background_ok", {
        url: targetUrl,
        reason: meta.reason || null,
        tabId: response.tabId || null,
        method: response.method || null,
      });
      return;
    }
    debugLog("source_navigation_background_fallback", {
      url: targetUrl,
      reason: meta.reason || null,
      runtimeError: chrome.runtime.lastError && chrome.runtime.lastError.message,
      response,
    });
    navigateActiveTab(targetUrl, { reason: meta.reason || "background_navigation_fallback" });
  });
}

function navigateActiveTab(url, meta = {}) {
  if (!url) {
    debugLog("active_tab_navigation_blocked_empty_url", meta);
    return;
  }
  debugLog("active_tab_navigation_requested", { url, reason: meta.reason || null });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs.length ? tabs[0] : null;
    if (tab && tab.id) {
      debugLog("active_tab_navigation_update", { tabId: tab.id, url, reason: meta.reason || null });
      chrome.tabs.update(tab.id, { url });
      return;
    }
    debugLog("active_tab_navigation_create", { url, reason: meta.reason || null });
    chrome.tabs.create({ url });
  });
}

function getSourceLoginUrl(sourceKind) {
  return normalizeSourceKind(sourceKind) === "saucepan"
    ? "https://saucepan.ai/login"
    : "https://janitorai.com/login";
}

function openSourceLogin(sourceKind) {
  navigateActiveTab(getSourceLoginUrl(sourceKind));
}

function buildPreflightBody(options = {}) {
  const page = currentState && currentState.page ? currentState.page : null;
  const characterId = getCurrentCharacterId();
  if (isCurrentCharacterSettling()) return null;
  if (!page || !page.isCharacterPage || !characterId) return null;
  const creator = getCurrentCreatorInfo();
  const sourceVisibility = getCurrentSourceCharacterVisibility();
  const requestedVisibility = normalizeUploadVisibility(options.visibility || uploadVisibility);
  const effectiveVisibility = isCurrentSourceCharacterPrivate() ? "mine" : requestedVisibility;
  return {
    sourceKind: getCurrentSourceKind(),
    characterId,
    creatorId: creator.creatorId,
    creatorHandle: creator.creatorHandle,
    visibility: effectiveVisibility,
    requestedVisibility,
    sourceVisibility,
    forceRetrieve: options.forceRetrieve === true,
    localOnly: options.localOnly === true,
  };
}

function buildRetrievalOptions(options = {}) {
  const requestedVisibility = normalizeUploadVisibility(options.visibility || uploadVisibility);
  return {
    visibility: isCurrentSourceCharacterPrivate() ? "mine" : requestedVisibility,
    requestedVisibility,
    sourceVisibility: getCurrentSourceCharacterVisibility(),
    forceRetrieve: options.forceRetrieve === true,
    localOnly: options.localOnly === true,
    preflight: options.preflight || preflightState || null,
  };
}

function setActiveMainTab(tab, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const nextTab = tab === "recent" ? "recent" : "detected";
  const enteringRecent = activeMainTab !== "recent" && nextTab === "recent";
  if (activeMainTab === "recent" && nextTab !== "recent" && opts.preserveRecentExpansion !== true) {
    expandedRecentId = null;
    selectedActivityId = null;
    pendingActivityDatacatNavigation = null;
  }
  if (enteringRecent) {
    expandedRecentId = null;
    activityVisibleLimit = ACTIVITY_PAGE_SIZE;
    selectedActivityId = null;
  }
  dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.SET_MAIN_TAB, tab: nextTab });
  currentPageTab.classList.toggle("is-active", activeMainTab === "detected");
  currentPageTab.setAttribute("aria-selected", activeMainTab === "detected" ? "true" : "false");
  charactersTab.classList.toggle("is-active", activeMainTab === "recent");
  charactersTab.setAttribute("aria-selected", activeMainTab === "recent" ? "true" : "false");
  currentPageView.hidden = activeMainTab !== "detected";
  charactersView.hidden = activeMainTab !== "recent";
  if (typeof recordCompanionActivity === "function") {
    recordCompanionActivity("surface", activeMainTab === "recent" ? "activity" : "retrieve", {
      surface: activeMainTab === "recent" ? "activity" : "retrieve",
    });
  }
  if (activeMainTab === "recent" && opts.skipRefresh !== true) refreshActivityState();
}

function resetRecentScrollPosition() {
  const scrollTargets = [
    charactersView,
    retrievedPanel,
    document.scrollingElement,
    document.documentElement,
    document.body,
  ];
  for (const target of scrollTargets) {
    if (!target) continue;
    try {
      target.scrollTop = 0;
      target.scrollLeft = 0;
    } catch (_) {}
  }
  try {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  } catch (_) {
    try {
      window.scrollTo(0, 0);
    } catch (_) {}
  }
}

function scheduleRecentScrollReset() {
  resetRecentScrollPosition();
  requestAnimationFrame(() => resetRecentScrollPosition());
  setTimeout(() => resetRecentScrollPosition(), 60);
}

function getNavigationOrigin(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).origin;
  } catch (_) {
    return null;
  }
}

function startActivityDatacatNavigation(url, activityId) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl || activeMainTab !== "recent") return false;
  selectedActivityId = activityId ? String(activityId) : null;
  pendingActivityDatacatNavigation = {
    url: targetUrl,
    tabId: null,
    expiresAt: Date.now() + 15000,
  };
  renderRetrievedPanel();
  return true;
}

function shouldPreserveActivityForDatacatContext(tabId, rawUrl) {
  const pending = pendingActivityDatacatNavigation;
  if (!pending || activeMainTab !== "recent") return false;
  if (Date.now() > Number(pending.expiresAt || 0)) {
    pendingActivityDatacatNavigation = null;
    return false;
  }
  const expectedOrigin = getNavigationOrigin(pending.url);
  const actualOrigin = getNavigationOrigin(rawUrl);
  const numericTabId = Number(tabId || 0) || null;
  if (pending.tabId && numericTabId) {
    if (pending.tabId !== numericTabId) return false;
    if (expectedOrigin && actualOrigin === expectedOrigin) return true;
    return !actualOrigin && /^(?:about:blank)?$/i.test(String(rawUrl || ""));
  }
  if (!expectedOrigin || actualOrigin !== expectedOrigin) return false;
  if (!pending.tabId && numericTabId) pending.tabId = numericTabId;
  return true;
}

function shouldPreserveActivityForDatacatState(state) {
  const page = state && state.page && typeof state.page === "object" ? state.page : {};
  return shouldPreserveActivityForDatacatContext(
    pageStateCoordinator.activeTabId || activeBrowserTabId,
    page.normalizedUrl || page.url,
  );
}

function openDatacatUrlFromTarget(target, options = {}) {
  const url = target && target.getAttribute("data-url");
  if (!url) {
    debugLog("datacat_link_blocked_no_url", {
      action: target && target.getAttribute("data-action"),
    });
    return false;
  }
  if (options.preserveActivity === true) {
    const row = target.closest && target.closest("[data-recent-id]");
    const activityId =
      options.activityId ||
      target.getAttribute("data-recent-id") ||
      (row && row.getAttribute("data-recent-id"));
    if (startActivityDatacatNavigation(url, activityId)) {
      debugLog("datacat_link_open", { url, preserveActivity: true });
      chrome.tabs.create({ url, active: true }, (tab) => {
        if (chrome.runtime.lastError || !tab || !tab.id) {
          pendingActivityDatacatNavigation = null;
          selectedActivityId = null;
          renderRetrievedPanel();
          return;
        }
        if (pendingActivityDatacatNavigation) pendingActivityDatacatNavigation.tabId = Number(tab.id);
      });
      return true;
    }
  }
  debugLog("datacat_link_open", { url });
  chrome.tabs.create({ url });
  return true;
}

function openCurrentDatacatView(reason, options = {}) {
  if (isCurrentPageTransactionActive()) {
    debugLog("current_datacat_view_blocked_transaction_active", {
      reason,
      upload: getCurrentTransactionUpload(),
      state: summarizeStateForDebug(currentState),
    });
    renderUploadOptionsPanel();
    renderCurrentPageCard();
    return false;
  }
  if (!hasExistingAccessibleCharacter()) {
    const message = "Datacat link is not available for this character yet.";
    debugLog("current_datacat_view_blocked", {
      reason,
      message,
      state: summarizeStateForDebug(currentState),
    });
    setCurrentPageTerminalState({
      title: "Link unavailable",
      message,
      tone: "failed",
    });
    renderCurrentPageCard();
    return false;
  }
  const section = options.section === "reimagination" ? "reimagination" : null;
  const targetUrl = section === "reimagination"
    ? getCurrentDatacatReimaginationUrl()
    : getCurrentDatacatViewUrl();
  const url = buildDatacatUrl(targetUrl);
  debugLog("current_datacat_view_open", { reason, url, section });
  chrome.tabs.create({ url });
  return true;
}

function getRetrievedItemSourceKind(item) {
  const root = item && typeof item === "object" ? item : {};
  const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
  const capture = root.capture && typeof root.capture === "object" ? root.capture : {};
  return summary.sourceKind || capture.sourceKind || (capture.saucepanCore ? "saucepan" : "janitor");
}

function getDefaultDetailTabForItem(item) {
  return getRetrievedItemSourceKind(item) === "saucepan" ? "saucepan" : "core";
}

function openCharactersTab(characterId) {
  if (characterId) {
    openRetrievedDetail(characterId, { resetTab: true });
  } else {
    setActiveMainTab("recent");
    renderRetrievedPanel();
  }
}

function idsMatch(a, b) {
  const left = String(a || "").trim().toLowerCase();
  const right = String(b || "").trim().toLowerCase();
  return !!(left && right && left === right);
}

function getStateRetrieval(state) {
  return state && state.retrieval && typeof state.retrieval === "object" ? state.retrieval : null;
}

function getStateCharacterId(state) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  const character = root.character && typeof root.character === "object" ? root.character : {};
  return character.id || character.characterId || character.companionId || page.characterId || page.companionId || null;
}

function getActiveRetrievalFlight() {
  return retrievalDisplayMachine && retrievalDisplayMachine.flight
    ? retrievalDisplayMachine.flight
    : null;
}

function getActiveRetrievalFallback() {
  const flight = getActiveRetrievalFlight();
  return flight && flight.fallback ? flight.fallback : null;
}

function setActiveRetrievalFallback(fallback) {
  const flight = getActiveRetrievalFlight();
  if (!flight) return;
  flight.fallback = fallback || null;
  flight.updatedAt = new Date().toISOString();
}

function getActiveRecoveryJob() {
  const flight = getActiveRetrievalFlight();
  return flight && flight.recoveryJob ? flight.recoveryJob : null;
}

function setActiveRecoveryJob(job) {
  const root = job && typeof job === "object" ? job : null;
  if (!getActiveRetrievalFlight() && root) {
    retrievalDisplayMachine.flight = {
      active: isJannyRecoveryJobActive(root),
      ownerTabId: root.ownerTabId || activeBrowserTabId || null,
      state: currentState || null,
      fallback: null,
      recoveryJob: root,
      signature: getStatePageSignature(currentState),
      characterId: root.characterId || getCurrentCharacterId(),
      sourceKind: getCurrentSourceKind() || "janitor",
      startedAt: root.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return;
  }
  const flight = getActiveRetrievalFlight();
  if (!flight) return;
  flight.recoveryJob = root;
  flight.active = root && isJannyRecoveryJobActive(root) ? true : flight.active;
  flight.updatedAt = new Date().toISOString();
}

function isRetrievalFlightActive() {
  const flight = getActiveRetrievalFlight();
  if (!flight) return false;
  const retrieval = getStateRetrieval(flight.state) || (flight.fallback && flight.fallback.retrieval) || null;
  return !!(
    flight.active ||
    (retrieval && retrieval.running) ||
    isUploadTransactionPending(flight.upload) ||
    isUploadTransactionPending(flight.fallback && flight.fallback.upload) ||
    (flight.recoveryJob && isJannyRecoveryJobActive(flight.recoveryJob))
  );
}

function isRetrievalFlightOwnerTab(tabId) {
  const flight = getActiveRetrievalFlight();
  return !!(flight && tabId && flight.ownerTabId && Number(tabId) === Number(flight.ownerTabId));
}

function updateRetrievalFlightFromState(tabId, state, options = {}) {
  const retrieval = getStateRetrieval(state);
  const hasActivity = hasRetrievalActivity(retrieval);
  const currentFlight = getActiveRetrievalFlight();
  if (!isSupportedCharacterState(state)) {
    if (currentFlight && !isRetrievalFlightActive()) retrievalDisplayMachine.flight = null;
    return;
  }
  const characterId = getStateCharacterId(state);
  const sourceKind = normalizeSourceKind(state && state.page && state.page.sourceKind) || null;
  const recoveryJob = retrieval && retrieval.jannyRecoveryJob && typeof retrieval.jannyRecoveryJob === "object"
    ? retrieval.jannyRecoveryJob
    : null;
  const recoveryActive = !!(recoveryJob && isJannyRecoveryJobActive(recoveryJob));
  const canStartFlight = !!(retrieval && retrieval.running === true) || recoveryActive;
  const matchesExistingFlight = !!(
    currentFlight &&
    (
      (tabId && currentFlight.ownerTabId && Number(tabId) === Number(currentFlight.ownerTabId)) ||
      (characterId && idsMatch(characterId, currentFlight.characterId))
    )
  );
  if (currentFlight && !matchesExistingFlight && isRetrievalFlightActive()) return;
  const baseFlight = matchesExistingFlight ? currentFlight : null;
  if (!baseFlight && !canStartFlight) {
    if (currentFlight && !isRetrievalFlightActive()) retrievalDisplayMachine.flight = null;
    return;
  }
  if (!hasActivity && baseFlight && options.clearWhenIdle === true) {
    retrievalDisplayMachine.flight = null;
    return;
  }
  retrievalDisplayMachine.flight = {
    ...(baseFlight || {}),
    active:
      !!(retrieval && retrieval.running) ||
      recoveryActive ||
      !!(baseFlight && baseFlight.active && !(retrieval && (retrieval.summary || retrieval.error))),
    ownerTabId: tabId || (baseFlight && baseFlight.ownerTabId) || activeBrowserTabId || null,
    state: state || (baseFlight && baseFlight.state) || null,
    fallback: (baseFlight && baseFlight.fallback) || null,
    signature: getStatePageSignature(state),
    characterId: characterId || (baseFlight && baseFlight.characterId) || null,
    sourceKind: sourceKind || (baseFlight && baseFlight.sourceKind) || null,
    recoveryJob:
      recoveryJob ||
      (baseFlight && baseFlight.recoveryJob) ||
      null,
    updatedAt: new Date().toISOString(),
    startedAt: (baseFlight && baseFlight.startedAt) || new Date().toISOString(),
  };
}

function beginRetrievalFlightFromCurrentState(fallback) {
  retrievalDisplayMachine.flight = {
    active: true,
    ownerTabId: activeBrowserTabId || null,
    state: currentState || null,
    fallback: fallback || null,
    recoveryJob: null,
    signature: getStatePageSignature(currentState),
    characterId: getCurrentCharacterId(),
    sourceKind: getCurrentSourceKind(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function renderRetrievalFlightState() {
  const flight = getActiveRetrievalFlight();
  const state = flight && flight.state ? flight.state : currentState;
  if (state) {
    render(state);
    return;
  }
  renderRetrievalActivityPanel();
  renderCurrentPageCard();
  renderCurrentDetailsPanel();
}

function getCurrentLocalSavedItem() {
  const currentId = getCurrentCharacterId();
  if (!currentId) return null;
  const latest = latestSavedCharacter && idsMatch(latestSavedCharacter.id, currentId) ? latestSavedCharacter : null;
  if (latest) return latest;
  return (Array.isArray(retrievedList) ? retrievedList : []).find((item) => idsMatch(item && item.id, currentId)) || null;
}

function getCurrentPageTerminalSignature() {
  return getStatePageSignature(currentState);
}

function setCurrentPageTerminalState(state) {
  const root = state && typeof state === "object" ? state : {};
  dismissedCurrentPageStatusSignature = null;
  currentPageTerminalState = {
    signature: root.signature || getCurrentPageTerminalSignature(),
    title: root.title || "Done",
    message: root.message || "",
    tone: root.tone || "muted",
  };
}

function clearCurrentPageTerminalState() {
  currentPageTerminalState = null;
}

function getMatchingCurrentPageTerminalState() {
  if (!currentPageTerminalState) return null;
  const signature = getCurrentPageTerminalSignature();
  return currentPageTerminalState.signature === signature ? currentPageTerminalState : null;
}

function hasRetrievalActivity(retrieval) {
  const root = retrieval && typeof retrieval === "object" ? retrieval : null;
  return !!(
    root &&
    (root.running || root.summary || root.error || (Array.isArray(root.logs) && root.logs.length))
  );
}

function isSupportedCharacterState(state) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  const sourceKind = String(page.sourceKind || "").trim().toLowerCase();
  return !!(page.isCharacterPage && (sourceKind === "janitor" || sourceKind === "saucepan"));
}

function shouldAutoOpenRetrievalTab(state) {
  const root = state && typeof state === "object" ? state : {};
  const retrieval = root.retrieval && typeof root.retrieval === "object" ? root.retrieval : null;
  if (retrieval && retrieval.running) return false;
  const recoveryJob = getActiveRecoveryJob();
  if (recoveryJob && isJannyRecoveryJobActive(recoveryJob)) return false;
  return isSupportedCharacterState(root);
}

function maybeAutoOpenRetrievalTab(state) {
  if (!shouldAutoOpenRetrievalTab(state)) return false;
  if (activeMainTab !== "detected") setActiveMainTab("detected", { skipRefresh: true });
  return true;
}
