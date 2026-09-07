function openRetrievedDetail(characterId, options = {}) {
  if (options.auto !== true) recordCompanionActivity("surface", "details", { surface: "details" });
  if (options.auto && retrievedDetailItem && idsMatch(retrievedDetailItem.id, characterId)) {
    debugLog("auto_character_detail_skip_existing", { characterId });
    return;
  }
  const automatic = options.auto === true;
  const loadingToken = automatic
    ? beginCurrentDetailsLoading()
    : { seq: ++currentInspectionOpenSeq, startedAt: Date.now() };
  if (!automatic) {
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.OPEN_INSPECTION,
      kind: "character",
      characterId,
      origin: options.origin || "activity",
    });
  }
  const listedItem = (Array.isArray(retrievedList) ? retrievedList : [])
    .find((item) => item && idsMatch(item.id, characterId));
  const sourceKind = normalizeSourceKind(
    options.sourceKind || listedItem && listedItem.summary && listedItem.summary.sourceKind,
  );
  if (automatic || !isCurrentCreatorPage()) {
    currentCreatorOpenSeq += 1;
    updateCreatorDetailState({ active: false, phase: null });
  }
  if (!automatic) retrievedDetailItem = null;
  setActiveMainTab("detected", { skipRefresh: true });
  if (!automatic) {
    renderCurrentDetailsMessage({
      kicker: "Details",
      title: "Loading details...",
      message: "Reading pinned character details.",
      loading: true,
    });
  }
  chrome.runtime.sendMessage(
    { type: MessageTypes.SV_GET_RETRIEVED_CHARACTER, characterId, sourceKind },
    (response) => {
      const runtimeError = chrome.runtime.lastError && chrome.runtime.lastError.message;
      const settle = automatic
        ? Promise.resolve(loadingToken.seq === currentDetailsLoadingSeq)
        : delay(Math.max(0, DETAILS_LOADING_MIN_DWELL_MS - (Date.now() - loadingToken.startedAt))).then(() => (
          loadingToken.seq === currentInspectionOpenSeq &&
          inspectionState.active &&
          idsMatch(inspectionState.characterId, characterId)
        ));
      settle.then((isActive) => {
        if (!isActive) return;
        if (runtimeError || !response || !response.ok || !response.item) {
          const error =
            runtimeError ||
            (response && response.error) ||
            "Could not open pinned character.";
          retrievedDetailItem = null;
          if (automatic) {
            currentDetailsMessageState = null;
            renderCurrentDetailsPanel();
            debugLog("auto_character_detail_failed", { characterId, error });
            return;
          }
          renderCurrentDetailsMessage({
            kicker: "Details",
            title: "Character unavailable",
            message: error,
            tone: "danger",
            actionsHtml: `<button class="mini-button" data-action="back-to-retrieved">Close</button>`,
          });
          return;
        }
        retrievedDetailItem = response.item;
        if (options.resetTab) {
          retrievedDetailTab = getDefaultDetailTabForItem(response.item);
        }
        renderCurrentDetailsPanel();
      });
    },
  );
}

function closeCharacterInspection() {
  currentInspectionOpenSeq += 1;
  dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.CLOSE_INSPECTION });
  retrievedDetailItem = null;
  currentDetailsMessageState = null;
  renderCurrentDetailsPanel();
  maybeAutoOpenCurrentCreatorView();
  maybeAutoOpenCurrentCharacterDetail();
}

