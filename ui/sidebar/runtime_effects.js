const companionActivitySentAt = new Map();

function recordCompanionActivity(kind, name, options = {}) {
  const surface = options.surface || (activeMainTab === "recent" ? "activity" : "retrieve");
  const sourceKind = options.sourceKind || getCurrentSourceKind() || null;
  const key = `${kind}:${name}:${surface}:${sourceKind || "none"}`;
  const now = Date.now();
  const throttleMs = kind === "surface" ? 5 * 60 * 1000 : 1500;
  if (now - Number(companionActivitySentAt.get(key) || 0) < throttleMs) return;
  companionActivitySentAt.set(key, now);
  chrome.runtime.sendMessage({
    type: MessageTypes.SV2_RECORD_COMPANION_ACTIVITY,
    activity: { kind, name, surface, sourceKind },
  }, () => void chrome.runtime.lastError);
}

function buildPreflightKey(body) {
  const root = body && typeof body === "object" ? body : {};
  return JSON.stringify({
    origin: datacatState && datacatState.origin ? datacatState.origin : "",
    sessionReady: datacatState && datacatState.sessionReady === true,
    sourceKind: root.sourceKind || "",
    characterId: root.characterId || "",
    creatorId: root.creatorId || null,
    creatorHandle: root.creatorHandle || null,
  });
}

function updatePreflightRequestedVisibility(preflight, visibility) {
  if (!preflight || typeof preflight !== "object") return preflight;
  const requestedVisibility = normalizeUploadVisibility(visibility);
  return {
    ...preflight,
    requestedVisibility,
    effectiveVisibility:
      preflight.visibilityForcedPrivate === true || preflight.privateVault === true
        ? "private"
        : requestedVisibility === "mine" ? "private" : "public",
  };
}

function requestState(options) {
  const opts = options && typeof options === "object" ? options : {};
  const requestSequence = ++pageStateCoordinator.requestSequence;
  const requestId = `state-${++debugSeq}`;
  debugLog("state_request_sent", {
    requestId,
    requestSequence,
    force: opts.force === true,
    forceAuth: opts.forceAuth === true,
    autoOpenRetrieval: opts.autoOpenRetrieval === true,
    pendingSourceNavigationUrl,
  });
  chrome.runtime.sendMessage({
    type: MessageTypes.SV_GET_ACTIVE_TAB_STATE,
    force: opts.force === true,
    forceAuth: opts.forceAuth === true,
    tabId: opts.tabId || null,
    windowId: panelWindowId,
  }, (response) => {
    if (chrome.runtime.lastError) {
      debugLog("state_request_error", {
        requestId,
        error: chrome.runtime.lastError.message,
        flightActive: isRetrievalFlightActive(),
        pendingSourceNavigationUrl,
      });
      if (isRetrievalFlightActive()) {
        renderRetrievalFlightState();
        return;
      }
      if (pendingSourceNavigationUrl || currentState) return;
      render(null);
      return;
    }
    const nextState = response && response.state ? response.state : null;
    debugLog("state_response_received", {
      requestId,
      requestSequence,
      tabId: response && response.tabId || null,
      hasState: !!nextState,
      state: summarizeStateForDebug(nextState),
    });
    if (!nextState && isRetrievalFlightActive()) {
      debugLog("state_response_uses_flight", { requestId });
      renderRetrievalFlightState();
      return;
    }
    if (pendingSourceNavigationUrl && !nextState) {
      debugLog("state_response_ignored_pending_no_state", { requestId, pendingSourceNavigationUrl });
      return;
    }
    if (
      nextState &&
      !acceptPendingSourceNavigationState(response && response.tabId, nextState, {
        channel: "state_response",
        requestId,
      })
    ) {
      debugLog("state_response_ignored_pending_mismatch", {
        requestId,
        pendingSourceNavigationUrl,
        state: summarizeStateForDebug(nextState),
      });
      return;
    }
    if (
      nextState &&
      isRetrievalFlightActive() &&
      !isRetrievalFlightOwnerTab(response && response.tabId) &&
      !hasRetrievalActivity(getStateRetrieval(nextState))
    ) {
      debugLog("state_response_preserves_flight_display", { requestId, tabId: response && response.tabId || null });
      retrievalDisplayMachine.focusState = nextState;
      renderRetrievalFlightState();
      return;
    }
    const accepted = applyIncomingState(response && response.tabId, nextState, { requestSequence });
    if (accepted && opts.autoOpenRetrieval === true) maybeAutoOpenRetrievalTab(nextState);
  });
}

