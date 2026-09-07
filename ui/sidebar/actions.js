function handleDetailSectionSelect(event) {
  const target = event.target && event.target.closest("[data-action='detail-section-select']");
  if (!target) return false;
  const group = target.closest("[data-section-group]");
  if (!group) return false;
  const selected = target.value;
  group.querySelectorAll("[data-section-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-section-panel") !== selected;
  });
  return true;
}

function handleRetrievePanelAction(target) {
  if (!target) return false;
  const action = target.getAttribute("data-action");
  if (action === "open-retrieved-detail") {
    const id = target.getAttribute("data-character-id");
    if (id) openRetrievedDetail(id, { resetTab: true });
    return true;
  }
  if (action === "open-datacat") {
    openDatacatUrlFromTarget(target);
    return true;
  }
  if (action === "detail-tab") {
    const tab = target.getAttribute("data-tab");
    if (tab) {
      retrievedDetailTab = tab;
      renderCurrentDetailsPanel();
    }
    return true;
  }
  if (action === "open-detail-creator") {
    openDetailCreatorFromRetrieved("details_panel");
    return true;
  }
  if (action === "refresh-creator-view") {
    refreshCreatorViewFromCurrentState("details_panel");
    return true;
  }
  if (action === "open-creator-character" || action === "retrieve-creator-character") {
    openCreatorCharacterSourcePage(target);
    return true;
  }
  if (action === "queue-creator-character") {
    queueCreatorCharacterFromTarget(target);
    return true;
  }
  if (action === "queue-creator-all") {
    queueCreatorItems(buildCreatorQueueItems(creatorDetailState && creatorDetailState.record));
    return true;
  }
  if (action === "set-upload-visibility") {
    setUploadVisibility(target.getAttribute("data-visibility"));
    return true;
  }
  if (action === "back-to-retrieved") {
    if (inspectionState.active) closeCharacterInspection();
    else clearCurrentDetailState();
    renderRetrievalActivityPanel();
    return true;
  }
  if (action === "retry-upload") {
    retryUploadFromTarget(target, "details_panel");
    return true;
  }
  if (action === "open-janny-recovery-tab") {
    sendJannyRecoveryActionFromTarget(target, action, "details_panel");
    return true;
  }
  if (action === "skip-janny-recovery") {
    sendJannyRecoveryActionFromTarget(target, action, "details_panel");
    return true;
  }
  return false;
}

function getPointerActionSignature(target) {
  if (!target || typeof target.getAttribute !== "function") return "";
  return [
    target.getAttribute("data-action") || "",
    target.getAttribute("data-source-kind") || "",
    target.getAttribute("data-character-id") || "",
    target.getAttribute("data-url") || "",
    target.getAttribute("data-title") || "",
    target.getAttribute("data-queue-item-id") || "",
    target.getAttribute("data-creator-id") || "",
    target.getAttribute("data-creator-handle") || "",
    target.getAttribute("data-creator-name") || "",
    target.getAttribute("data-creator-url") || "",
  ].join("|");
}

function shouldHandleRetrieveActionOnPointerDown(action) {
  return action === "open-creator-character" || action === "retrieve-creator-character" || action === "queue-creator-character" || action === "queue-creator-all";
}

function consumePointerHandledAction(event, target, source) {
  const signature = getPointerActionSignature(target);
  if (!signature || signature !== pointerHandledActionSignature) return false;
  if (Date.now() - pointerHandledActionAt > POINTER_ACTION_REPLAY_MS) return false;
  debugLog("click_skipped_after_pointerdown_action", {
    source,
    action: target && target.getAttribute("data-action"),
    signature,
  });
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  return true;
}

function handleRetrievePanelPointerDown(event, source) {
  const target = event.target && event.target.closest("[data-action]");
  if (!target) return;
  const action = target.getAttribute("data-action");
  if (!shouldHandleRetrieveActionOnPointerDown(action)) return;
  const signature = getPointerActionSignature(target);
  debugLog("pointerdown_action", { source, action, signature });
  if (!handleRetrievePanelAction(target)) return;
  pointerHandledActionAt = Date.now();
  pointerHandledActionSignature = signature;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
}

function openCurrentCreatorFromTarget(target, source) {
  const targetRequest = buildCreatorRequestFromTarget(target);
  const stateRequest = buildCurrentCreatorRequest();
  const request = targetRequest || stateRequest;
  const url = buildCreatorSourceUrl(request);
  debugLog("creator_link_click", {
    source,
    url,
    targetRequest,
    stateRequest,
    currentCreatorInfo: getCurrentCreatorInfo(),
  });
  if (url) {
    navigateSourcePageFromExtension(url, { reason: "current_creator_click" });
    return true;
  }
  debugLog("creator_link_no_url", {
    source,
    targetRequest,
    stateRequest,
    currentCreatorInfo: getCurrentCreatorInfo(),
    state: summarizeStateForDebug(currentState),
  });
  return true;
}