function openCreatorView(request, options = {}) {
  const creatorRequest = request && typeof request === "object" ? request : null;
  if (!creatorRequest) return;
  recordCompanionActivity("surface", "creator", {
    surface: "creator",
    sourceKind: creatorRequest.sourceKind,
  });
  const loadingToken = options.loadingToken || beginCurrentDetailsLoading();
  retrievedDetailItem = null;
  updateCreatorDetailState({
    active: true,
    loading: true,
    error: null,
    record: options.cachedRecord || null,
    freshness: options.freshness || null,
    request: creatorRequest,
    phase: "Checking creator details...",
  });
  setActiveMainTab("detected", { skipRefresh: true });
  clearCurrentPageTerminalState();
  renderCurrentPageCard();
  renderCurrentDetailsPanel();
  chrome.runtime.sendMessage({
    type: MessageTypes.SV2_OPEN_CREATOR_VIEW,
    creator: creatorRequest,
    force: options.force === true,
  }, (response) => {
    const runtimeError = chrome.runtime.lastError && chrome.runtime.lastError.message;
    waitForCurrentDetailsLoadingDwell(loadingToken).then((isActive) => {
      if (!isActive) return;
      if (!isCreatorRequestCurrentPage(creatorRequest)) return;
      if (runtimeError || !response || !response.ok) {
        updateCreatorDetailState({
          active: true,
          loading: false,
          error:
            runtimeError ||
            (response && response.error) ||
            "Could not load creator.",
          phase: null,
        });
        if (response && response.accountApproval) requestSourceAccountApprovals();
        setCurrentPageTerminalState({
          title: "Failed",
          message:
            runtimeError ||
            (response && response.error) ||
            "Could not load creator.",
          tone: "failed",
        });
        renderCurrentPageCard();
        renderCurrentDetailsPanel();
        return;
      }
      updateCreatorDetailState({
        active: true,
        loading: false,
        error: null,
        record: response.record || null,
        freshness: response.freshness || null,
        request: creatorRequest,
        phase: null,
      });
      if (response && response.cached !== true) {
        setCurrentPageTerminalState({
          title: "Creator ready",
          message: "Creator capture finished.",
          tone: "completed",
        });
      } else {
        clearCurrentPageTerminalState();
      }
      renderCurrentPageCard();
      renderCurrentDetailsPanel();
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function refreshActiveTabStateForCreator(forceAuth) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: MessageTypes.SV_REFRESH_ACTIVE_TAB, tabId: activeBrowserTabId, force: false, forceAuth: forceAuth === true }, (response) => {
      if (!chrome.runtime.lastError && response && response.state) {
        applyIncomingState(activeBrowserTabId, response.state);
        resolve({ ok: true, state: response.state, request: buildCurrentCreatorRequest() });
        return;
      }
      resolve({
        ok: false,
        error:
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not refresh current source page.",
        request: buildCurrentCreatorRequest(),
      });
    });
  });
}

async function resolveCurrentCreatorRequest(seq) {
  const existingRequest = buildCurrentCreatorRequest();
  if (existingRequest) return existingRequest;
  await delay(150);
  if (seq !== currentCreatorOpenSeq) return null;
  const settledRequest = buildCurrentCreatorRequest();
  if (settledRequest) return settledRequest;
  const result = await refreshActiveTabStateForCreator(false);
  if (seq !== currentCreatorOpenSeq) return null;
  if (result && result.request) return result.request;
  if (result && result.error) {
    updateCreatorDetailState({
      error: result.error,
    });
  }
  return null;
}

function openCurrentCreatorView(options = {}) {
  const seq = ++currentCreatorOpenSeq;
  const loadingToken = beginCurrentDetailsLoading();
  const creator = getCurrentCreatorInfo();
  const placeholderRequest = {
    sourceKind: creator.sourceKind || getCurrentSourceKind() || "janitor",
    creatorId: null,
    creatorHandle: null,
    creatorName: creator.creatorName || "Creator",
    url: creator.profileUrl || null,
  };
  retrievedDetailItem = null;
  updateCreatorDetailState({
    active: true,
    loading: true,
    error: null,
    record: null,
    freshness: null,
    request: placeholderRequest,
    phase: "Checking source page...",
  });
  setActiveMainTab("detected", { skipRefresh: true });
  clearCurrentPageTerminalState();
  renderCurrentPageCard();
  renderCurrentDetailsPanel();
  resolveCurrentCreatorRequest(seq).then((request) => {
    if (seq !== currentCreatorOpenSeq) return;
    if (request) {
      openCreatorView(request, { ...options, loadingToken });
      return;
    }
    waitForCurrentDetailsLoadingDwell(loadingToken).then((isActive) => {
      if (!isActive || seq !== currentCreatorOpenSeq) return;
      updateCreatorDetailState({
        active: true,
        loading: false,
        error: "Creator id or handle is not available from this page yet. Refresh the source page and try again.",
        phase: null,
      });
      setCurrentPageTerminalState({
        title: "Failed",
        message: creatorDetailState.error,
        tone: "failed",
      });
      renderCurrentPageCard();
      renderCurrentDetailsPanel();
    });
  }, (error) => {
    if (seq !== currentCreatorOpenSeq) return;
    waitForCurrentDetailsLoadingDwell(loadingToken).then((isActive) => {
      if (!isActive || seq !== currentCreatorOpenSeq) return;
      updateCreatorDetailState({
        active: true,
        loading: false,
        error: String(error && error.message ? error.message : error || "Could not load creator."),
        phase: null,
      });
      setCurrentPageTerminalState({
        title: "Failed",
        message: creatorDetailState.error,
        tone: "failed",
      });
      renderCurrentPageCard();
      renderCurrentDetailsPanel();
    });
  });
}