function maybeRequestPreflight() {
  const body = buildPreflightBody();
  if (!body || !datacatState || !datacatState.sessionReady) {
    if (preflightState || preflightError || preflightLoading) {
      dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED, preflight: null });
      preflightError = null;
      preflightLoading = false;
      preflightKey = null;
      renderUploadOptionsPanel();
      renderPreflightStatus();
      renderCurrentPageCard();
      updateRetrieveActions(canRetrieveCurrentPage());
    }
    return;
  }
  const key = buildPreflightKey(body);
  if (preflightLoading && preflightKey === key) return;
  if (preflightLoading && preflightKey !== key) {
    preflightSeq += 1;
    preflightLoading = false;
  }
  if (preflightKey === key) return;
  preflightKey = key;
  preflightLoading = true;
  preflightError = null;
  renderUploadOptionsPanel();
  renderPreflightStatus();
  renderCurrentPageCard();
  const seq = ++preflightSeq;
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_PREFLIGHT_CHARACTER, body }, (response) => {
    if (seq !== preflightSeq) return;
    preflightLoading = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED, preflight: null });
      preflightError =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Datacat preflight failed.";
      if (response && response.state) {
        dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.DATACAT_STATE_UPDATED, state: response.state });
      }
      renderDatacatPanel();
      renderUploadOptionsPanel();
      renderPreflightStatus();
      renderCurrentPageCard();
      updateRetrieveActions(canRetrieveCurrentPage());
      return;
    }
    if (response.state) {
      dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.DATACAT_STATE_UPDATED, state: response.state });
    }
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED,
      preflight: updatePreflightRequestedVisibility(response.preflight || null, uploadVisibility),
    });
    preflightError = null;
    renderDatacatPanel();
    renderUploadOptionsPanel();
    renderPreflightStatus();
    renderCurrentPageCard();
    updateRetrieveActions(canRetrieveCurrentPage());
  });
}

function maybeRequestSourceAnnouncement(options = {}) {
  const sourceKind = getCurrentAnnouncementSourceKind();
  if (!sourceKind) {
    announcementState = {
      ...announcementState,
      sourceKind: null,
      visible: null,
      announcements: [],
      requestKey: null,
      loading: false,
      error: null,
    };
    return;
  }
  const requestKey = `${datacatState && datacatState.origin ? datacatState.origin : ""}:${sourceKind}`;
  const force = options.force === true;
  if (announcementState.loading && announcementState.requestKey === requestKey) return;
  if (!force && announcementState.requestKey === requestKey && !announcementState.error) return;
  announcementState = {
    ...announcementState,
    sourceKind,
    requestKey,
    loading: true,
    error: null,
    lastRequestedAt: Date.now(),
  };
  const seq = ++announcementState.seq;
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_GET_SOURCE_ANNOUNCEMENTS, sourceKind, force }, (response) => {
    if (seq !== announcementState.seq) return;
    announcementState.loading = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      announcementState.error =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "announcement_check_failed";
      announcementState.visible = null;
      announcementState.announcements = [];
      renderAnnouncementPanel();
      return;
    }
    announcementState.announcements = Array.isArray(response.announcements)
      ? response.announcements
      : response.announcement
        ? [response.announcement]
        : [];
    announcementState.visible = announcementState.announcements[0] || null;
    announcementState.error = null;
    renderAnnouncementPanel();
  });
}

function forceRefreshSourceAnnouncement() {
  if (document.hidden) return;
  announcementState.requestKey = null;
  maybeRequestSourceAnnouncement({ force: true });
}

function startAnnouncementRefreshLoop() {
  if (announcementRefreshTimer) return;
  announcementRefreshTimer = setInterval(forceRefreshSourceAnnouncement, ANNOUNCEMENT_REFRESH_MS);
}

function requestExtensionVersionStatus() {
  extensionVersionState.loading = false;
  extensionVersionState.updateAvailable = false;
  renderExtensionUpdateBanner();
}

function startExtensionVersionRefreshLoop() {}