function handleCurrentPagePanelAction(target, source) {
  if (!target) return false;
  const action = target.getAttribute("data-action");
  if (action === "open-datacat-section") {
    const url = target.getAttribute("data-url");
    debugLog("datacat_section_click", { source, url });
    if (url) navigateActiveTab(url, { reason: "datacat_section_click" });
    return true;
  }
  if (action === "open-context-destination") {
    const url = target.getAttribute("data-url");
    debugLog("context_destination_click", { source, url });
    if (url) navigateActiveTab(url, { reason: "context_destination_click" });
    return true;
  }
  if (action === "open-datacat-settings") {
    chrome.tabs.create({ url: chrome.runtime.getURL("settings.html#connections") });
    return true;
  }
  if (action === "open-current-creator") {
    return openCurrentCreatorFromTarget(target, source);
  }
  if (action === "start-current-retrieval") {
    recordCompanionActivity("action", "pin", { surface: "retrieve" });
    prepareAndStartActiveRetrieval(false);
    return true;
  }
  if (action === "pin-local-existing") {
    recordCompanionActivity("action", "pin", { surface: "retrieve" });
    uploadCurrentLocalCaptureToDatacat();
    return true;
  }
  if (action === "retrieve-again-existing") {
    recordCompanionActivity("action", "pin", { surface: "retrieve" });
    prepareAndStartActiveRetrieval({ forceRetrieve: true, localOnly: true });
    return true;
  }
  if (action === "save-local-existing") {
    prepareAndStartActiveRetrieval({ forceRetrieve: true, localOnly: true });
    return true;
  }
  if (action === "view-existing-datacat") {
    recordCompanionActivity("action", "open_datacat", { surface: "retrieve" });
    openCurrentDatacatView("current_page_button");
    return true;
  }
  if (action === "open-current-datacat-reimagination") {
    recordCompanionActivity("action", "open_datacat", { surface: "retrieve" });
    openCurrentDatacatView("current_page_reimagination", { section: "reimagination" });
    return true;
  }
  if (action === "open-current-local-details") {
    const item = getCurrentLocalSavedItem();
    if (item && item.id) {
      openRetrievedDetail(item.id, { resetTab: true, origin: "retrieve" });
    }
    return true;
  }
  if (action === "open-queue-item") {
    queueOverlayExpanded = true;
    renderActiveRetrievalIndicator();
    return true;
  }
  if (action === "set-upload-visibility") {
    setUploadVisibility(target.getAttribute("data-visibility"));
    return true;
  }
  if (action === "open-janny-recovery-tab" || action === "skip-janny-recovery") {
    return handleRetrievePanelAction(target);
  }
  return false;
}

function shouldHandleCurrentPageActionOnPointerDown(action) {
  return [
    "open-datacat-section",
    "open-context-destination",
    "open-datacat-settings",
    "open-current-creator",
    "start-current-retrieval",
    "pin-local-existing",
    "retrieve-again-existing",
    "save-local-existing",
    "view-existing-datacat",
    "open-current-datacat-reimagination",
    "open-current-local-details",
    "open-queue-item",
    "set-upload-visibility",
    "open-janny-recovery-tab",
    "skip-janny-recovery",
  ].includes(action);
}

function handleCurrentPagePanelPointerDown(event, source = "current_page_pointerdown") {
  if (event.button != null && event.button !== 0) return;
  const target = event.target && event.target.closest("[data-action]");
  if (!target) return;
  const action = target.getAttribute("data-action");
  if (!shouldHandleCurrentPageActionOnPointerDown(action)) return;
  const signature = getPointerActionSignature(target);
  debugLog("current_page_pointerdown_action", { source, action, signature });
  if (!handleCurrentPagePanelAction(target, source)) return;
  pointerHandledActionAt = Date.now();
  pointerHandledActionSignature = signature;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
}

function handleAccountGatePanelAction(target, source = "account_gate_click") {
  const action = target && target.getAttribute("data-action");
  if (action === "review-source-account") {
    openSourceAccountReviewDialog();
    return true;
  }
  if (action === "manage-source-accounts") {
    openSourceAccountSettings();
    return true;
  }
  if (action === "source-relogin") {
    const gate = getCurrentSourceAccountGate();
    debugLog("source_relogin_click", {
      source,
      sourceKind: gate.sourceKind || getCurrentSourceKind(),
      reason: gate.reason || null,
    });
    openSourceLogin(gate.sourceKind || getCurrentSourceKind());
    return true;
  }
  return false;
}

function shouldHandleAccountGateActionOnPointerDown(action) {
  return [
    "review-source-account",
    "manage-source-accounts",
    "source-relogin",
  ].includes(action);
}

function handleAccountGatePanelPointerDown(event, source = "account_gate_pointerdown") {
  if (event.button != null && event.button !== 0) return;
  const target = event.target && event.target.closest("[data-action]");
  if (!target) return;
  const action = target.getAttribute("data-action");
  if (!shouldHandleAccountGateActionOnPointerDown(action)) return;
  const signature = getPointerActionSignature(target);
  debugLog("account_gate_pointerdown_action", { source, action, signature });
  if (!handleAccountGatePanelAction(target, source)) return;
  pointerHandledActionAt = Date.now();
  pointerHandledActionSignature = signature;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
}