currentPageTab.addEventListener("click", () => {
  setActiveMainTab("detected");
});

charactersTab.addEventListener("click", () => {
  const retrieval = currentState && currentState.retrieval && typeof currentState.retrieval === "object" ? currentState.retrieval : null;
  if (retrieval && retrieval.running !== true && hasRetrievalActivity(retrieval)) {
    dismissedCurrentPageStatusSignature = getCurrentPageTerminalSignature();
  }
  clearCurrentPageTerminalState();
  renderCurrentPageCard();
  setActiveMainTab("recent");
});

if (activeRetrievalIndicator) {
  activeRetrievalIndicator.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    const action = target.getAttribute("data-action");
    if (action === "toggle-queue-overlay") {
      queueOverlayExpanded = !queueOverlayExpanded;
      renderActiveRetrievalIndicator();
      return;
    }
    if (action === "queue-add-urls") {
      openQueueUrlDialog();
      return;
    }
    if (action === "queue-link-datacat") {
      openDatacatBridgeFromSidebar();
      return;
    }
    if (action === "queue-start") {
      if (!requireDatacatLinkForAction()) return;
      recordCompanionActivity("action", "queue_start", { surface: activeMainTab === "recent" ? "activity" : "retrieve" });
      sendQueueCommand(MessageTypes.SV2_QUEUE_START);
      return;
    }
    if (action === "queue-stop") {
      recordCompanionActivity("action", "queue_stop", { surface: activeMainTab === "recent" ? "activity" : "retrieve" });
      sendQueueCommand(MessageTypes.SV2_QUEUE_STOP);
      return;
    }
    if (action === "queue-clear-all") {
      if (!window.confirm("Clear every item from the retrieval queue?")) return;
      optimisticQueueItems = [];
      renderCurrentDetailsPanel();
      renderActiveRetrievalIndicator();
      sendQueueCommand(MessageTypes.SV2_QUEUE_CLEAR_ALL);
      return;
    }
    if (action === "queue-remove-item") {
      const queueItemId = target.getAttribute("data-queue-item-id") || null;
      const queueKey = target.getAttribute("data-queue-key") || null;
      if (queueKey) {
        optimisticQueueItems = optimisticQueueItems.filter((item) => getQueueItemIdentity(item) !== queueKey);
        renderCurrentDetailsPanel();
        renderActiveRetrievalIndicator();
      }
      sendQueueCommand(MessageTypes.SV2_QUEUE_REMOVE_ITEM, { queueItemId, queueKey });
      return;
    }
    if (action === "open-janny-recovery-tab" || action === "skip-janny-recovery") {
      sendJannyRecoveryActionFromTarget(target, action, "queue_overlay");
    }
  });
}

if (queueUrlInput) queueUrlInput.addEventListener("input", updateQueueUrlPreview);
if (queueAddSubmit) queueAddSubmit.addEventListener("click", submitQueueUrls);
if (creatorQueueConfirmSubmit) creatorQueueConfirmSubmit.addEventListener("click", confirmPendingCreatorQueueItems);
if (creatorQueueConfirmDialog) {
  creatorQueueConfirmDialog.addEventListener("close", () => {
    if (creatorQueueConfirmDialog.returnValue !== "default") pendingCreatorQueueItems = [];
  });
}