function requestDatacatState(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const force = opts.force === true;
  const now = Date.now();
  if (datacatStateRequestInFlight && !force) {
    debugLog("datacat_state_request_skipped_inflight", {});
    return;
  }
  if (
    !force &&
    datacatStateLastSettledAt > 0 &&
    now - datacatStateLastSettledAt < DATACAT_STATE_REFRESH_MIN_MS
  ) {
    debugLog("datacat_state_request_skipped_fresh", {
      ageMs: now - datacatStateLastSettledAt,
    });
    maybeRequestPreflight();
    return;
  }
  const requestId = `datacat-${++debugSeq}`;
  const requestSeq = ++datacatStateRequestSeq;
  debugLog("datacat_state_request_sent", { requestId, force });
  datacatStateRequestInFlight = true;
  datacatLoading = true;
  datacatError = null;
  renderDatacatPanel();
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_GET_DATACAT_STATE }, (response) => {
    if (!SourceVaultSidebarStore.isCurrentRequestSequence(requestSeq, datacatStateRequestSeq)) {
      debugLog("datacat_state_response_stale", { requestId, requestSeq, currentRequestSeq: datacatStateRequestSeq });
      return;
    }
    datacatStateRequestInFlight = false;
    datacatStateLastSettledAt = Date.now();
    datacatLoading = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      datacatError =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Could not check Datacat.";
      debugLog("datacat_state_request_error", {
        requestId,
        force,
        error: datacatError,
      });
      renderDatacatPanel();
      renderPreflightStatus();
      renderCurrentPageCard();
      return;
    }
    if (response.state) {
      dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.DATACAT_STATE_UPDATED, state: response.state });
    }
    debugLog("datacat_state_response_received", {
      requestId,
      force,
      connected: datacatState.connected === true,
      authenticated: datacatState.authenticated === true,
      sessionReady: datacatState.sessionReady === true,
      canUpload: datacatState.canUpload === true,
    });
    renderDatacatPanel();
    renderPreflightStatus();
    renderCurrentPageCard();
    maybeRequestPreflight();
    announcementState.requestKey = null;
    maybeRequestSourceAnnouncement({ force: true });
  });
}

function requestUploadSettings() {
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_GET_UPLOAD_SETTINGS, windowId: panelWindowId }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok || !response.settings) {
      dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.UPLOAD_VISIBILITY_UPDATED, visibility: "public" });
      dispatchSidebar({
        type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED,
        preflight: updatePreflightRequestedVisibility(preflightState, uploadVisibility),
      });
      renderUploadOptionsPanel();
      renderPreflightStatus();
      renderCurrentPageCard();
      renderCurrentDetailsPanel();
      maybeRequestPreflight();
      return;
    }
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.UPLOAD_VISIBILITY_UPDATED,
      visibility: normalizeUploadVisibility(response.settings.visibility),
    });
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED,
      preflight: updatePreflightRequestedVisibility(preflightState, uploadVisibility),
    });
    renderSourceSessionLine();
    renderUploadOptionsPanel();
    renderPreflightStatus();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    maybeRequestPreflight();
  });
}

function requestSourceAccountApprovals() {
  const requestSeq = ++sourceAccountApprovalsRequestSeq;
  const decisionSeqAtStart = sourceAccountApprovalsDecisionSeq;
  sourceAccountApprovalsLoading = true;
  sourceAccountApprovalsError = null;
  renderAccountGatePanel();
  renderSourceSessionLine();
  renderCurrentPageCard();
  renderCurrentDetailsPanel();
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_GET_SOURCE_ACCOUNT_APPROVALS }, (response) => {
    if (!SourceVaultSidebarStore.shouldAcceptSourceAccountApprovalRead(
      requestSeq,
      sourceAccountApprovalsRequestSeq,
      decisionSeqAtStart,
      sourceAccountApprovalsDecisionSeq,
    )) {
      debugLog("source_account_approval_read_stale", { requestSeq, decisionSeqAtStart });
      return;
    }
    sourceAccountApprovalsLoading = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      sourceAccountApprovalsError =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Could not read source account decisions.";
      renderAccountGatePanel();
      renderSourceSessionLine();
      renderCurrentPageCard();
      renderCurrentDetailsPanel();
      updateRetrieveActions(canRetrieveCurrentPage());
      return;
    }
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.SOURCE_ACCOUNT_APPROVALS_UPDATED,
      approvals: response.approvals,
    });
    sourceAccountApprovalsError = null;
    renderAccountGatePanel();
    renderSourceSessionLine();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    updateRetrieveActions(canRetrieveCurrentPage());
    maybeAutoOpenCurrentCreatorView();
  });
}

