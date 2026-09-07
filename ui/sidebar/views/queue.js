"use strict";

/* ui/sidebar/views/queue.js — queue view render + helpers.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

function getQueueItemIdentity(item) {
  const root = item && typeof item === "object" ? item : {};
  const sourceKind = normalizeSourceKind(root.sourceKind);
  const characterId = String(root.characterId || "").trim().toLowerCase();
  return sourceKind && characterId ? `${sourceKind}:${characterId}` : null;
}

function getConfirmedOutstandingQueueItems() {
  const active = queueState && queueState.activeItem ? [queueState.activeItem] : [];
  const activeId = active[0] && active[0].queueItemId;
  const pending = Array.isArray(queueState && queueState.pending)
    ? queueState.pending.filter((item) => !activeId || item.queueItemId !== activeId)
    : [];
  return [...active, ...pending];
}

function getEffectiveOptimisticQueueItems() {
  const confirmedKeys = new Set(getConfirmedOutstandingQueueItems().map(getQueueItemIdentity).filter(Boolean));
  return (Array.isArray(optimisticQueueItems) ? optimisticQueueItems : [])
    .filter((item) => {
      const key = getQueueItemIdentity(item);
      return key && !confirmedKeys.has(key);
    });
}

function getEffectiveQueuePendingItems() {
  const activeId = queueState && queueState.activeItem && queueState.activeItem.queueItemId;
  const pending = Array.isArray(queueState && queueState.pending)
    ? queueState.pending.filter((item) => !activeId || item.queueItemId !== activeId)
    : [];
  return [...pending, ...getEffectiveOptimisticQueueItems()];
}

function getQueueOutstandingCount() {
  return (queueState && queueState.activeItem ? 1 : 0) + getEffectiveQueuePendingItems().length;
}

function getClearableQueueCount() {
  const protectedId = queueState && queueState.activeItem && queueState.activeItem.queueItemId
    || queueState && queueState.connectionWait && queueState.connectionWait.queueItemId
    || null;
  return getEffectiveQueuePendingItems()
    .filter((item) => !protectedId || item.queueItemId !== protectedId)
    .length;
}

function captureQueueOverlayScrollState(root) {
  const details = root && typeof root.querySelector === "function"
    ? root.querySelector("#queueOverlayDetails")
    : null;
  if (!details) return null;
  const scrollTop = Math.max(0, Number(details.scrollTop) || 0);
  const scrollHeight = Math.max(0, Number(details.scrollHeight) || 0);
  const clientHeight = Math.max(0, Number(details.clientHeight) || 0);
  return {
    scrollTop,
    stickToBottom: scrollHeight - scrollTop - clientHeight <= 12,
  };
}

function restoreQueueOverlayScrollState(root, state) {
  const details = root && state && typeof root.querySelector === "function"
    ? root.querySelector("#queueOverlayDetails")
    : null;
  if (!details) return;
  const maxScrollTop = Math.max(0, Number(details.scrollHeight) - Number(details.clientHeight));
  details.scrollTop = state.stickToBottom
    ? maxScrollTop
    : Math.min(Math.max(0, Number(state.scrollTop) || 0), maxScrollTop);
}

function isQueueVisible() {
  return !!(
    queueError ||
    (queueState && (queueState.activeItem || getQueueOutstandingCount() || ["paused", "pausing", "blocked", "action_required", "waiting_connection"].includes(queueState.status)))
  );
}

function getQueueStatusCopy() {
  const status = String(queueState && queueState.status || "idle");
  const active = queueState && queueState.activeItem;
  const count = getQueueOutstandingCount();
  const phase = active && (active.publicPhase || active.message) || "Waiting";
  if (queueError) return { title: "Queue update failed", message: "The queue could not be updated.", tone: "blocked" };
  const publicPhase = sanitizeRecentStatusText(phase) || "Retrieval in progress.";
  if (status === "action_required") return { title: "Action required", message: compactMeta([active && active.title, publicPhase]), tone: "action-required" };
  if (status === "waiting_connection") return { title: "Waiting for connection", message: "Retrying automatically.", tone: "paused" };
  if (status === "blocked" && String(queueState && queueState.blockedReason || "").includes("datacat_session_required")) {
    return { title: "Link Datacat", message: "Link Datacat to continue the queue.", tone: "blocked" };
  }
  if (status === "blocked") return { title: "Queue blocked", message: "Queue needs attention.", tone: "blocked" };
  if (status === "paused") return { title: "Queue stopped", message: `${count} waiting`, tone: "paused" };
  if (status === "pausing") return { title: "Pausing after current", message: compactMeta([active && active.title, publicPhase]), tone: "pausing" };
  return { title: "Queue running", message: compactMeta([count ? `${count} remaining` : null, active && active.title, publicPhase]), tone: "running" };
}

function getQueueOverlayDisplayItem() {
  return queueState && queueState.activeItem || getEffectiveQueuePendingItems()[0] || null;
}

function renderQueueOverlayItemList() {
  const active = queueState && queueState.activeItem ? queueState.activeItem : null;
  const activeKey = getQueueItemIdentity(active);
  const stopped = String(queueState && queueState.status || "") === "paused";
  const items = [
    ...(active ? [active] : []),
    ...getEffectiveQueuePendingItems().filter((item) => getQueueItemIdentity(item) !== activeKey),
  ];
  if (!items.length) return "";
  return `
    <div class="queue-overlay-list" aria-label="Retrieval queue">
      ${items.map((item) => {
        const sourceKind = normalizeSourceKind(item && item.sourceKind);
        const sourceDescriptor = getSourceDescriptor(sourceKind);
        const key = getQueueItemIdentity(item);
        const isActive = !!(active && key && key === activeKey);
        const title = compactText(item && item.title || "Queued character", 80);
        const waitingForConnection = String(queueState && queueState.status || "") === "waiting_connection" && item.queueItemId === queueState.connectionWait?.queueItemId;
        const status = isActive ? "Retrieving" : waitingForConnection ? "Waiting for connection" : stopped ? "Stopped" : "In queue";
        return `
          <div class="queue-overlay-item${isActive ? " is-active" : ""}">
            <span class="queue-overlay-source" aria-hidden="true">${escapeHtml(sourceDescriptor && sourceDescriptor.iconGlyph || "S")}</span>
            <span class="queue-overlay-item-copy">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(status)}</span>
            </span>
            <button
              class="queue-overlay-remove"
              type="button"
              data-action="queue-remove-item"
              data-queue-item-id="${escapeHtml(item && item.queueItemId || "")}"
              data-queue-key="${escapeHtml(key || "")}"
              aria-label="Remove ${escapeHtml(title)} from queue"
              title="Remove from queue"
            >×</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderQueueOverlayDetails() {
  const item = getQueueOverlayDisplayItem();
  const baseTransaction = item ? buildQueueTransaction(item) : null;
  const status = String(queueState && queueState.status || "idle");
  const stopped = status === "paused";
  const waitingForConnection = status === "waiting_connection";
  const waitingForDatacat = status === "blocked" && String(queueState && queueState.blockedReason || "").includes("datacat_session_required");
  const transaction = baseTransaction && stopped
    ? { ...baseTransaction, state: "paused", label: "STOPPED", message: "Ready to start.", phaseIndex: 0, active: false }
    : baseTransaction && waitingForConnection
      ? { ...baseTransaction, state: "paused", label: "WAITING FOR CONNECTION", message: "Retrying automatically.", phaseIndex: 0, active: false }
      : baseTransaction;
  const outstanding = getQueueOutstandingCount();
  const clearable = getClearableQueueCount();
  const canStop = outstanding > 0 && !["paused", "blocked", "waiting_connection"].includes(status);
  const canStart = outstanding > 0 && !waitingForDatacat && ["paused", "blocked", "waiting_connection"].includes(status);
  const activeRecentItem = buildActiveRecentItem();
  const activeRetrieval = activeRecentItem && activeRecentItem.retrieval && typeof activeRecentItem.retrieval === "object"
    ? activeRecentItem.retrieval
    : null;
  const jannyJob = activeRecentItem ? deriveRetrievalTransaction(activeRecentItem).jannyJob : null;
  return `
    <div class="queue-overlay-details" id="queueOverlayDetails">
      ${queueError ? `<div class="queue-overlay-error">The queue could not be updated.</div>` : ""}
      ${transaction ? `
        <div class="transaction-current-status" role="status">
          <strong>${escapeHtml(transaction.label)}</strong>
          <span>${escapeHtml(transaction.message)}</span>
        </div>
        ${renderTransactionStatusGroups(transaction, item.sourceKind)}
        ${renderRecentLogs(activeRetrieval && activeRetrieval.logs, false)}
      ` : ""}
      ${renderQueueOverlayItemList()}
      <div class="queue-overlay-actions">
        ${waitingForDatacat ? `<button class="mini-button is-primary" data-action="queue-link-datacat">Link Datacat</button>` : ""}
        ${canStart ? `<button class="mini-button is-primary" data-action="queue-start">${waitingForConnection ? "Try now" : "Start"}</button>` : ""}
        ${canStop ? `<button class="mini-button is-danger" data-action="queue-stop">Stop</button>` : ""}
        <button class="mini-button" data-action="queue-add-urls">Add URLs</button>
        ${clearable ? `<button class="mini-button is-danger" data-action="queue-clear-all">Clear all</button>` : ""}
        ${jannyJob && isJannyRecoveryJobActive(jannyJob) ? `<button class="mini-button" data-action="open-janny-recovery-tab" data-job-id="${escapeHtml(jannyJob.jobId || "")}">Open source page</button>` : ""}
        ${jannyJob && isJannyRecoveryJobActive(jannyJob) ? `<button class="mini-button" data-action="skip-janny-recovery" data-job-id="${escapeHtml(jannyJob.jobId || "")}">Continue without additional details</button>` : ""}
      </div>
    </div>
  `;
}

function buildQueueTransaction(item) {
  const root = item && typeof item === "object" ? item : {};
  const state = String(root.state || "pending");
  const phaseIndex = ["pending", "checking", "loading", "reading", "action_required", "interrupted"].includes(state)
    ? 0
    : state === "preparing"
      ? 1
      : state === "saving"
        ? 2
        : 3;
  const failed = state === "failed" || state === "interrupted";
  const terminal = ["completed", "already_available", "failed", "cancelled"].includes(state);
  return {
    state: state === "action_required" ? "action-required" : failed ? "failed" : terminal ? "completed" : "running",
    label: state === "action_required" ? "ACTION REQUIRED" : failed ? "FAILED" : terminal ? "COMPLETED" : "RUNNING",
    shortLabel: state === "already_available" ? "available" : state === "completed" ? "retrieved" : state.replace(/_/g, " "),
    message: sanitizeRecentStatusText(root.publicPhase || root.message) || "Retrieval in progress.",
    phaseIndex,
    active: !terminal,
    components: root.components || buildPendingComponents(root.sourceKind),
    upload: {},
  };
}