refreshButton.addEventListener("click", () => {
  refreshButton.disabled = true;
  refreshButton.textContent = "…";
  clearCurrentPageTerminalState();
  renderCurrentPageCard();
  announcementState.requestKey = null;
  maybeRequestSourceAnnouncement({ force: true });
  chrome.runtime.sendMessage({ type: MessageTypes.SV_REFRESH_ACTIVE_TAB, tabId: activeBrowserTabId, force: true, forceAuth: true }, (response) => {
    let refreshHadError = false;
    if (chrome.runtime.lastError || !response || response.ok === false) {
      refreshHadError = true;
      const error =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Could not refresh the active source tab.";
      if (summaryLine) summaryLine.textContent = error;
      retrievedError = error;
      renderRetrievedPanel();
    } else if (response.state) {
      applyIncomingState(activeBrowserTabId, response.state);
    } else {
      requestState({ force: true });
    }
    requestRetrievedCharacters();
    setTimeout(() => {
      refreshButton.disabled = false;
      refreshButton.textContent = "↻";
      if (!refreshHadError) requestState({ force: true });
    }, 350);
  });
});

if (settingsButton) {
  settingsButton.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  });
}

function uploadCurrentLocalCaptureToDatacat() {
  const item = getCurrentLocalSavedItem();
  const characterId = item && item.id;
  if (!characterId) {
    setCurrentPageTerminalState({
      title: "Pin blocked",
      message: "The saved local copy could not be found.",
      tone: "failed",
    });
    renderCurrentPageCard();
    return;
  }
  const summary = item.summary && typeof item.summary === "object" ? item.summary : {};
  const options = buildRetrievalOptions({
    forceRetrieve: false,
    localOnly: false,
  });
  setCurrentPageTerminalState({
    title: "Pinning",
    message: "Saving the local copy to Datacat.",
    tone: "running",
  });
  renderCurrentPageCard();
  chrome.runtime.sendMessage({
    type: MessageTypes.SV2_RETRY_UPLOAD,
    characterId,
    sourceKind: summary.sourceKind || getCurrentSourceKind(),
    options,
  }, (response) => {
    const error =
      (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
      (response && response.error) ||
      null;
    if (error || !response || response.ok === false) {
      setCurrentPageTerminalState({
        title: "Pin failed",
        message: error || "The local copy could not be saved to Datacat.",
        tone: "failed",
      });
    } else {
      setCurrentPageTerminalState({
        title: "Pinned",
        message: "The saved local copy is now on Datacat.",
        tone: "ok",
      });
      preflightKey = null;
      preflightError = null;
      preflightLoading = false;
      maybeRequestPreflight();
    }
    requestRetrievedCharacters();
    renderCurrentPageCard();
  });
}

function prepareAndStartActiveRetrieval(options = {}) {
  const retrievalOptions = typeof options === "object" && options !== null
    ? options
    : { forceRetrieve: options === true };
  const seq = ++pendingRetrievalStartSeq;
  debugLog("retrieval_click", {
    options: retrievalOptions,
    canAttempt: canAttemptCurrentPageRetrieval(),
    canRetrieve: canRetrieveCurrentPage(),
    transactionActive: isCurrentPageTransactionActive(),
    state: summarizeStateForDebug(currentState),
  });
  if (isCurrentPageTransactionActive()) {
    debugLog("retrieval_click_blocked_transaction_active", {
      options: retrievalOptions,
      upload: getCurrentTransactionUpload(),
      state: summarizeStateForDebug(currentState),
    });
    renderUploadOptionsPanel();
    renderCurrentPageCard();
    return;
  }
  if (
    retrievalOptions.forceRetrieve !== true &&
    retrievalOptions.localOnly !== true &&
    isCurrentDatacatPreflightBlockingControls()
  ) {
    debugLog("retrieval_click_blocked_preflight_pending", {
      options: retrievalOptions,
      preflightLoading,
      preflightError,
      preflightKey,
      state: summarizeStateForDebug(currentState),
    });
    setCurrentPageTerminalState({
      title: preflightError ? "Datacat check failed" : "Checking Datacat",
      message: preflightError || "Checking whether this character is already on Datacat.",
      tone: preflightError ? "failed" : "running",
    });
    renderUploadOptionsPanel();
    renderCurrentPageCard();
    maybeRequestPreflight();
    return;
  }
  if (!canAttemptCurrentPageRetrieval()) {
    const message = getCurrentRetrievalBlockedMessage();
    debugLog("retrieval_click_blocked_before_refresh", { message });
    setCurrentPageTerminalState({
      title: "Pin blocked",
      message,
      tone: "failed",
    });
    renderCurrentPageCard();
    return;
  }
  if (canRetrieveCurrentPage()) {
    startActiveRetrieval(retrievalOptions);
    return;
  }
  setCurrentPageTerminalState({
    title: "Checking",
    message: "Checking source session before pinning.",
    tone: "running",
  });
  renderCurrentPageCard();
  debugLog("retrieval_prepare_refresh_sent", { seq, options: retrievalOptions });
  chrome.runtime.sendMessage({ type: MessageTypes.SV_REFRESH_ACTIVE_TAB, tabId: activeBrowserTabId, force: true, forceAuth: true }, (response) => {
    const runtimeError = chrome.runtime.lastError && chrome.runtime.lastError.message;
    debugLog("retrieval_prepare_refresh_response", {
      seq,
      stale: seq !== pendingRetrievalStartSeq,
      runtimeError,
      ok: response && response.ok !== false,
      state: summarizeStateForDebug(response && response.state),
    });
    if (seq !== pendingRetrievalStartSeq) return;
    if (response && response.state) {
      applyIncomingState(activeBrowserTabId, response.state);
    }
    if (runtimeError || !response || response.ok === false) {
      const message = runtimeError || (response && response.error) || "Could not refresh the active source tab.";
      setCurrentPageTerminalState({
        title: "Pin blocked",
        message,
        tone: "failed",
      });
      renderCurrentPageCard();
      return;
    }
    if (canRetrieveCurrentPage()) {
      startActiveRetrieval(retrievalOptions);
      return;
    }
    const message = getCurrentRetrievalBlockedMessage();
    debugLog("retrieval_click_blocked_after_refresh", { message });
    setCurrentPageTerminalState({
      title: "Pin blocked",
      message,
      tone: "failed",
    });
    renderCurrentPageCard();
  });
}

function startActiveRetrieval(options = {}) {
  const retrievalOptions = typeof options === "object" && options !== null
    ? options
    : { forceRetrieve: options === true };
  const forceRetrieve = retrievalOptions.forceRetrieve === true;
  const localOnly = retrievalOptions.localOnly === true;
  const gate = getCurrentSourceAccountGate();
  if (!gate.allowed) {
    const message = getCurrentRetrievalBlockedMessage();
    debugLog("retrieval_start_blocked_gate", { message, gate });
    setCurrentPageTerminalState({
      title: "Pin blocked",
      message,
      tone: "failed",
    });
    renderAccountGatePanel();
    updateRetrieveActions(canRetrieveCurrentPage());
    renderCurrentPageCard();
    return;
  }
  debugLog("retrieval_start_message_sent", {
    options: retrievalOptions,
    characterId: getCurrentCharacterId(),
    sourceKind: getCurrentSourceKind(),
  });
  updateCreatorDetailState({ active: false, phase: null });
  queueLoading = true;
  queueError = null;
  expandedRecentId = null;
  currentDetailsLoadingSeq += 1;
  currentCreatorOpenSeq += 1;
  autoCharacterDetailOpenKey = null;
  retrievedDetailItem = null;
  currentDetailsMessageState = null;
  clearCurrentPageTerminalState();
  retrievedLoading = false;
  retrievedError = null;
  const optimisticActiveItems = [{
    sourceKind: getCurrentSourceKind(),
    characterId: getCurrentCharacterId(),
    title: currentState && currentState.character && currentState.character.name || null,
    url: currentState && currentState.page && (currentState.page.normalizedUrl || currentState.page.url) || null,
    origin: "current_page",
  }];
  addOptimisticQueueItems(optimisticActiveItems);
  renderRetrievalActivityPanel();
  renderCurrentPageCard();
  renderCurrentDetailsPanel();
  renderRetrievedPanel();
  retrieveButton.disabled = true;
  if (retrieveAgainLink) retrieveAgainLink.disabled = true;
  chrome.runtime.sendMessage({
    type: MessageTypes.SV_START_ACTIVE_TAB_RETRIEVAL,
    tabId: activeBrowserTabId,
    windowId: panelWindowId,
    options: buildRetrievalOptions({ forceRetrieve, localOnly }),
  }, (response) => {
    queueLoading = false;
    debugLog("retrieval_start_response", {
      runtimeError: chrome.runtime.lastError && chrome.runtime.lastError.message,
      ok: response && response.ok !== false,
      error: response && response.error || null,
      accountApproval: response && response.accountApproval || null,
    });
    if (chrome.runtime.lastError || !response || response.ok === false) {
      reconcileOptimisticQueueItems(null, optimisticActiveItems, true);
      const error =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Pin could not be queued.";
      if (response && response.accountApproval) {
        requestSourceAccountApprovals();
      }
      queueError = error;
      setCurrentPageTerminalState({
        title: "Failed",
        message: error,
        tone: "failed",
      });
      renderCurrentPageCard();
      renderRetrievedPanel();
      return;
    }
    if (response.queue) {
      reconcileOptimisticQueueItems(response.queue, optimisticActiveItems, true);
      dispatchSidebar({
        type: SourceVaultSidebarStore.ActionTypes.QUEUE_UPDATED,
        queue: response.queue,
      });
    }
    renderRetrievedPanel();
    renderActiveRetrievalIndicator();
    renderCurrentDetailsPanel();
    requestRetrievedCharacters();
  });
}

function openCreatorCharacterSourcePage(target) {
  const sourceKind = normalizeSourceKind(target && target.getAttribute("data-source-kind")) || "janitor";
  const characterId = target && target.getAttribute("data-character-id");
  const url = target && target.getAttribute("data-url");
  const title = target && target.getAttribute("data-title");
  const targetUrl = url || buildCreatorCharacterSourceUrl(sourceKind, {
    id: characterId,
    characterId,
    companionId: characterId,
    title,
    name: title,
  });
  debugLog("creator_character_link_click", { sourceKind, characterId, title, url, targetUrl });
  if (targetUrl) {
    navigateSourcePageFromExtension(targetUrl, { reason: "creator_character_click" });
  } else {
    debugLog("creator_character_link_no_url", { sourceKind, characterId, title, url });
  }
}

retrieveButton.addEventListener("click", () => {
  if (isCurrentCreatorPage()) {
    openCurrentCreatorView();
    return;
  }
  if (hasExistingAccessibleCharacter() && isCurrentDatacatCharacterOwned()) {
    openCurrentDatacatView("retrieve_button_existing");
    return;
  }
  prepareAndStartActiveRetrieval(false);
});

if (retrieveAgainLink) {
  retrieveAgainLink.addEventListener("click", () => {
    prepareAndStartActiveRetrieval(true);
  });
}

captureButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: MessageTypes.SV_GET_ACTIVE_TAB_CAPTURE }, (response) => {
    if (chrome.runtime.lastError || !response || !response.capture) {
      captureText.hidden = false;
      captureText.value = "No capture payload is available in this tab.";
      return;
    }
    captureText.hidden = false;
    captureText.value = JSON.stringify(response.capture, null, 2);
  });
});

