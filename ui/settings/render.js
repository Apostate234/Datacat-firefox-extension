"use strict";

// Pincat settings — DOM rendering + pure formatting helpers.
// Loaded before ui/settings/index.js; only defines functions here (no calls at
// load time). Element refs and the mutable state fields live in index.js and
// share the global lexical scope across the ordered <script> tags.

function normalizeUploadVisibility(value) {
  return String(value || "").trim().toLowerCase() === "mine" ? "mine" : "public";
}

function normalizeJobTimeoutMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(30, Math.round(parsed)));
}

function normalizeDatacatOriginValue(value) {
  const fallback = "https://datacat.run";
  return parseDatacatOriginValue(value) || fallback;
}

function parseDatacatOriginValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_) {
    return null;
  }
}

function getConfiguredDatacatOrigin() {
  const inputOrigin = originInput ? originInput.value : "";
  const stateOrigin = datacatState && typeof datacatState === "object" ? datacatState.origin : "";
  return normalizeDatacatOriginValue(inputOrigin || stateOrigin || "https://datacat.run");
}

function updateExtensionDownloadLink() {
  if (latestExtensionDownloadLink) latestExtensionDownloadLink.removeAttribute("href");
  if (latestExtensionDownloadUrl) latestExtensionDownloadUrl.textContent = "";
}

function compactMeta(parts) {
  return parts.filter((part) => part != null && String(part).trim() !== "").join(" · ");
}