function setSourceAccountApproval(state, target = null) {
  const targetAccount = target && target.account && typeof target.account === "object" ? target.account : null;
  const account = targetAccount || getCurrentSourceAccountIdentity();
  const sourceKind = normalizeSourceKind(
    target && target.sourceKind || account && account.sourceKind || getCurrentSourceKind(),
  );
  const normalizedState = normalizeSourceAccountApprovalState(state);
  if (!account || !sourceKind || !normalizedState) {
    debugLog("source_account_approval_blocked", { state, account, sourceKind, normalizedState });
    return;
  }
  debugLog("source_account_approval_sent", { state: normalizedState, account, sourceKind });
  sourceAccountApprovalsDecisionSeq += 1;
  sourceAccountApprovalsRequestSeq += 1;
  sourceAccountApprovalsLoading = true;
  sourceAccountApprovalsError = null;
  renderAccountGatePanel();
  renderSourceSessionLine();
  renderCurrentPageCard();
  renderCurrentDetailsPanel();
  chrome.runtime.sendMessage({
    type: MessageTypes.SV2_SET_SOURCE_ACCOUNT_APPROVAL,
    sourceKind,
    account,
    state: normalizedState,
  }, (response) => {
    sourceAccountApprovalsLoading = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      sourceAccountApprovalsError =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Could not save source account decision.";
      debugLog("source_account_approval_response", {
        ok: false,
        error: sourceAccountApprovalsError,
        account,
        sourceKind,
      });
      renderAccountGatePanel();
      renderSourceSessionLine();
      renderCurrentPageCard();
      renderCurrentDetailsPanel();
      updateRetrieveActions(canRetrieveCurrentPage());
      return;
    }
    if (response.approval && response.approval.key) {
      dispatchSidebar({
        type: SourceVaultSidebarStore.ActionTypes.SOURCE_ACCOUNT_APPROVALS_UPDATED,
        approvals: {
          ...(sourceAccountApprovals || {}),
          [response.approval.key]: response.approval,
        },
      });
    }
    debugLog("source_account_approval_response", {
      ok: true,
      approval: response.approval || null,
      account,
      sourceKind,
    });
    sourceAccountApprovalsError = null;
    renderAccountGatePanel();
    renderSourceSessionLine();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    updateRetrieveActions(canRetrieveCurrentPage());
    maybeAutoOpenCurrentCreatorView();
  });
}

function setUploadVisibility(visibility) {
  const nextVisibility = normalizeUploadVisibility(visibility);
  if (isCurrentPageTransactionActive()) {
    debugLog("upload_visibility_blocked_transaction_active", {
      visibility: nextVisibility,
      upload: getCurrentTransactionUpload(),
      state: summarizeStateForDebug(currentState),
    });
    renderSourceSessionLine();
    renderUploadOptionsPanel();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    return;
  }
  if (nextVisibility === uploadVisibility) {
    debugLog("upload_visibility_noop", { visibility: nextVisibility });
    renderSourceSessionLine();
    renderUploadOptionsPanel();
    renderPreflightStatus();
    renderCurrentDetailsPanel();
    return;
  }
  dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.UPLOAD_VISIBILITY_UPDATED, visibility: nextVisibility });
  recordCompanionActivity("action", "visibility_change", { surface: "retrieve" });
  debugLog("upload_visibility_changed", { visibility: uploadVisibility });
  dispatchSidebar({
    type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED,
    preflight: updatePreflightRequestedVisibility(preflightState, uploadVisibility),
  });
  renderSourceSessionLine();
  renderUploadOptionsPanel();
  renderPreflightStatus();
  renderCurrentPageCard();
  renderCurrentDetailsPanel();
  chrome.runtime.sendMessage({
    type: MessageTypes.SV2_SET_UPLOAD_VISIBILITY,
    visibility: uploadVisibility,
    windowId: panelWindowId,
  }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) return;
    const confirmedVisibility = normalizeUploadVisibility(response.settings && response.settings.visibility);
    if (confirmedVisibility !== uploadVisibility) {
      dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.UPLOAD_VISIBILITY_UPDATED, visibility: confirmedVisibility });
      dispatchSidebar({
        type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED,
        preflight: updatePreflightRequestedVisibility(preflightState, uploadVisibility),
      });
    }
    renderSourceSessionLine();
    renderUploadOptionsPanel();
    renderPreflightStatus();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
  });
}

