"use strict";

/* ui/sidebar/views/activity.js — activity view render + helpers.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

function renderLatestSavedPanel() {
  if (!latestSavedPanel) return;
  const item = latestSavedCharacter;
  if (!item || !item.id) {
    latestSavedPanel.hidden = true;
    latestSavedPanel.innerHTML = "";
    return;
  }
  const summary = item.summary || {};
  const upload = item.upload && typeof item.upload === "object" ? item.upload : {};
  const chips = ["Pinned"];
  latestSavedPanel.hidden = false;
  latestSavedPanel.innerHTML = `
    <div class="latest-saved-title">${escapeHtml(summary.title || "Pinned character")}</div>
    ${renderComponentChecklistHtml(summary.components || upload.components, getRetrievedItemSourceKind(item))}
    <div class="terminal-chips">
      ${chips.map((chip) => `<span class="terminal-chip">✓ ${escapeHtml(chip)}</span>`).join("")}
    </div>
    <div class="terminal-meta">
      <span>${escapeHtml(formatDate(item.updatedAt || summary.capturedAt))}</span>
      ${summary.author ? `<span>by ${escapeHtml(summary.author)}</span>` : ""}
      ${upload.error ? `<span>${escapeHtml(upload.error)}</span>` : ""}
      <button class="latest-saved-link" data-action="open-latest-saved" data-character-id="${escapeHtml(item.id)}">View</button>
    </div>
  `;
}

function buildPendingComponents(sourceKind) {
  const normalizedSourceKind = String(sourceKind || "janitor").toLowerCase() === "saucepan" ? "saucepan" : "janitor";
  return {
    sourceKind: normalizedSourceKind,
    core: { label: "Character", status: "pending", message: "Waiting to start." },
    ...(normalizedSourceKind === "janitor"
      ? { recovery: { label: "Additional", status: "pending", message: "Waiting to start." } }
      : {}),
    creator: { label: "Creator", status: "pending", message: "Waiting to start." },
  };
}

function isJannyRecoveryJobActive(job) {
  const status = String(job && job.status ? job.status : "").trim().toLowerCase();
  return status === "waiting_user_action" || status === "resuming";
}

function getVisibleJannyRecoveryJob(retrieval = null, allowGlobal = false) {
  const fromRetrieval = retrieval && retrieval.jannyRecoveryJob && typeof retrieval.jannyRecoveryJob === "object"
    ? retrieval.jannyRecoveryJob
    : null;
  const activeRecoveryJob = getActiveRecoveryJob();
  if (fromRetrieval && isJannyRecoveryJobActive(fromRetrieval)) return fromRetrieval;
  if (allowGlobal && activeRecoveryJob && isJannyRecoveryJobActive(activeRecoveryJob)) return activeRecoveryJob;
  return fromRetrieval || (allowGlobal ? activeRecoveryJob : null) || null;
}

function buildActiveRecentItem() {
  const flight = getActiveRetrievalFlight();
  const flightState = flight && isSupportedCharacterState(flight.state) ? flight.state : null;
  const currentCharacterState = isSupportedCharacterState(currentState) ? currentState : null;
  const displayState = flightState || currentCharacterState;
  const activeFallback = getActiveRetrievalFallback();
  const flightRetrieval = getStateRetrieval(flightState);
  const currentRetrieval = getStateRetrieval(currentCharacterState);
  const retrieval = hasRetrievalActivity(flightRetrieval)
    ? flightRetrieval
    : activeFallback && activeFallback.retrieval
      ? activeFallback.retrieval
      : currentRetrieval;
  const page = displayState && displayState.page && typeof displayState.page === "object"
    ? displayState.page
    : null;
  const character = displayState && displayState.character && typeof displayState.character === "object"
    ? displayState.character
    : null;
  if (!hasRetrievalActivity(retrieval)) {
    return null;
  }
  const fallbackSummary = activeFallback && activeFallback.summary ? activeFallback.summary : {};
  const characterId = (flight && flight.characterId) || getStateCharacterId(displayState) || fallbackSummary.id || null;
  if (!characterId) return null;
  const storedItem = characterId
    ? retrievedList.find((item) => item && idsMatch(item.id, characterId)) || null
    : null;
  const flightMatches = !!(
    flight &&
    (!flight.characterId || idsMatch(flight.characterId, characterId))
  );
  const upload = flightMatches
    ? flight.upload || (activeFallback && activeFallback.upload) || null
    : (storedItem && storedItem.upload) || null;
  const awaitingPersistence = !!(
    flightMatches &&
    !flight.upload &&
    (retrieval.summary || retrieval.error)
  );
  const transactionPending =
    retrieval.running === true ||
    isUploadTransactionPending(upload) ||
    (flightMatches && flight.active === true) ||
    awaitingPersistence;
  const hasTerminalResult = !!(retrieval.summary || retrieval.error);
  if (!transactionPending && !hasTerminalResult) {
    return null;
  }
  if (!transactionPending && characterId && storedItem) {
    return null;
  }
  const sourceKind =
    normalizeSourceKind(flight && flight.sourceKind) ||
    normalizeSourceKind(page && page.sourceKind) ||
    normalizeSourceKind(activeFallback && activeFallback.sourceKind) ||
    getCurrentSourceKind();
  return {
    id: "__active__",
    characterId: characterId || fallbackSummary.id || null,
    isActive: true,
    summary: {
      id: characterId || fallbackSummary.id || null,
      sourceKind,
      title: character && character.name ? character.name : fallbackSummary.title || "Current pin",
      author: compactMeta([character && character.creatorName, character && character.creatorHandle]) || fallbackSummary.author || null,
      capturedAt: new Date().toISOString(),
      components: retrieval.components || (upload && upload.components) || (storedItem && storedItem.summary && storedItem.summary.components) || null,
    },
    upload,
    sourceLabel: page && page.sourceLabel ? page.sourceLabel : getSourceLabel(sourceKind),
    retrieval: {
      ...retrieval,
      jannyRecoveryJob: getVisibleJannyRecoveryJob(retrieval, true),
    },
  };
}

function getRecentItemSourceKind(item) {
  if (item && item.isActive) {
    return normalizeSourceKind(item.summary && item.summary.sourceKind) || getCurrentSourceKind();
  }
  return getRetrievedItemSourceKind(item);
}

function getActivityHistoryItems() {
  const pins = [...(Array.isArray(retrievedList) ? retrievedList : [])];
  const pinnedKeys = new Set(pins.map((item) => {
    const sourceKind = normalizeSourceKind(item && item.summary && item.summary.sourceKind || item && item.sourceKind);
    const characterId = String(item && item.id || item && item.summary && item.summary.id || "").trim().toLowerCase();
    return sourceKind && characterId ? `${sourceKind}:${characterId}` : null;
  }).filter(Boolean));
  const failures = (typeof queueState !== "undefined" && Array.isArray(queueState && queueState.finished) ? queueState.finished : [])
    .filter((item) => item && item.state === "failed")
    .filter((item) => !pinnedKeys.has(`${normalizeSourceKind(item.sourceKind)}:${String(item.characterId || "").toLowerCase()}`))
    .map((item) => ({
      id: `queue-failed:${item.queueItemId || item.characterId}`,
      characterId: item.characterId,
      isQueueHistory: true,
      queueItemId: item.queueItemId || null,
      queueState: "failed",
      normalizedUrl: item.normalizedUrl || null,
      summary: {
        id: item.characterId,
        sourceKind: normalizeSourceKind(item.sourceKind),
        title: item.title || "Character",
        author: item.author || null,
        pageUrl: item.normalizedUrl || null,
        components: item.components || null,
      },
      upload: { status: "failed", error: item.error || null },
      retrieval: {
        running: false,
        error: item.error || "Retrieval failed.",
        logs: [],
        components: item.components || null,
      },
      updatedAt: item.finishedAt || item.updatedAt || item.enqueuedAt || null,
    }));
  return [...pins, ...failures]
    .sort((left, right) => String(right && right.updatedAt || "").localeCompare(String(left && left.updatedAt || "")));
}

function getActivitySearchText(item) {
  const root = item && typeof item === "object" ? item : {};
  const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
  return [
    root.id,
    root.characterId,
    summary.id,
    summary.title,
    summary.author,
    summary.creatorName,
    summary.creatorHandle,
  ].filter(Boolean).join(" ").toLowerCase();
}

function getFilteredActivityHistoryItems() {
  const query = String(activitySearchQuery || "").trim().toLowerCase();
  const sourceFilter = normalizeSourceKind(activitySourceFilterValue) || "all";
  return getActivityHistoryItems().filter((item) => {
    if (sourceFilter !== "all" && getRecentItemSourceKind(item) !== sourceFilter) return false;
    return !query || getActivitySearchText(item).includes(query);
  });
}

function syncQueueOverlayLifecycle(visible) {
  if (!visible) {
    queueOverlayVisible = false;
    queueOverlayExpanded = false;
    return;
  }
  if (!queueOverlayVisible) {
    queueOverlayVisible = true;
    queueOverlayExpanded = false;
  }
}

function getTransactionReadingMessage(retrieval) {
  return sanitizeRecentStatusText(retrieval && retrieval.message) || "Collecting source data.";
}

function hasTransactionComponentWarnings(components, sourceKind) {
  return normalizeComponentChecklist(components, sourceKind).some((item) => {
    const status = String(item.status || "").trim().toLowerCase();
    if (isPassedSkippedComponent(item)) return false;
    return status === "failed" || status === "timed_out" || status === "action_required";
  });
}

function deriveRetrievalTransaction(item) {
  const root = item && typeof item === "object" ? item : {};
  const retrieval = root.retrieval && typeof root.retrieval === "object" ? root.retrieval : null;
  const upload = root.upload && typeof root.upload === "object" ? root.upload : {};
  const sourceKind = getRecentItemSourceKind(root);
  const components = getItemComponentsForStatus(root);
  const uploadStatus = getUploadStatusKind(upload);
  const jannyJob = getVisibleJannyRecoveryJob(retrieval, root.isActive === true);
  const actionRequired = !!(jannyJob && isJannyRecoveryJobActive(jannyJob));
  const componentWarnings = hasTransactionComponentWarnings(components, sourceKind);

  if (root.isQueueHistory === true && root.queueState === "already_available") {
    return {
      state: "completed",
      label: "AVAILABLE",
      shortLabel: "available",
      message: "Already available on Datacat.",
      phaseIndex: 3,
      active: false,
      components,
      jannyJob,
      upload,
    };
  }

  if (actionRequired) {
    return {
      state: "action-required",
      label: "ACTION REQUIRED",
      shortLabel: "action needed",
      message: `Continue in the opened source page. Job ends in ${Math.max(0, Number(jannyJob.remainingSeconds || 0))}s.`,
      phaseIndex: 0,
      active: true,
      components,
      jannyJob,
      upload,
    };
  }
  if (uploadStatus === "pending") {
    const rawStatus = String(upload.status || "").trim().toLowerCase();
    return {
      state: "running",
      label: "RUNNING",
      shortLabel: "saving",
      message: rawStatus === "checking_datacat" ? "Preparing result." : "Processing result.",
      phaseIndex: rawStatus === "pending" ? 1 : 2,
      active: true,
      components,
      jannyJob,
      upload,
    };
  }
  if (retrieval && retrieval.running === true) {
    return {
      state: "running",
      label: "RUNNING",
      shortLabel: "running",
      message: getTransactionReadingMessage(retrieval),
      phaseIndex: 0,
      active: true,
      components,
      jannyJob,
      upload,
    };
  }
  if (retrieval && retrieval.error) {
    return {
      state: "failed",
      label: "FAILED",
      shortLabel: "failed",
      message: sanitizeRecentStatusText(retrieval.error) || "Retrieval failed.",
      phaseIndex: 0,
      active: false,
      components,
      jannyJob,
      upload,
    };
  }
  if (root.isActive === true && retrieval && retrieval.summary && uploadStatus === "not_uploaded") {
    return {
      state: "running",
      label: "RUNNING",
      shortLabel: "preparing",
      message: "Processing result.",
      phaseIndex: 1,
      active: true,
      components,
      jannyJob,
      upload,
    };
  }
  if (uploadStatus === "uploaded" || uploadStatus === "local_saved") {
    return {
      state: componentWarnings ? "warning" : "completed",
      label: componentWarnings ? "COMPLETED WITH WARNINGS" : "COMPLETED",
      shortLabel: componentWarnings ? "warning" : "retrieved",
      message: uploadStatus === "local_saved"
        ? "Character saved locally."
        : componentWarnings
          ? "Pinned to Datacat with component warnings."
          : "Pinned to Datacat.",
      phaseIndex: 3,
      active: false,
      components,
      jannyJob,
      upload,
    };
  }
  if (uploadStatus === "failed") {
    return {
      state: "failed",
      label: "FAILED",
      shortLabel: "failed",
      message: "Processing failed. Retry from this card.",
      phaseIndex: 2,
      active: false,
      components,
      jannyJob,
      upload,
    };
  }
  if (uploadStatus === "session_required") {
    return {
      state: "warning",
      label: "NEEDS ATTENTION",
      shortLabel: "attention",
      message: "Connect Datacat, then retry the save.",
      phaseIndex: 2,
      active: false,
      components,
      jannyJob,
      upload,
    };
  }
  if (root.isActive === true) {
    return {
      state: "running",
      label: "RUNNING",
      shortLabel: "running",
      message: "Starting retrieval.",
      phaseIndex: 0,
      active: true,
      components,
      jannyJob,
      upload,
    };
  }
  return {
    state: componentWarnings ? "warning" : "completed",
    label: componentWarnings ? "COMPLETED WITH WARNINGS" : "COMPLETED",
    shortLabel: componentWarnings ? "warning" : "retrieved",
    message: componentWarnings ? "Retrieved with component warnings." : "Retrieved.",
    phaseIndex: 3,
    active: false,
    components,
    jannyJob,
    upload,
  };
}

function renderTransactionPhaseTrack(transaction) {
  const root = transaction && typeof transaction === "object" ? transaction : {};
  const steps = ["Start", "Collect", "Process", "Complete"];
  return `
    <div class="transaction-phase-track" aria-label="Retrieval progress">
      ${steps.map((label, index) => {
        const stateClass = root.state === "failed" && index === root.phaseIndex
          ? "is-failed"
          : index < root.phaseIndex || (!root.active && root.state !== "failed" && index === root.phaseIndex)
            ? "is-complete"
            : index === root.phaseIndex
              ? "is-active"
              : "is-upcoming";
        return `<span class="transaction-phase ${stateClass}"><span class="transaction-phase-dot"></span><span>${escapeHtml(label)}</span></span>`;
      }).join("")}
    </div>
  `;
}

function renderTransactionStatusGroups(transaction, sourceKind) {
  return `
    <div class="transaction-status-group transaction-progress-group">
      <div class="transaction-section-label">Progress</div>
      ${renderTransactionPhaseTrack(transaction)}
    </div>
    <div class="transaction-status-group transaction-components-group">
      <div class="transaction-section-label">Components</div>
      ${renderComponentChecklistHtml(transaction.components, sourceKind, { compact: true })}
    </div>
  `;
}

function renderActiveRetrievalIndicator() {
  if (!activeRetrievalIndicator) return;
  const queueScrollState = captureQueueOverlayScrollState(activeRetrievalIndicator);
  if (isQueueVisible()) {
    syncQueueOverlayLifecycle(true);
    const copy = getQueueStatusCopy();
    activeRetrievalIndicator.hidden = false;
    activeRetrievalIndicator.className = `active-retrieval-indicator is-queue-${copy.tone}${queueOverlayExpanded ? " is-expanded" : ""}`;
    activeRetrievalIndicator.innerHTML = `
      <button class="active-retrieval-header" type="button" data-action="toggle-queue-overlay" aria-expanded="${queueOverlayExpanded ? "true" : "false"}" aria-controls="queueOverlayDetails">
        <span class="active-retrieval-pulse" aria-hidden="true"></span>
        <span class="active-retrieval-copy">
          <strong>${escapeHtml(copy.title)}</strong>
          <span>${escapeHtml(copy.message)}</span>
        </span>
        <span class="active-retrieval-arrow${queueOverlayExpanded ? " is-expanded" : ""}" aria-hidden="true"></span>
      </button>
      ${queueOverlayExpanded ? renderQueueOverlayDetails() : ""}
    `;
    restoreQueueOverlayScrollState(activeRetrievalIndicator, queueScrollState);
    return;
  }
  const item = buildActiveRecentItem();
  const transaction = item ? deriveRetrievalTransaction(item) : null;
  if (!transaction || transaction.active !== true) {
    syncQueueOverlayLifecycle(false);
    activeRetrievalIndicator.hidden = true;
    activeRetrievalIndicator.innerHTML = "";
    return;
  }
  const summary = item.summary && typeof item.summary === "object" ? item.summary : {};
  const title = compactText(summary.title || "Current character", 72);
  syncQueueOverlayLifecycle(true);
  activeRetrievalIndicator.hidden = false;
  activeRetrievalIndicator.className = `active-retrieval-indicator${queueOverlayExpanded ? " is-expanded" : ""}`;
  activeRetrievalIndicator.classList.toggle("is-action-required", transaction.state === "action-required");
  activeRetrievalIndicator.innerHTML = `
    <button class="active-retrieval-header" type="button" data-action="toggle-queue-overlay" aria-expanded="${queueOverlayExpanded ? "true" : "false"}" aria-controls="queueOverlayDetails">
      <span class="active-retrieval-pulse" aria-hidden="true"></span>
      <span class="active-retrieval-copy">
        <strong>${escapeHtml(transaction.state === "action-required" ? "Retrieval needs attention" : "Retrieval in progress")}</strong>
        <span>${escapeHtml(compactMeta([title, transaction.message]))}</span>
      </span>
      <span class="active-retrieval-arrow${queueOverlayExpanded ? " is-expanded" : ""}" aria-hidden="true"></span>
    </button>
    ${queueOverlayExpanded ? `
      <div class="queue-overlay-details" id="queueOverlayDetails">
        <div class="transaction-current-status" role="status">
          <strong>${escapeHtml(transaction.label)}</strong>
          <span>${escapeHtml(transaction.message)}</span>
        </div>
        ${renderTransactionStatusGroups(transaction, getRecentItemSourceKind(item))}
        ${renderRecentLogs(item.retrieval && item.retrieval.logs, false)}
      </div>
    ` : ""}
  `;
  restoreQueueOverlayScrollState(activeRetrievalIndicator, queueScrollState);
}

function getRecentItemStatus(item) {
  return deriveRetrievalTransaction(item).shortLabel;
}

function getRecentRunState(activeItem) {
  const retrieval = activeItem && activeItem.retrieval && typeof activeItem.retrieval === "object" ? activeItem.retrieval : null;
  if (retrieval && retrieval.running) {
    return { label: "RUNNING", className: "is-running", message: sanitizeRecentStatusText(retrieval.message) || "Pin is running." };
  }
  if (retrieval && retrieval.error) {
    return { label: "FAILED", className: "is-failed", message: sanitizeRecentStatusText(retrieval.error) || "Pin needs attention." };
  }
  if (retrieval && retrieval.summary) {
    return { label: "COMPLETED", className: "is-completed", message: "Pinned." };
  }
  if (latestSavedCharacter || retrievedList.length) {
    return { label: "COMPLETED", className: "is-completed", message: "Latest pin is ready." };
  }
  return { label: "READY", className: "is-ready", message: "No pin is running." };
}

function renderRecentRunState(activeItem) {
  const runState = getRecentRunState(activeItem);
  return `
    <div class="recent-run-state ${escapeHtml(runState.className)}">
      <span class="recent-run-label">${escapeHtml(runState.label)}</span>
      <span class="recent-run-message">${escapeHtml(runState.message || "")}</span>
    </div>
  `;
}

function renderRecentLogs(logs, expanded = false) {
  const rows = [...new Set((Array.isArray(logs) ? logs : []).slice(-12).reverse().map(sanitizeRecentLogEntry).filter(Boolean))].slice(0, 4);
  if (!rows.length) return "";
  return `
    <details class="activity-disclosure" ${expanded ? "open" : ""}>
      <summary>Activity <span>${rows.length}</span></summary>
      <div class="recent-log-list">
        ${rows
          .map((entry) => `<div class="log-row">${escapeHtml(entry)}</div>`)
          .join("")}
      </div>
    </details>
  `;
}

function renderRecentExpandedContent(item) {
  const transaction = deriveRetrievalTransaction(item);
  const retrieval = item && item.retrieval && typeof item.retrieval === "object" ? item.retrieval : null;
  const sourceKind = getRecentItemSourceKind(item);
  const jannyJob = transaction.jannyJob;
  const upload = transaction.upload && typeof transaction.upload === "object" ? transaction.upload : {};
  const datacatUrl = transaction.state === "failed" || !upload.viewUrl ? null : buildDatacatUrl(upload.viewUrl);
  const degraded = getRetrievedItemSourceQuality(item).degraded === true;
  return `
    <div class="recent-expanded retrieval-transaction is-${escapeHtml(transaction.state)}">
      <div class="transaction-current-status" role="status" aria-live="polite">
        <strong>${escapeHtml(transaction.label)}</strong>
        <span>${escapeHtml(transaction.message)}</span>
      </div>
      ${renderTransactionStatusGroups(transaction, sourceKind)}
      ${renderRecentLogs(retrieval && retrieval.logs, false)}
      <div class="recent-actions">
        ${jannyJob && isJannyRecoveryJobActive(jannyJob) ? `<button class="mini-button" data-action="open-janny-recovery-tab" data-job-id="${escapeHtml(jannyJob.jobId || "")}">Open source page</button>` : ""}
        ${jannyJob && isJannyRecoveryJobActive(jannyJob) ? `<button class="mini-button" data-action="skip-janny-recovery" data-job-id="${escapeHtml(jannyJob.jobId || "")}">Continue without additional details</button>` : ""}
        ${degraded && datacatUrl ? `<button class="mini-button source-quality-action" data-action="open-datacat" data-url="${escapeHtml(datacatUrl)}" data-recent-id="${escapeHtml(item.id || "")}">Improve on Datacat</button>` : ""}
      </div>
    </div>
  `;
}

function getLatestSavedActivityItem() {
  const item = latestSavedCharacter && latestSavedCharacter.id ? latestSavedCharacter : null;
  if (!item) return null;
  const currentId = getCurrentCharacterId();
  if (currentId && item.id && String(currentId).toLowerCase() !== String(item.id).toLowerCase()) return null;
  const summary = item.summary && typeof item.summary === "object" ? item.summary : {};
  const upload = item.upload && typeof item.upload === "object" ? item.upload : {};
  const localOnly = upload.localOnly === true || getUploadStatusKind(upload) === "local_saved";
  return {
    id: item.id,
    isActive: false,
    summary,
    upload,
    updatedAt: item.updatedAt || summary.capturedAt || null,
    retrieval: {
      running: false,
      summary: localOnly ? "Saved locally." : "Pinned.",
      error: null,
      logs: [],
      components: summary.components || upload.components || null,
    },
  };
}

function getRetrievalActivityItem() {
  return buildActiveRecentItem() || getLatestSavedActivityItem();
}

function getActivityState(activeItem) {
  const retrieval = activeItem && activeItem.retrieval && typeof activeItem.retrieval === "object" ? activeItem.retrieval : null;
  const jannyJob = getVisibleJannyRecoveryJob(retrieval, activeItem && activeItem.isActive === true);
  if (jannyJob && isJannyRecoveryJobActive(jannyJob)) {
    return {
      className: "is-action-required",
      title: "Action Required",
      message: `Continue in the opened source page. Job ends in ${Math.max(0, Number(jannyJob.remainingSeconds || 0))}s.`,
    };
  }
  if (retrieval && retrieval.running) {
    return { className: "is-running", title: "Retrieving", message: sanitizeRecentStatusText(retrieval.message) || "Retrieval is running." };
  }
  if (retrieval && retrieval.error) {
    return { className: "is-failed", title: "Failed", message: sanitizeRecentStatusText(retrieval.error) || "Retrieval needs attention." };
  }
  if (retrieval && retrieval.summary) {
    const local = String(retrieval.summary || "").toLowerCase().includes("saved locally");
    return { className: "is-completed", title: local ? "Saved locally" : "Pinned", message: local ? "Saved locally." : "Pinned." };
  }
  return { className: "is-ready", title: "Ready", message: "No retrieval is running." };
}

function renderRetrievalActivityPanel() {
  if (!retrievalActivityPanel) return;
  retrievalActivityPanel.hidden = true;
  retrievalActivityPanel.innerHTML = "";
}

function renderRetrievedPanel() {
  if (!retrievedPanel) return;
  const allHistoryItems = getActivityHistoryItems();
  const historyItems = getFilteredActivityHistoryItems();
  const count = allHistoryItems.length;
  renderActivityDownloadActions(allHistoryItems);
  activityFilteredCount = historyItems.length;
  const visibleItems = historyItems.slice(0, Math.max(ACTIVITY_PAGE_SIZE, activityVisibleLimit));
  const hasMore = visibleItems.length < historyItems.length;
  if (charactersTab) charactersTab.textContent = "Activity";
  if (expandedRecentId && !historyItems.some((item) => item && item.id === expandedRecentId)) {
    expandedRecentId = null;
  }
  if (activityResultCount) {
    activityResultCount.textContent = `Pins ${visibleItems.length}/${historyItems.length}`;
    activityResultCount.title = count === historyItems.length
      ? `${count} pinned characters`
      : `${historyItems.length} matching ${count} pinned characters`;
  }
  const rows = visibleItems
    .map((item) => {
      const summary = item.summary || {};
      const itemSourceKind = getRecentItemSourceKind(item);
      const sourceLabel = itemSourceKind === "saucepan" ? "Saucepan" : "Janitor";
      const sourceGlyph = itemSourceKind === "saucepan" ? "S" : "J";
      const meta = compactMeta([
        summary.author ? `by ${summary.author}` : "Unknown author",
        formatDate(item.updatedAt || summary.capturedAt),
      ]);
      const expanded = expandedRecentId === item.id;
      const selected = selectedActivityId === item.id;
      const transaction = deriveRetrievalTransaction(item);
      const upload = transaction.upload || {};
      const datacatUrl = transaction.state === "failed" || !upload.viewUrl ? null : buildDatacatUrl(upload.viewUrl);
      const characterId = item.characterId || item.id || summary.id || "";
      const sourceUrl = item.normalizedUrl || summary.pageUrl || buildCreatorCharacterSourceUrl(itemSourceKind, { id: characterId, name: summary.title });
      const completed = transaction.state === "completed" || transaction.state === "warning";
      const sourceQuality = getRetrievedItemSourceQuality(item);
      return `
        <article class="retrieved-row${expanded ? " is-expanded" : ""}${selected ? " is-selected" : ""}${item.isActive ? " is-active-transaction" : ""}" data-recent-id="${escapeHtml(item.id)}">
          <div class="retrieved-row-summary">
          <button class="retrieved-row-trigger" ${datacatUrl ? `data-action="open-datacat" data-url="${escapeHtml(datacatUrl)}" data-recent-id="${escapeHtml(item.id)}"` : "disabled"}>
            <span class="retrieved-source-badge is-${escapeHtml(itemSourceKind)}" role="img" aria-label="${escapeHtml(sourceLabel)}" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceGlyph)}</span>
            <span class="retrieved-row-copy">
              <span class="retrieved-row-title-line">
                <span class="retrieved-row-title">${escapeHtml(summary.title || "Unknown character")}</span>
                ${renderSourceQualityBadge(sourceQuality)}
              </span>
              <span class="retrieved-row-meta">${escapeHtml(meta)}</span>
            </span>
          </button>
          <span class="retrieved-row-controls">
            ${transaction.state === "failed" ? `<button class="mini-button activity-retry-button compact-icon-button" data-action="retry-activity-item" data-source-kind="${escapeHtml(itemSourceKind)}" data-character-id="${escapeHtml(characterId)}" data-url="${escapeHtml(sourceUrl || "")}" data-title="${escapeHtml(summary.title || "Character")}" data-author="${escapeHtml(summary.author || "")}" aria-label="Retry pin" title="Retry pin">${renderUiIcon("refresh")}</button>` : ""}
            ${completed && !item.isQueueHistory ? `<span class="activity-pin-status compact-icon-button" role="img" aria-label="Pinned" title="Pinned">${renderUiIcon("pin-check")}</span>${renderDownloadMenuHtml(item, { sourceKind: itemSourceKind, label: "Download", className: "activity-row-download", iconOnly: true })}` : ""}
            ${!completed && transaction.state !== "failed" ? `<span class="retrieved-row-status">${escapeHtml(getRecentItemStatus(item))}</span>` : ""}
            <button class="activity-more-button compact-icon-button" data-action="toggle-recent" data-recent-id="${escapeHtml(item.id)}" aria-label="${expanded ? "Hide" : "Show"} status for ${escapeHtml(summary.title || "character")}" title="${expanded ? "Hide" : "Show"} status">${renderUiIcon("more-vertical")}</button>
          </span>
          </div>
          ${expanded ? renderRecentExpandedContent(item) : ""}
        </article>
      `;
    })
    .join("");
  replaceDownloadMenuAwareHtml(retrievedPanel, `
    ${retrievedError ? `<div class="alert danger">${escapeHtml(retrievedError)}</div>` : ""}
    <div class="retrieved-list history-list">${
      retrievedLoading && !rows
        ? `<div class="retrieved-summary">Loading...</div>`
        : rows || `<div class="retrieved-summary">${count ? "No matching pins." : "No pinned characters yet."}</div>`
    }</div>
    ${hasMore ? `<button class="activity-load-more" type="button" data-action="load-more-activity">Show more</button>` : ""}
  `);
  renderActiveRetrievalIndicator();
  requestVisibleThumbnailsSoon();
}

function loadMoreActivityRows() {
  if (activityVisibleLimit >= activityFilteredCount) return false;
  activityVisibleLimit += ACTIVITY_PAGE_SIZE;
  renderRetrievedPanel();
  return true;
}

function maybeLoadMoreActivityRows() {
  if (activeMainTab !== "recent" || !sidebarScrollRegion || activityVisibleLimit >= activityFilteredCount) return;
  const remaining = sidebarScrollRegion.scrollHeight - sidebarScrollRegion.scrollTop - sidebarScrollRegion.clientHeight;
  if (remaining <= 180) loadMoreActivityRows();
}