function formatConnectionTime(value) {
  if (!value) return "not yet verified";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "at an unknown time";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleString();
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[index]}`;
}

function setStatus(text, tone) {
  datacatStatusText.textContent = text || "";
  datacatStatusText.classList.toggle("is-ok", tone === "ok");
  datacatStatusText.classList.toggle("is-danger", tone === "danger");
}

function renderDatacatOriginAction() {
  const configuredOrigin = normalizeDatacatOriginValue(
    datacatState && datacatState.origin ? datacatState.origin : "https://datacat.run",
  );
  if (datacatConnectionOrigin) datacatConnectionOrigin.textContent = configuredOrigin;
  if (originDisplayRow) originDisplayRow.hidden = datacatOriginEditing;
  if (originEditor) originEditor.hidden = !datacatOriginEditing;
  if (editOriginButton) editOriginButton.disabled = datacatOriginEditing;
  if (!saveOriginButton) return;
  const rawInput = String(originInput ? originInput.value : configuredOrigin).trim();
  const inputOrigin = parseDatacatOriginValue(rawInput);
  const changed = !!rawInput && inputOrigin !== configuredOrigin;
  saveOriginButton.disabled = !datacatOriginEditing || !inputOrigin || !changed;
  saveOriginButton.textContent = "Save";
}

function setDatacatConnectionTone(tone) {
  if (!datacatConnectionBadge) return;
  datacatConnectionBadge.classList.toggle("is-ok", tone === "ok");
  datacatConnectionBadge.classList.toggle("is-warning", tone === "warning");
  datacatConnectionBadge.classList.toggle("is-danger", tone === "danger");
  datacatConnectionBadge.classList.toggle("is-pending", tone === "pending");
}

function renderDatacatCheckingState() {
  if (datacatState && typeof datacatState === "object" && datacatState.linkStatus !== "unlinked") {
    renderDatacatState();
    if (checkDatacatButton) checkDatacatButton.disabled = true;
    setStatus(compactMeta([
      "Checking the Datacat link...",
      datacatState.lastVerifiedAt ? `Last verified ${formatConnectionTime(datacatState.lastVerifiedAt)}` : null,
    ]), "");
    return;
  }
  if (datacatConnectionBadge) datacatConnectionBadge.textContent = "CHECKING";
  if (datacatConnectionIdentity) datacatConnectionIdentity.textContent = "Checking selected site...";
  setDatacatConnectionTone("pending");
  if (checkDatacatButton) checkDatacatButton.disabled = true;
  setStatus("Checking the selected Datacat site and extension session...", "");
}

function renderDatacatState() {
  const state = datacatState || {};
  if (originInput && document.activeElement !== originInput) {
    originInput.value = state.origin || "https://datacat.run";
  }
  updateExtensionDownloadLink();
  const user = state.user && typeof state.user === "object" ? state.user : null;
  const userLabel = user ? String(user.username || user.email || user.uuid || user.id || "").trim() || null : null;
  const connected = state.connected === true || state.authenticated === true || state.canUpload === true;
  const linkStatus = String(state.linkStatus || (connected ? "linked" : state.ok === false ? "unreachable" : "unlinked"));
  const linked = linkStatus === "linked" && connected;
  const registered = linked && state.registered === true;
  const anonymous = linked && (state.anonymous === true || !registered);
  const unreachable = linkStatus === "unreachable";
  const requiresRelink = linkStatus === "relink_required";
  const hasLinkRecord = linked || unreachable || requiresRelink || state.linked === true;
  const lastVerified = state.lastVerifiedAt ? formatConnectionTime(state.lastVerifiedAt) : null;
  if (datacatConnectionOrigin) {
    datacatConnectionOrigin.textContent = state.origin || getConfiguredDatacatOrigin();
  }
  if (datacatConnectionBadge) {
    datacatConnectionBadge.textContent = linked
      ? "LINKED"
      : unreachable
        ? "OFFLINE"
        : requiresRelink
          ? "RECONNECT"
          : "NOT LINKED";
  }
  if (datacatConnectionIdentity) {
    datacatConnectionIdentity.textContent = unreachable
      ? `Datacat unavailable; link retained${userLabel ? ` for ${userLabel}` : ""}`
      : requiresRelink
        ? `Datacat link requires reconnection${userLabel ? ` for ${userLabel}` : ""}`
      : registered
        ? `Linked to Datacat as ${userLabel || "Datacat user"}`
        : anonymous
          ? "Linked to Datacat anonymously"
          : "Datacat is not linked yet";
  }
  setDatacatConnectionTone(unreachable || requiresRelink ? "danger" : registered ? "ok" : anonymous ? "warning" : "pending");
  if (loginDatacatButton) {
    loginDatacatButton.hidden = linked;
    loginDatacatButton.textContent = requiresRelink || unreachable ? "Reconnect" : "Link Datacat";
  }
  if (unlinkDatacatButton) unlinkDatacatButton.hidden = !hasLinkRecord;
  if (checkDatacatButton) {
    checkDatacatButton.hidden = !hasLinkRecord;
    checkDatacatButton.disabled = false;
  }
  setStatus(compactMeta([
    state.message || null,
    lastVerified ? `Last verified ${lastVerified}` : null,
  ]), linked ? "ok" : unreachable || requiresRelink ? "danger" : "");
  renderDatacatOriginAction();
}

function renderUploadVisibility() {
  visibilityButtons.forEach((button) => {
    const active = normalizeUploadVisibility(button.getAttribute("data-visibility")) === uploadVisibility;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function renderJobTimeout() {
  if (jobTimeoutMinutesInput && document.activeElement !== jobTimeoutMinutesInput) {
    jobTimeoutMinutesInput.value = String(normalizeJobTimeoutMinutes(jobTimeoutMinutes));
  }
}

function renderAppearance() {
  skinButtons.forEach((button) => {
    const active = String(button.getAttribute("data-skin") || "") === uiSkin;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
  });
  if (debugPanelToggle) {
    debugPanelToggle.classList.toggle("is-active", debugPanelVisible);
    debugPanelToggle.setAttribute("aria-checked", debugPanelVisible ? "true" : "false");
    const label = debugPanelToggle.querySelector(".settings-switch-label");
    if (label) label.textContent = debugPanelVisible ? "Shown" : "Hidden";
  }
}

function renderStorageStats() {
  if (!storageStatsGrid) return;
  const stats = storageStats || {};
  const totalBytes = stats.totalBytes != null
    ? stats.totalBytes
    : (Number(stats.localBytes) || 0) + (Number(stats.sessionBytes) || 0);
  storageStatsGrid.innerHTML = `
    <div class="storage-stat">
      <span>Used</span>
      <strong>${escapeHtml(formatBytes(totalBytes))}</strong>
      <small>${escapeHtml(compactMeta([`local ${formatBytes(stats.localBytes)}`, `session ${formatBytes(stats.sessionBytes)}`]))}</small>
    </div>
    <div class="storage-stat">
      <span>Thumbnails</span>
      <strong>${escapeHtml(formatBytes(stats.thumbnailBytes))}</strong>
      <small>${escapeHtml(`${Number(stats.thumbnailCount) || 0} cached`)}</small>
    </div>
    <div class="storage-stat">
      <span>Keys</span>
      <strong>${escapeHtml(String((Number(stats.localKeyCount) || 0) + (Number(stats.sessionKeyCount) || 0)))}</strong>
      <small>${escapeHtml(compactMeta([`local ${Number(stats.localKeyCount) || 0}`, `session ${Number(stats.sessionKeyCount) || 0}`]))}</small>
    </div>
    <div class="storage-stat">
      <span>Queue</span>
      <strong>${escapeHtml(String(Number(stats.queueOutstandingCount) || 0))}</strong>
      <small>${escapeHtml(compactMeta([stats.queueStatus || "idle", `${Number(stats.queueFinishedCount) || 0} finished`]))}</small>
    </div>
  `;
}

function normalizeSourceKind(value) {
  if (SourceRegistry && typeof SourceRegistry.normalizeSourceId === "function") {
    return SourceRegistry.normalizeSourceId(value) || "";
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "sauce" || normalized === "saucepan") return "saucepan";
  if (normalized === "janitor" || normalized === "janitorai" || normalized === "janny") return "janitor";
  return "";
}

function sourceLabel(value) {
  if (SourceRegistry && typeof SourceRegistry.get === "function") {
    const provider = SourceRegistry.get(value);
    if (provider && (provider.displayName || provider.label)) return provider.displayName || provider.label;
  }
  return normalizeSourceKind(value) === "saucepan" ? "Saucepan" : "Janitor";
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function formatSourceAccountState(value) {
  const state = String(value || "");
  if (state === "confirmed_dedicated") return "APPROVED";
  if (state === "rejected") return "REJECTED";
  if (state === "source_login_required") return "NOT LOGGED IN";
  if (state === "source_account_unknown") return "UNKNOWN ACCOUNT";
  return "NEEDS CONFIRMATION";
}

function getSourceAccountRecord(accountKey) {
  if (sourceAccountApprovals && sourceAccountApprovals[accountKey]) return sourceAccountApprovals[accountKey];
  for (const session of Object.values(sourceAccountSessions || {})) {
    const gate = session && session.gate && typeof session.gate === "object" ? session.gate : null;
    const account = gate && gate.account && typeof gate.account === "object" ? gate.account : null;
    if (account && account.key === accountKey) {
      return {
        ...account,
        sourceKind: account.sourceKind || gate.sourceKind || session.sourceKind,
        state: gate.reason === "source_account_rejected" ? "rejected" : gate.allowed ? "confirmed_dedicated" : "pending_confirmation",
      };
    }
  }
  return null;
}

function getCurrentSourceAccountRecord(sourceKind) {
  const session = sourceAccountSessions && sourceAccountSessions[sourceKind] && typeof sourceAccountSessions[sourceKind] === "object"
    ? sourceAccountSessions[sourceKind]
    : null;
  const gate = session && session.gate && typeof session.gate === "object" ? session.gate : null;
  if (!gate) return null;
  const account = gate.account && typeof gate.account === "object" ? gate.account : null;
  if (!account) {
    return {
      key: `current-${sourceKind}`,
      sourceKind,
      label: `${sourceLabel(sourceKind)} session`,
      state: gate.reason || "source_login_required",
      readonly: true,
      current: true,
      message: gate.reason === "source_login_required"
        ? `No logged-in ${sourceLabel(sourceKind)} session detected.`
        : "Could not identify the logged-in source account.",
    };
  }
  const saved = sourceAccountApprovals && sourceAccountApprovals[account.key] && typeof sourceAccountApprovals[account.key] === "object"
    ? sourceAccountApprovals[account.key]
    : null;
  const state = saved && saved.state
    ? saved.state
    : gate.reason === "source_account_rejected"
      ? "rejected"
      : gate.allowed
        ? "confirmed_dedicated"
        : "pending_confirmation";
  return {
    ...account,
    ...(saved || {}),
    sourceKind: account.sourceKind || gate.sourceKind || sourceKind,
    state,
    current: true,
    message: state === "confirmed_dedicated"
      ? `Logged into ${sourceLabel(sourceKind)} as ${account.label || account.id || "detected account"}.`
      : state === "rejected"
        ? `Current ${sourceLabel(sourceKind)} session is not approved for Pincat saves.`
        : `Current ${sourceLabel(sourceKind)} session needs confirmation before Pincat saves.`,
  };
}

function sourceAccountTone(state) {
  if (state === "confirmed_dedicated") return "is-ok";
  if (state === "rejected") return "is-danger";
  if (state === "source_login_required" || state === "source_account_unknown") return "is-muted";
  return "is-pending";
}

function renderSourceAccountRow(approval, options = {}) {
  const isReadonly = approval.readonly === true;
  const stateLabel = formatSourceAccountState(approval.state);
  const tone = sourceAccountTone(approval.state);
  const meta = compactMeta([
    approval.current ? "Current session" : "Saved decision",
    sourceLabel(approval.sourceKind),
    approval.decidedAt || null,
  ]);
  const action = approval.state === "confirmed_dedicated"
    ? { state: "rejected", label: "Reject", tone: "danger" }
    : approval.state === "rejected"
      ? { state: "confirmed_dedicated", label: "Approve", tone: "ok" }
      : { state: "review", label: "Review", tone: "ok" };
  return `
    <div class="source-account-row ${tone}">
      <div class="source-account-copy">
        <div class="source-account-title-row">
          <div class="source-account-title">${escapeHtml(approval.label || approval.id || "Saved account")}</div>
          <span class="source-account-state ${tone}">${escapeHtml(stateLabel)}</span>
        </div>
        <div class="source-account-meta">${escapeHtml(meta)}</div>
        ${approval.message ? `<div class="source-account-message">${escapeHtml(approval.message)}</div>` : ""}
      </div>
      ${isReadonly ? "" : `
        <div class="source-account-actions">
          <button class="mini-button ${action.tone}" data-source-account-action="${action.state}" data-account-key="${escapeHtml(approval.key || "")}">${action.label}</button>
        </div>
      `}
    </div>
  `;
}

function renderSourceAccountSection(sourceKind, rows) {
  const current = getCurrentSourceAccountRecord(sourceKind);
  const currentKey = current && current.key ? current.key : null;
  const savedRows = rows.filter((approval) => approval.key !== currentKey);
  const renderedRows = [
    current ? renderSourceAccountRow(current) : "",
    ...savedRows.map((approval) => renderSourceAccountRow(approval)),
  ].filter(Boolean);
  return `
    <section class="source-account-group" data-source-kind="${escapeHtml(sourceKind)}">
      <div class="source-account-group-title">${escapeHtml(sourceLabel(sourceKind))} sessions</div>
      <div class="source-account-group-list">
        ${renderedRows.length
          ? renderedRows.join("")
          : `<div class="source-account-empty">No ${escapeHtml(sourceLabel(sourceKind))} sessions recorded yet.</div>`}
      </div>
    </section>
  `;
}

function renderSourceAccountApprovals() {
  if (!sourceAccountList || !sourceAccountStatus) return;
  const approvals = Object.values(sourceAccountApprovals || {})
    .filter((item) => item && typeof item === "object")
    .sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || "")));
  const providerIds = SourceRegistry && typeof SourceRegistry.list === "function"
    ? SourceRegistry.list().map((provider) => provider.id)
    : ["janitor", "saucepan"];
  const sourceKinds = Array.from(new Set([
    ...providerIds,
    ...Object.keys(sourceAccountSessions || {}).map(normalizeSourceKind).filter(Boolean),
    ...approvals.map((approval) => normalizeSourceKind(approval.sourceKind)).filter(Boolean),
  ]));
  const openSessionCount = Object.values(sourceAccountSessions || {}).filter(Boolean).length;
  sourceAccountStatus.textContent = compactMeta([
    `${openSessionCount} current source session${openSessionCount === 1 ? "" : "s"} checked`,
    approvals.length
      ? `${approvals.length} saved decision${approvals.length === 1 ? "" : "s"}`
      : "No saved decisions yet",
  ]);
  sourceAccountList.innerHTML = sourceKinds
    .map((sourceKind) => renderSourceAccountSection(
      sourceKind,
      approvals.filter((approval) => normalizeSourceKind(approval.sourceKind) === sourceKind),
    ))
    .join("");
}

function closeSourceAccountConfirmModal() {
  pendingSourceAccountDecision = null;
  if (!sourceAccountConfirmModal) return;
  sourceAccountConfirmModal.hidden = true;
  sourceAccountConfirmModal.classList.remove("is-ok", "is-danger");
  if (sourceAccountConfirmApply) {
    sourceAccountConfirmApply.classList.remove("ok", "danger");
    sourceAccountConfirmApply.textContent = "Confirm";
  }
  if (sourceAccountConfirmReject) sourceAccountConfirmReject.hidden = true;
}

function openSourceAccountConfirmModal(accountKey, state) {
  const approval = getSourceAccountRecord(accountKey);
  if (!approval || !sourceAccountConfirmModal || !sourceAccountConfirmTitle || !sourceAccountConfirmText || !sourceAccountConfirmApply) return;
  const isReview = state === "review";
  const isOk = state === "confirmed_dedicated" || isReview;
  const label = approval.label || approval.id || "this account";
  const source = sourceLabel(approval.sourceKind);
  pendingSourceAccountDecision = { accountKey, state: isReview ? "confirmed_dedicated" : state };
  sourceAccountConfirmModal.hidden = false;
  sourceAccountConfirmModal.classList.toggle("is-ok", isOk);
  sourceAccountConfirmModal.classList.toggle("is-danger", !isOk);
  sourceAccountConfirmTitle.textContent = isOk
    ? `Use ${label} for retrieval?`
    : `Reject ${label}?`;
  if (isOk) {
    const emphasis = document.createElement("strong");
    emphasis.textContent = `separate ${source} account created for Pincat`;
    sourceAccountConfirmText.replaceChildren(
      document.createTextNode("Only use a "),
      emphasis,
      document.createTextNode("."),
    );
  } else {
    sourceAccountConfirmText.textContent = "This account will be blocked from retrieval until approved again.";
  }
  sourceAccountConfirmApply.textContent = isOk ? "Use this account" : "Reject";
  sourceAccountConfirmApply.classList.toggle("ok", isOk);
  sourceAccountConfirmApply.classList.toggle("danger", !isOk);
  if (sourceAccountConfirmReject) sourceAccountConfirmReject.hidden = !isReview;
  sourceAccountConfirmApply.focus();
}