function saveDatacatOrigin() {
  const input = document.getElementById("datacatOriginInput");
  const origin = input ? input.value : "";
  datacatStateRequestSeq += 1;
  datacatStateRequestInFlight = false;
  datacatLoading = true;
  datacatError = null;
  renderDatacatPanel();
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_SET_DATACAT_ORIGIN, origin }, (response) => {
    datacatLoading = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      datacatError =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Could not save Datacat target.";
      renderDatacatPanel();
      return;
    }
    if (response.state) {
      dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.DATACAT_STATE_UPDATED, state: response.state });
    }
    renderDatacatPanel();
    dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED, preflight: null });
    preflightError = null;
    preflightLoading = false;
    preflightKey = null;
    maybeRequestPreflight();
    requestRetrievedCharacters();
  });
}

function applyQueueResponse(response, options = {}) {
  queueLoading = false;
  if (chrome.runtime.lastError || !response || response.ok === false) {
    reconcileOptimisticQueueItems(null, options.attemptedItems, true);
    queueError =
      (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
      (response && response.error) ||
      "Could not update the retrieval queue.";
    renderRetrievedPanel();
    renderActiveRetrievalIndicator();
    renderCurrentDetailsPanel();
    return false;
  }
  if (response.queue) {
    reconcileOptimisticQueueItems(response.queue, options.attemptedItems, true);
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.QUEUE_UPDATED,
      queue: response.queue,
    });
  }
  queueError = null;
  renderRetrievedPanel();
  renderActiveRetrievalIndicator();
  renderCurrentDetailsPanel();
  return true;
}

function requestQueueState() {
  queueLoading = true;
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_QUEUE_GET_STATE }, (response) => {
    applyQueueResponse(response);
  });
}

function refreshActivityState() {
  requestQueueState();
  requestRetrievedCharacters();
}

function sendQueueCommand(type, fields = {}) {
  queueError = null;
  chrome.runtime.sendMessage({
    type,
    commandId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...fields,
  }, (response) => {
    applyQueueResponse(response);
  });
}

function requireDatacatLinkForAction() {
  if (datacatState && datacatState.sessionReady === true) return true;
  openDatacatBridgeFromSidebar();
  return false;
}

function openQueueUrlDialog() {
  if (!requireDatacatLinkForAction()) return;
  if (!queueAddDialog) return;
  if (queueUrlInput) queueUrlInput.value = "";
  updateQueueUrlPreview();
  if (typeof queueAddDialog.showModal === "function") queueAddDialog.showModal();
  else queueAddDialog.setAttribute("open", "");
  setTimeout(() => queueUrlInput && queueUrlInput.focus(), 0);
}

function getQueueUrlInputs() {
  const lines = String(queueUrlInput && queueUrlInput.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((url) => ({ url, origin: "url_list", visibility: uploadVisibility }));
}

function updateQueueUrlPreview() {
  if (!queueUrlPreview) return;
  const inputs = getQueueUrlInputs();
  const parsed = inputs.map((input) => SourceVaultQueue.parseCharacterUrl(input.url));
  const existingKeys = new Set([
    queueState && queueState.activeItem,
    ...(Array.isArray(queueState && queueState.pending) ? queueState.pending : []),
  ].filter(Boolean).map((item) => `${item.sourceKind}:${item.characterId}`));
  const seen = new Set();
  let valid = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const item of parsed) {
    if (!item.valid) {
      invalid += 1;
      continue;
    }
    const key = `${item.sourceKind}:${item.characterId}`;
    if (existingKeys.has(key) || seen.has(key)) duplicates += 1;
    else {
      seen.add(key);
      valid += 1;
    }
  }
  const capacity = Math.max(0, Number(SourceVaultQueue.MAX_OUTSTANDING_ITEMS || 100) - getQueueOutstandingCount());
  queueUrlPreview.textContent = compactMeta([
    `${valid} valid`,
    duplicates ? `${duplicates} already queued` : null,
    invalid ? `${invalid} unsupported` : null,
    `${capacity} queue slots available`,
  ]);
  if (queueAddSubmit) queueAddSubmit.disabled = valid < 1 || valid > capacity;
}