if (latestSavedPanel) {
  latestSavedPanel.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (target.getAttribute("data-action") !== "open-latest-saved") return;
    const id = target.getAttribute("data-character-id");
    if (id) {
      openCharactersTab(id);
    } else {
      debugLog("latest_saved_open_blocked_no_id", {});
    }
  });
}

retrievedPanel.addEventListener("change", (event) => {
  const target = event.target && event.target.closest("[data-action='detail-section-select']");
  if (!target) return;
  const group = target.closest("[data-section-group]");
  if (!group) return;
  const selected = target.value;
  group.querySelectorAll("[data-section-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-section-panel") !== selected;
  });
});

retrievedPanel.addEventListener("pointerdown", (event) => {
  handleRetrievePanelPointerDown(event, "recent_panel");
}, true);

retrievedPanel.addEventListener("click", (event) => {
  const target = event.target && event.target.closest("[data-action='open-datacat']");
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  openDatacatUrlFromTarget(target, {
    preserveActivity: true,
    activityId: target.getAttribute("data-recent-id"),
  });
}, true);

retrievedPanel.addEventListener("click", (event) => {
  const target = event.target && event.target.closest("[data-action]");
  if (!target) return;
  if (consumePointerHandledAction(event, target, "recent_panel")) return;
  const action = target.getAttribute("data-action");
  if (action === "load-more-activity") {
    loadMoreActivityRows();
    return;
  }
  if (action === "toggle-recent") {
    const id = target.getAttribute("data-recent-id");
    if (id) {
      expandedRecentId = expandedRecentId === id ? null : id;
      renderRetrievedPanel();
    }
    return;
  }
  if (action === "open-retrieved" || action === "open-retrieved-detail") {
    const id = target.getAttribute("data-character-id");
    if (id) openRetrievedDetail(id, { resetTab: true });
    return;
  }
  if (action === "open-datacat") {
    openDatacatUrlFromTarget(target);
    return;
  }
  if (action === "detail-tab") {
    const tab = target.getAttribute("data-tab");
    if (tab) {
      retrievedDetailTab = tab;
      renderRetrievedPanel();
    }
    return;
  }
  if (action === "open-detail-creator") {
    openDetailCreatorFromRetrieved("recent_panel");
    return;
  }
  if (action === "refresh-creator-view") {
    refreshCreatorViewFromCurrentState("recent_panel");
    return;
  }
  if (action === "open-creator-character" || action === "retrieve-creator-character") {
    openCreatorCharacterSourcePage(target);
    return;
  }
  if (action === "queue-creator-character") {
    queueCreatorCharacterFromTarget(target);
    return;
  }
  if (action === "retry-activity-item") {
    queueActivityItemFromTarget(target);
    return;
  }
  if (action === "queue-creator-all") {
    queueCreatorItems(buildCreatorQueueItems(creatorDetailState && creatorDetailState.record));
    return;
  }
  if (action === "set-upload-visibility") {
    setUploadVisibility(target.getAttribute("data-visibility"));
    return;
  }
  if (action === "back-to-retrieved") {
    if (inspectionState.active) closeCharacterInspection();
    else clearCurrentDetailState();
    renderRetrievedPanel();
    return;
  }
  if (action === "retry-upload") {
    retryUploadFromTarget(target, "recent_panel");
    return;
  }
  if (action === "open-janny-recovery-tab") {
    sendJannyRecoveryActionFromTarget(target, action, "recent_panel");
    return;
  }
  if (action === "skip-janny-recovery") {
    sendJannyRecoveryActionFromTarget(target, action, "recent_panel");
  }
});

if (activitySearchInput) {
  activitySearchInput.addEventListener("input", () => {
    activitySearchQuery = activitySearchInput.value || "";
    activityVisibleLimit = ACTIVITY_PAGE_SIZE;
    expandedRecentId = null;
    renderRetrievedPanel();
  });
}

if (activitySourceFilter) {
  activitySourceFilter.addEventListener("change", () => {
    activitySourceFilterValue = activitySourceFilter.value || "all";
    activityVisibleLimit = ACTIVITY_PAGE_SIZE;
    expandedRecentId = null;
    renderRetrievedPanel();
  });
}

if (sidebarScrollRegion) {
  sidebarScrollRegion.addEventListener("scroll", () => {
    if (activityScrollTicking) return;
    activityScrollTicking = true;
    window.requestAnimationFrame(() => {
      activityScrollTicking = false;
      maybeLoadMoreActivityRows();
    });
  }, { passive: true });
}
