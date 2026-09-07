"use strict";

/* ui/sidebar/index.js — sidebar entry: DOM event wiring + broadcast handlers + boot.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

if (currentDetailsPanel) {
  currentDetailsPanel.addEventListener("change", (event) => {
    handleDetailSectionSelect(event);
  });
  currentDetailsPanel.addEventListener("pointerdown", (event) => {
    handleRetrievePanelPointerDown(event, "details_panel");
  }, true);
  currentDetailsPanel.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (consumePointerHandledAction(event, target, "details_panel")) return;
    if (handleRetrievePanelAction(target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

if (retrievalActivityPanel) {
  retrievalActivityPanel.addEventListener("pointerdown", (event) => {
    handleRetrievePanelPointerDown(event, "retrieval_activity_panel");
  }, true);
  retrievalActivityPanel.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (consumePointerHandledAction(event, target, "retrieval_activity_panel")) return;
    if (handleRetrievePanelAction(target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

if (preflightStatus) {
  preflightStatus.addEventListener("pointerdown", (event) => {
    handleCurrentPagePanelPointerDown(event, "preflight_status_pointerdown");
  }, true);
  preflightStatus.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (consumePointerHandledAction(event, target, "preflight_status")) return;
    if (handleCurrentPagePanelAction(target, "preflight_status_click")) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

if (announcementPanel) {
  announcementPanel.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (target.getAttribute("data-action") === "toggle-source-announcements") {
      announcementState.showAll = !announcementState.showAll;
      renderAnnouncementPanel();
      return;
    }
    if (target.getAttribute("data-action") !== "dismiss-source-announcement") return;
    const dismissKey = target.getAttribute("data-dismiss-key");
    const sourceKind = announcementState.sourceKind || getCurrentAnnouncementSourceKind();
    announcementState.announcements = (announcementState.announcements || []).filter((announcement) => {
      const key = String(announcement.clientDismissKey || announcement.dismissKey || announcement.id || "");
      return key !== String(dismissKey || "");
    });
    announcementState.visible = announcementState.announcements[0] || null;
    renderAnnouncementPanel();
    chrome.runtime.sendMessage({ type: MessageTypes.SV2_DISMISS_SOURCE_ANNOUNCEMENT, sourceKind, dismissKey }, () => {
      void chrome.runtime.lastError;
    });
  });
}

if (accountGatePanel) {
  accountGatePanel.addEventListener("pointerdown", (event) => {
    handleAccountGatePanelPointerDown(event, "account_gate_pointerdown");
  }, true);
  accountGatePanel.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (consumePointerHandledAction(event, target, "account_gate")) return;
    if (handleAccountGatePanelAction(target, "account_gate_click")) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

if (uploadVisibilityNav) {
  uploadVisibilityNav.addEventListener("pointerdown", (event) => {
    handleCurrentPagePanelPointerDown(event, "nav_visibility_pointerdown");
  }, true);
  uploadVisibilityNav.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (consumePointerHandledAction(event, target, "nav_visibility")) return;
    if (handleCurrentPagePanelAction(target, "nav_visibility_click")) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

if (sourceAccountReviewCancel) {
  sourceAccountReviewCancel.addEventListener("click", closeSourceAccountReviewDialog);
}

if (sourceAccountReviewReject) {
  sourceAccountReviewReject.addEventListener("click", () => {
    const decision = sourceAccountReviewDecision;
    if (!decision) return;
    closeSourceAccountReviewDialog();
    setSourceAccountApproval("rejected", decision);
  });
}

if (sourceAccountReviewApprove) {
  sourceAccountReviewApprove.addEventListener("click", () => {
    const decision = sourceAccountReviewDecision;
    if (!decision) return;
    closeSourceAccountReviewDialog();
    setSourceAccountApproval("confirmed_dedicated", decision);
  });
}

if (sourceAccountReviewDialog) {
  sourceAccountReviewDialog.addEventListener("cancel", () => {
    sourceAccountReviewDecision = null;
  });
  sourceAccountReviewDialog.addEventListener("close", () => {
    sourceAccountReviewDecision = null;
  });
}

if (characterPanel) {
  characterPanel.addEventListener("pointerdown", (event) => {
    handleCurrentPagePanelPointerDown(event, "current_page_pointerdown");
  }, true);
  characterPanel.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (consumePointerHandledAction(event, target, "current_page_panel")) return;
    if (handleCurrentPagePanelAction(target, "current_page_click")) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

function openDatacatBridgeFromSidebar() {
  debugLog("datacat_link_click", {});
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_OPEN_DATACAT_LOGIN }, (response) => {
    debugLog("datacat_link_response", {
      runtimeError: chrome.runtime.lastError && chrome.runtime.lastError.message,
      ok: response && response.ok !== false,
      error: response && response.error || null,
    });
    if (chrome.runtime.lastError || !response || !response.ok) {
      datacatError =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Could not open the Datacat link page.";
      renderDatacatPanel();
    }
  });
}

function openDatacatSettingsFromSidebar() {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html#connections") });
}

datacatPanel.addEventListener("pointerdown", (event) => {
  if (event.button != null && event.button !== 0) return;
  const target = event.target && event.target.closest("[data-action]");
  if (!target) return;
  const action = target.getAttribute("data-action");
  if (action !== "datacat-settings") return;
  const signature = getPointerActionSignature(target);
  debugLog("datacat_settings_pointerdown_action", { action, signature });
  openDatacatSettingsFromSidebar();
  pointerHandledActionAt = Date.now();
  pointerHandledActionSignature = signature;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
}, true);

datacatPanel.addEventListener("click", (event) => {
  const target = event.target && event.target.closest("[data-action]");
  if (!target) return;
  if (consumePointerHandledAction(event, target, "datacat_panel")) return;
  const action = target.getAttribute("data-action");
  if (action === "datacat-check") {
    requestDatacatState({ force: true });
    return;
  }
  if (action === "datacat-save-origin") {
    saveDatacatOrigin();
    return;
  }
  if (action === "datacat-login") {
    openDatacatBridgeFromSidebar();
    return;
  }
  if (action === "datacat-settings") {
    openDatacatSettingsFromSidebar();
    return;
  }
  if (action === "datacat-unlink") {
    if (!window.confirm("Unlink this Datacat account from Pincat on this Chrome profile?")) return;
    chrome.runtime.sendMessage({ type: MessageTypes.SV2_UNLINK_DATACAT }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        datacatError =
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not unlink Datacat.";
      } else if (response.state) {
        dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.DATACAT_STATE_UPDATED, state: response.state });
        datacatError = null;
      }
      renderDatacatPanel();
      renderPreflightStatus();
      renderCurrentPageCard();
    });
  }
});

datacatPanel.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.target && event.target.id === "datacatOriginInput") {
    event.preventDefault();
    saveDatacatOrigin();
  }
});

if (uploadOptionsPanel) {
  uploadOptionsPanel.addEventListener("pointerdown", (event) => {
    handleCurrentPagePanelPointerDown(event, "upload_options_pointerdown");
  }, true);
  uploadOptionsPanel.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-action]");
    if (!target) return;
    if (consumePointerHandledAction(event, target, "upload_options_panel")) return;
    if (handleCurrentPagePanelAction(target, "upload_options_click")) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}

if (debugPanel) {
  debugPanel.addEventListener("pointerdown", (event) => {
    const target = event.target && event.target.closest("[data-debug-action]");
    if (!target || target.getAttribute("data-debug-action") !== "toggle") return;
    debugPointerToggleAt = Date.now();
    event.preventDefault();
    event.stopPropagation();
    toggleDebugPanelCollapsed();
  });
  debugPanel.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-debug-action]");
    if (!target) return;
    const action = target.getAttribute("data-debug-action");
    if (action === "toggle") {
      if (Date.now() - debugPointerToggleAt > 500) toggleDebugPanelCollapsed();
      return;
    }
    if (action === "clear") {
      debugLogs = [];
      debugCollapsed = true;
      renderDebugPanel();
      return;
    }
    if (action === "copy") {
      const text = debugLogs.map((entry) => JSON.stringify(entry)).join("\n");
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(text).then(
          () => debugLog("debug_copy_ok", { count: debugLogs.length }),
          (error) => debugLog("debug_copy_failed", { error: error && error.message || String(error || "clipboard_failed") }),
        );
      } else {
        debugLog("debug_copy_unavailable", { count: debugLogs.length });
      }
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === MessageTypes.SV2_QUEUE_UPDATED) {
    const incoming = message.queue && typeof message.queue === "object" ? message.queue : null;
    if (!incoming || Number(incoming.revision || 0) < Number(queueState && queueState.revision || 0)) return;
    reconcileOptimisticQueueItems(incoming);
    dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.QUEUE_UPDATED, queue: incoming });
    queueLoading = false;
    queueError = null;
    renderRetrievedPanel();
    renderActiveRetrievalIndicator();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    return;
  }
  if (message.type === MessageTypes.SV2_DEBUG_LOG) {
    appendDebugEntry({
      ...(message.entry || {}),
      source: message.entry && message.entry.source ? message.entry.source : "background",
    });
    return;
  }
  if (message.type === MessageTypes.SV_RETRIEVED_CHARACTERS_UPDATED) {
    debugLog("retrieved_characters_updated", {
      count: Array.isArray(message.list) ? message.list.length : null,
      savedId: message.saved && message.saved.id || null,
    });
    dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.RETRIEVED_LIST_LOADED, list: message.list });
    if (message.saved && message.saved.id) {
      setActiveRetrievalFallback(null);
      setActiveRecoveryJob(null);
      latestSavedCharacter = {
        id: message.saved.id,
        summary: message.saved.summary || {},
        upload: message.saved.upload || null,
        updatedAt: new Date().toISOString(),
      };
      if (retrievalDisplayMachine.flight && idsMatch(retrievalDisplayMachine.flight.characterId, message.saved.id)) {
        retrievalDisplayMachine.flight.fallback = null;
        retrievalDisplayMachine.flight.upload = message.saved.upload || null;
        retrievalDisplayMachine.flight.active = isUploadTransactionPending(message.saved.upload);
        retrievalDisplayMachine.flight.updatedAt = new Date().toISOString();
      }
      renderLatestSavedPanel();
    }
    renderRetrievalActivityPanel();
    renderCurrentPageCard();
    if (retrievedDetailItem && message.saved && message.saved.id === retrievedDetailItem.id) {
      openRetrievedDetail(message.saved.id);
    } else {
      renderCurrentDetailsPanel();
      renderRetrievedPanel();
    }
    return;
  }
  if (message.type === MessageTypes.SV2_DATACAT_STATE_UPDATED) {
    debugLog("datacat_state_push", {
      connected: message.state && message.state.connected === true,
      authenticated: message.state && message.state.authenticated === true,
      sessionReady: message.state && message.state.sessionReady === true,
    });
    datacatStateRequestSeq += 1;
    dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.DATACAT_STATE_UPDATED, state: message.state });
    datacatError = null;
    datacatLoading = false;
    datacatStateRequestInFlight = false;
    datacatStateLastSettledAt = Date.now();
    renderDatacatPanel();
    dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED, preflight: null });
    preflightError = null;
    preflightLoading = false;
    preflightKey = null;
    renderPreflightStatus();
    renderCurrentPageCard();
    maybeRequestPreflight();
    announcementState.requestKey = null;
    maybeRequestSourceAnnouncement({ force: true });
    return;
  }
  if (message.type === MessageTypes.SV2_UPLOAD_SETTINGS_UPDATED) {
    if (message.scope !== "window") {
      requestUploadSettings();
      return;
    }
    if (Number(message.windowId) !== Number(panelWindowId)) return;
    const nextVisibility = normalizeUploadVisibility(message.settings && message.settings.visibility);
    if (nextVisibility === uploadVisibility) {
      debugLog("upload_settings_push_noop", { visibility: nextVisibility });
      renderUploadOptionsPanel();
      renderPreflightStatus();
      renderCurrentDetailsPanel();
      return;
    }
    dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.UPLOAD_VISIBILITY_UPDATED, visibility: nextVisibility });
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.PREFLIGHT_UPDATED,
      preflight: updatePreflightRequestedVisibility(preflightState, uploadVisibility),
    });
    renderUploadOptionsPanel();
    renderPreflightStatus();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    return;
  }
  if (message.type === MessageTypes.SV2_SOURCE_ACCOUNT_APPROVALS_UPDATED) {
    sourceAccountApprovalsDecisionSeq += 1;
    sourceAccountApprovalsRequestSeq += 1;
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.SOURCE_ACCOUNT_APPROVALS_UPDATED,
      approvals: message.approvals,
    });
    sourceAccountApprovalsLoading = false;
    sourceAccountApprovalsError = null;
    renderAccountGatePanel();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    updateRetrieveActions(canRetrieveCurrentPage());
    maybeAutoOpenCurrentCreatorView();
    return;
  }
  if (message.type === MessageTypes.SV2_THUMBNAIL_CACHE_UPDATED) {
    if (message.cleared === true) {
      thumbnailCacheEntries = {};
      thumbnailRequestInFlightKeys.clear();
    } else if (message.entries && typeof message.entries === "object") {
      thumbnailCacheEntries = { ...(thumbnailCacheEntries || {}), ...message.entries };
    }
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    renderRetrievedPanel();
    return;
  }
  if (message.type === MessageTypes.SV2_CREATOR_LOAD_PHASE) {
    if (!creatorDetailState || creatorDetailState.active !== true || creatorDetailState.loading !== true) return;
    const currentKey = getCreatorRequestKey(creatorDetailState.request || {});
    const incomingKey = getCreatorRequestKey(message);
    if (!currentKey || !incomingKey || currentKey !== incomingKey) return;
    updateCreatorDetailState({
      phase: message.clear === true ? null : String(message.message || "").trim() || null,
    });
    renderCurrentDetailsPanel();
    return;
  }
  if (message.type === MessageTypes.SV2_STORAGE_CLEARED) {
    retrievalDisplayMachine.flight = null;
    retrievalDisplayMachine.focusState = null;
    thumbnailCacheEntries = {};
    thumbnailRequestInFlightKeys.clear();
    dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.STORAGE_CLEARED });
    latestSavedCharacter = null;
    currentDetailsLoadingSeq += 1;
    retrievedDetailItem = null;
    currentDetailsMessageState = null;
    clearCurrentPageTerminalState();
    updateCreatorDetailState({ active: false, loading: false, error: null, record: null, phase: null });
    preflightError = null;
    preflightKey = null;
    queueLoading = false;
    queueError = null;
    renderLatestSavedPanel();
    renderRetrievalActivityPanel();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    renderRetrievedPanel();
    requestDatacatState({ force: true });
    requestRetrievedCharacters();
    requestUploadSettings();
    requestState({ force: true, forceAuth: true });
    return;
  }
  if (message.type === MessageTypes.SV2_UPLOAD_STATUS_UPDATED) {
    dispatchSidebar({
      type: SourceVaultSidebarStore.ActionTypes.UPLOAD_STATUS_UPDATED,
      list: message.list,
      characterId: message.characterId,
      upload: message.upload,
    });
    const uploadStatusKind = getUploadStatusKind(message.upload);
    if (retrievalDisplayMachine.flight && idsMatch(retrievalDisplayMachine.flight.characterId, message.characterId)) {
      retrievalDisplayMachine.flight.upload = message.upload || retrievalDisplayMachine.flight.upload || null;
      retrievalDisplayMachine.flight.active = uploadStatusKind === "pending" || uploadStatusKind === "not_uploaded";
      retrievalDisplayMachine.flight.updatedAt = new Date().toISOString();
    }
    if (latestSavedCharacter && latestSavedCharacter.id === message.characterId) {
      latestSavedCharacter = {
        ...latestSavedCharacter,
        upload: message.upload || latestSavedCharacter.upload,
        updatedAt: new Date().toISOString(),
      };
      renderLatestSavedPanel();
    }
    if (retrievedDetailItem && retrievedDetailItem.id === message.characterId) {
      retrievedDetailItem = message.item || retrievedDetailItem;
    }
    renderRetrievalActivityPanel();
    renderCurrentPageCard();
    renderCurrentDetailsPanel();
    renderRetrievedPanel();
    return;
  }
  if (message.type === MessageTypes.SV2_CREATOR_RECORD_UPDATED) {
    if (creatorDetailState && creatorDetailState.active && message.record) {
      const currentKey = creatorDetailState.record && creatorDetailState.record.key;
      const request = creatorDetailState.request || {};
      const requestMatches =
        currentKey && currentKey === message.record.key ||
        (request.creatorId && request.creatorId === message.record.creatorId) ||
        (request.creatorHandle && String(request.creatorHandle).toLowerCase() === String(message.record.creatorHandle || "").toLowerCase());
      if (requestMatches && isCreatorRequestCurrentPage(request)) {
        updateCreatorDetailState({
          loading: false,
          error: null,
          record: message.record,
          freshness: message.freshness || creatorDetailState.freshness,
          phase: null,
        });
        setCurrentPageTerminalState({
          title: "Creator ready",
          message: "Creator capture finished.",
          tone: "completed",
        });
        renderCurrentPageCard();
        renderCurrentDetailsPanel();
      } else if (requestMatches) {
        updateCreatorDetailState({
          active: false,
          loading: false,
          error: null,
          phase: null,
        });
      }
    }
    return;
  }
  if (message.type === MessageTypes.SV_JANNY_RECOVERY_JOB_UPDATED) {
    const recoveryJob = message.job && typeof message.job === "object" ? message.job : null;
    setActiveRecoveryJob(recoveryJob);
    if (recoveryJob && isJannyRecoveryJobActive(recoveryJob)) {
      const activeFallback = getActiveRetrievalFallback();
      if (activeFallback && activeFallback.retrieval) {
        setActiveRetrievalFallback({
          ...activeFallback,
          retrieval: {
            ...activeFallback.retrieval,
            running: true,
            stage: recoveryJob.status,
            message: `Source page action required. Job ends in ${Math.max(0, Number(recoveryJob.remainingSeconds || 0))}s.`,
            jannyRecoveryJob: recoveryJob,
            components: {
              ...(activeFallback.retrieval.components || buildPendingComponents(activeFallback.sourceKind || "janitor")),
              recovery: {
                label: "Additional",
                status: recoveryJob.status,
                message: "Waiting for source page action.",
              },
            },
          },
        });
      }
    }
    if (recoveryJob && !isJannyRecoveryJobActive(recoveryJob)) {
      const recoveryJobId = recoveryJob.jobId || null;
      setTimeout(() => {
        const currentJob = getActiveRecoveryJob();
        if (
          currentJob &&
          (!recoveryJobId || currentJob.jobId === recoveryJobId) &&
          !isJannyRecoveryJobActive(currentJob)
        ) {
          setActiveRecoveryJob(null);
        }
      }, 3000);
    }
    renderRetrievalActivityPanel();
    renderCurrentPageCard();
    renderRetrievedPanel();
    return;
  }
  if (message.type === MessageTypes.SV_TAB_STATE_UPDATED) {
    if (panelWindowId && message.windowId && Number(message.windowId) !== Number(panelWindowId)) return;
    debugLog("tab_state_updated", {
      tabId: message.tabId || null,
      state: summarizeStateForDebug(message.state),
    });
    const fromFlightOwner = isRetrievalFlightOwnerTab(message.tabId);
    if (message.tabId && activeBrowserTabId && message.tabId !== activeBrowserTabId && !fromFlightOwner) {
      debugLog("tab_state_ignored_non_active", {
        tabId: message.tabId || null,
        activeBrowserTabId,
        state: summarizeStateForDebug(message.state),
      });
      return;
    }
    if (message.tabId && !fromFlightOwner) activeBrowserTabId = message.tabId;
    if (message.state) {
      if (
        !acceptPendingSourceNavigationState(message.tabId, message.state, {
          channel: "tab_state",
        })
      ) {
        debugLog("tab_state_ignored_pending_mismatch", {
          tabId: message.tabId || null,
          pendingSourceNavigationUrl,
          state: summarizeStateForDebug(message.state),
        });
        return;
      }
      const retrieval = message.state.retrieval && typeof message.state.retrieval === "object" ? message.state.retrieval : null;
      const stateJob = retrieval && retrieval.jannyRecoveryJob && typeof retrieval.jannyRecoveryJob === "object" ? retrieval.jannyRecoveryJob : null;
      if (stateJob && isJannyRecoveryJobActive(stateJob)) setActiveRecoveryJob(stateJob);
      if (retrieval && retrieval.running === false && (!stateJob || !isJannyRecoveryJobActive(stateJob))) {
        setActiveRecoveryJob(null);
      }
      if (isRetrievalFlightActive() && !fromFlightOwner && !hasRetrievalActivity(retrieval)) {
        retrievalDisplayMachine.focusState = message.state;
        renderRetrievalFlightState();
        return;
      }
      if (!hasRetrievalActivity(retrieval) && !isRetrievalFlightActive()) {
        clearCurrentPageTerminalState();
      }
      if (retrieval && (retrieval.running || retrieval.summary || retrieval.error || (Array.isArray(retrieval.logs) && retrieval.logs.length))) {
        setActiveRetrievalFallback(null);
      }
      applyIncomingState(message.tabId, message.state, { eventRevision: message.eventRevision || 0 });
    } else {
      requestState();
    }
    return;
  }
  if (message.type === MessageTypes.SV_ACTIVE_TAB_CHANGED || message.type === MessageTypes.SV_TAB_URL_CHANGED) {
    if (panelWindowId && message.windowId && Number(message.windowId) !== Number(panelWindowId)) return;
    if (
      message.type === MessageTypes.SV_TAB_URL_CHANGED &&
      message.tabId &&
      activeBrowserTabId &&
      Number(message.tabId) !== Number(activeBrowserTabId) &&
      !isRetrievalFlightOwnerTab(message.tabId)
    ) {
      debugLog("tab_url_changed_ignored_non_active", {
        tabId: message.tabId || null,
        activeBrowserTabId,
        url: message.url || null,
        status: message.status || null,
      });
      return;
    }
    debugLog(message.type === MessageTypes.SV_ACTIVE_TAB_CHANGED ? "active_tab_changed" : "tab_url_changed", {
      tabId: message.tabId || null,
      url: message.url || null,
      status: message.status || null,
      eventRevision: message.eventRevision || null,
      navigationEpoch: message.navigationEpoch || null,
    });
    const contextResult = beginActiveBrowserPageContext(message);
    if (!contextResult.accepted) return;
    if (isRetrievalFlightActive()) {
      requestState({ force: false });
      return;
    }
    const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : {};
    if (contextResult.changed || page.pendingNavigation || !isStateDisplaySettled(currentState)) {
      requestState({ force: false, autoOpenRetrieval: true });
    }
  }
});

window.addEventListener("focus", () => {
  requestState({ force: false });
  requestQueueState();
  requestDatacatState();
  forceRefreshSourceAnnouncement();
  requestExtensionVersionStatus();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    requestState({ force: false });
    requestQueueState();
    requestDatacatState();
    forceRefreshSourceAnnouncement();
    requestExtensionVersionStatus();
  }
});

renderDebugPanel();
debugLog("debug_enabled", { enabled: debugEnabled, limit: DEBUG_LOG_LIMIT });
if (chrome.windows && chrome.windows.getCurrent) {
  chrome.windows.getCurrent((windowInfo) => {
    void chrome.runtime.lastError;
    panelWindowId = windowInfo && windowInfo.id ? windowInfo.id : null;
    requestUploadSettings();
    requestState({ force: true, forceAuth: true });
  });
} else {
  requestUploadSettings();
  requestState({ force: true, forceAuth: true });
}
requestQueueState();
requestDatacatState({ force: true });
requestExtensionVersionStatus({ force: true });
requestSourceAccountApprovals();
requestRetrievedCharacters();
startAnnouncementRefreshLoop();
startExtensionVersionRefreshLoop();