function submitQueueUrls() {
  if (!requireDatacatLinkForAction()) return;
  const inputs = getQueueUrlInputs();
  if (!inputs.length) return;
  queueLoading = true;
  addOptimisticQueueItems(inputs);
  chrome.runtime.sendMessage({
    type: MessageTypes.SV2_QUEUE_ADD_ITEMS,
    items: inputs,
    options: { visibility: uploadVisibility, origin: "url_list" },
  }, (response) => {
    if (applyQueueResponse(response, { attemptedItems: inputs })) {
      if (queueAddDialog && typeof queueAddDialog.close === "function") queueAddDialog.close();
    }
  });
}

function buildCreatorQueueItems(record) {
  const sourceKind = record && record.sourceKind === "saucepan" ? "saucepan" : "janitor";
  const author = record && record.summary && record.summary.name || null;
  return getUnsavedCreatorRecordCharacters(record).map((character) => ({
    sourceKind,
    characterId: character && (character.id || character.characterId || character.companionId || character.sourceId),
    url: buildCreatorCharacterSourceUrl(sourceKind, character),
    title: character && (character.name || character.title) || null,
    author,
    creatorId: record && record.creatorId || null,
    creatorHandle: record && record.creatorHandle || null,
    origin: "creator",
    visibility: uploadVisibility,
    forceRetrieve: true,
  }));
}

function planCreatorQueueItems(items) {
  const maxOutstanding = Number(SourceVaultQueue.MAX_OUTSTANDING_ITEMS || 100);
  const capacity = Math.max(0, maxOutstanding - getQueueOutstandingCount());
  const outstandingKeys = new Set([
    ...getConfirmedOutstandingQueueItems(),
    ...getEffectiveOptimisticQueueItems(),
  ].filter(Boolean).map(getQueueItemIdentity).filter(Boolean));
  const seen = new Set();
  const eligible = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.characterId || !item.url) continue;
    const key = getQueueItemIdentity(item);
    if (outstandingKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    eligible.push(item);
  }
  return { items: eligible.slice(0, capacity), eligibleCount: eligible.length, capacity, maxOutstanding };
}

function buildOptimisticQueueItem(item) {
  const sourceKind = normalizeSourceKind(item && item.sourceKind);
  const characterId = String(item && item.characterId || "").trim();
  if (!sourceKind || !characterId) return null;
  return {
    ...(item || {}),
    queueItemId: `optimistic:${sourceKind}:${characterId.toLowerCase()}`,
    sourceKind,
    characterId,
    state: "pending",
    publicPhase: "Waiting in queue",
    message: "Waiting in queue",
    enqueuedAt: new Date().toISOString(),
    optimistic: true,
  };
}

function addOptimisticQueueItems(items) {
  const existing = new Map((Array.isArray(optimisticQueueItems) ? optimisticQueueItems : [])
    .map((item) => [getQueueItemIdentity(item), item])
    .filter(([key]) => !!key));
  for (const item of Array.isArray(items) ? items : []) {
    const optimistic = buildOptimisticQueueItem(item);
    const key = getQueueItemIdentity(optimistic);
    if (key) existing.set(key, optimistic);
  }
  optimisticQueueItems = [...existing.values()];
  queueError = null;
  renderCurrentDetailsPanel();
  renderActiveRetrievalIndicator();
}

function reconcileOptimisticQueueItems(incomingQueue, attemptedItems = null, clearAttempted = false) {
  if (!optimisticQueueItems.length) return;
  const queue = incomingQueue && typeof incomingQueue === "object" ? incomingQueue : {};
  const control = queue.control && typeof queue.control === "object" ? queue.control : {};
  if (control.action === "clear_all") {
    optimisticQueueItems = [];
    return;
  }
  const removedKeys = new Set(Array.isArray(control.removedKeys) ? control.removedKeys.map(String) : []);
  if (removedKeys.size) {
    optimisticQueueItems = optimisticQueueItems.filter((item) => !removedKeys.has(getQueueItemIdentity(item)));
  }
  const confirmedKeys = new Set([
    queue.activeItem,
    ...(Array.isArray(queue.pending) ? queue.pending : []),
    ...(Array.isArray(queue.finished) ? queue.finished : []),
  ].map(getQueueItemIdentity).filter(Boolean));
  const attemptedKeys = new Set((Array.isArray(attemptedItems) ? attemptedItems : [])
    .map(getQueueItemIdentity)
    .filter(Boolean));
  optimisticQueueItems = optimisticQueueItems.filter((item) => {
    const key = getQueueItemIdentity(item);
    if (!key || confirmedKeys.has(key)) return false;
    if (clearAttempted && attemptedKeys.has(key)) return false;
    return true;
  });
}

function openCreatorQueueConfirmation(items) {
  const plan = planCreatorQueueItems(items);
  if (!plan.items.length) {
    queueError = plan.capacity < 1 ? "The queue already has 100 characters." : "These characters are already queued or saved.";
    renderCurrentDetailsPanel();
    renderRetrievedPanel();
    return;
  }
  pendingCreatorQueueItems = plan.items;
  if (creatorQueueConfirmMessage) {
    creatorQueueConfirmMessage.textContent = `This will add ${plan.items.length} character${plan.items.length === 1 ? "" : "s"} to the queue.`;
  }
  if (creatorQueueConfirmDialog && typeof creatorQueueConfirmDialog.showModal === "function") {
    creatorQueueConfirmDialog.showModal();
  } else if (creatorQueueConfirmDialog) {
    creatorQueueConfirmDialog.setAttribute("open", "");
  }
}

function queueCreatorItems(items, options = {}) {
  if (!requireDatacatLinkForAction()) return;
  const plan = planCreatorQueueItems(items);
  const validItems = plan.items;
  if (!validItems.length) return;
  if (validItems.length > 1 && options.confirmed !== true) {
    openCreatorQueueConfirmation(validItems);
    return;
  }
  queueLoading = true;
  addOptimisticQueueItems(validItems);
  const surface = options.surface || "creator";
  const origin = options.origin || surface;
  recordCompanionActivity("action", "queue_add", { surface });
  chrome.runtime.sendMessage({
    type: MessageTypes.SV2_QUEUE_ADD_ITEMS,
    items: validItems,
    options: { visibility: uploadVisibility, origin, forceRetrieve: true },
  }, (response) => {
    applyQueueResponse(response, { attemptedItems: validItems });
  });
}

function confirmPendingCreatorQueueItems() {
  const items = pendingCreatorQueueItems;
  pendingCreatorQueueItems = [];
  if (creatorQueueConfirmDialog && typeof creatorQueueConfirmDialog.close === "function") creatorQueueConfirmDialog.close();
  queueCreatorItems(items, { confirmed: true });
}

function queueCreatorCharacterFromTarget(target) {
  const sourceKind = normalizeSourceKind(target && target.getAttribute("data-source-kind")) || "janitor";
  const characterId = target && target.getAttribute("data-character-id");
  const title = target && target.getAttribute("data-title");
  const url = target && target.getAttribute("data-url") || buildCreatorCharacterSourceUrl(sourceKind, { id: characterId, name: title });
  queueCreatorItems([{
    sourceKind,
    characterId,
    url,
    title,
    author: target && target.getAttribute("data-author"),
    origin: "creator",
    visibility: uploadVisibility,
    forceRetrieve: true,
  }]);
}

function queueActivityItemFromTarget(target) {
  const sourceKind = normalizeSourceKind(target && target.getAttribute("data-source-kind")) || "janitor";
  const characterId = target && target.getAttribute("data-character-id");
  const title = target && target.getAttribute("data-title");
  const url = target && target.getAttribute("data-url") || buildCreatorCharacterSourceUrl(sourceKind, { id: characterId, name: title });
  queueCreatorItems([{
    sourceKind,
    characterId,
    url,
    title,
    author: target && target.getAttribute("data-author"),
    origin: "activity_retry",
    visibility: uploadVisibility,
    forceRetrieve: true,
  }], { confirmed: true, surface: "activity", origin: "activity_retry" });
}

function requestRetrievedCharacters() {
  retrievedLoading = true;
  retrievedError = null;
  renderRetrievedPanel();
  chrome.runtime.sendMessage({ type: MessageTypes.SV_GET_RETRIEVED_CHARACTERS }, (response) => {
    retrievedLoading = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      retrievedError =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Could not read pinned characters.";
      renderRetrievedPanel();
      return;
    }
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.RETRIEVED_LIST_LOADED,
      list: Array.isArray(response.list) ? response.list : [],
    });
    if (!latestSavedCharacter && retrievedList.length) {
      latestSavedCharacter = retrievedList[0];
    }
    renderLatestSavedPanel();
    renderRetrievalActivityPanel();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    renderRetrievedPanel();
    maybeAutoOpenCurrentCharacterDetail();
  });
}
