"use strict";

/* ui/sidebar/views/retrieve.js — retrieve view render + helpers.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

function renderDetectedContextHeader(page) {
  const context = getDetectedSourceContext(page);
  return `
    <div class="detected-context">
      <span class="detected-source-badge ${escapeHtml(context.className)}">${escapeHtml(context.label)}</span>
      <div class="detected-content-type">${escapeHtml(getDetectedContentTypeLabel(page))}</div>
    </div>
  `;
}

function renderUploadVisibilitySelector(options = {}) {
  const privateSource = isCurrentSourceCharacterPrivate();
  const visibility = privateSource ? "mine" : normalizeUploadVisibility(uploadVisibility);
  const extraClass = options.className ? ` ${escapeHtml(options.className)}` : "";
  const disabled = privateSource || (typeof isCurrentPageTransactionActive === "function" && isCurrentPageTransactionActive());
  return `
    <div class="visibility-selector visibility-selector-buttons${extraClass}" role="radiogroup" aria-label="Pin to">
      <span class="visibility-caption">Pin to</span>
      <span class="visibility-options">
        <button class="visibility-option${visibility === "public" ? " is-active" : ""}" data-action="set-upload-visibility" data-visibility="public" type="button" role="radio" aria-checked="${visibility === "public" ? "true" : "false"}" ${disabled ? "disabled" : ""}>Public</button>
        <button class="visibility-option${visibility === "mine" ? " is-active" : ""}" data-action="set-upload-visibility" data-visibility="mine" type="button" role="radio" aria-checked="${visibility === "mine" ? "true" : "false"}" ${disabled ? "disabled" : ""}>Mine</button>
      </span>
    </div>
  `;
}

function renderPrivateVaultSourceWarning() {
  const visibility = getCurrentSourceCharacterVisibility();
  if (visibility !== "private" && visibility !== "unlisted") return "";
  return `<div class="private-source-note" role="status">Note: content saved to your private vault only</div>`;
}

function renderSourceVisibilityBadge() {
  const visibility = getCurrentSourceCharacterVisibility();
  if (visibility !== "private" && visibility !== "unlisted") return "";
  return `<span class="source-visibility-badge is-${escapeHtml(visibility)}">${escapeHtml(visibility.toUpperCase())}</span>`;
}

function renderComponentChecklistHtml(components, sourceKind, options = {}) {
  const items = normalizeComponentChecklist(components, sourceKind);
  const compact = options && options.compact === true;
  if (!items.length) return "";
  return `
    <div class="component-checklist-inner">
      ${items
        .map((item) => {
          const statusClass = getComponentStatusClass(item.status, item);
          return `
            <div class="component-check-item ${statusClass}">
              <span class="component-check-symbol">${escapeHtml(getComponentStatusSymbol(item.status, item))}</span>
              <span class="component-check-body">
                <span class="component-check-label">${escapeHtml(item.label)}</span>
                ${compact ? "" : `<span class="component-check-status">${escapeHtml(formatComponentChecklistStatus(item))}</span>`}
                ${!compact && item.message ? `<span class="component-check-message">${escapeHtml(item.message)}</span>` : ""}
              </span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCurrentComponentChecklist(retrieval, sourceKind) {
  if (!componentChecklist) return;
  const components = retrieval && retrieval.components ? retrieval.components : null;
  const html = renderComponentChecklistHtml(components, sourceKind);
  componentChecklist.hidden = !html;
  componentChecklist.innerHTML = html;
}

function renderUploadOptionsPanel() {
  if (!uploadOptionsPanel) return;
  const requestInline = uploadOptionsPanel.closest(".request-inline");
  const creatorPage = isCurrentCreatorPage();
  const transactionActive = isCurrentPageTransactionActive();
  const existing = !creatorPage && hasExistingAccessibleCharacter();
  if (requestInline) requestInline.classList.toggle("has-existing-character", existing);
  if (requestInline) requestInline.classList.toggle("has-creator-request", creatorPage);
  if (requestInline) requestInline.classList.toggle("has-active-transaction", transactionActive);
  if (creatorPage || transactionActive) {
    uploadOptionsPanel.innerHTML = "";
    return;
  }
  if (existing) {
    const primaryAction = getCurrentCharacterPrimaryAction();
    const datacatActionLabel = getCurrentDatacatActionLabel();
    const primaryLabel = primaryAction.kind === "view"
      ? datacatActionLabel
      : primaryAction.label;
    uploadOptionsPanel.innerHTML = `
      <div class="existing-datacat-row">
        <button class="existing-datacat-retrieve" data-action="${escapeHtml(primaryAction.action)}">${escapeHtml(primaryLabel)}</button>
        ${primaryAction.kind === "view" ? "" : `<button class="mini-button preflight-view-button existing-datacat-view" data-action="view-existing-datacat">${escapeHtml(datacatActionLabel)}</button>`}
      </div>
    `;
    return;
  }
  uploadOptionsPanel.innerHTML = "";
}

function updateRetrieveActions(canRetrieve) {
  const creatorPage = isCurrentCreatorPage();
  const existing = !creatorPage && hasExistingAccessibleCharacter();
  const transactionActive = isCurrentPageTransactionActive();
  const linkRequired = !datacatLoading && (!datacatState || datacatState.sessionReady !== true);
  retrieveButton.hidden = existing || creatorPage || transactionActive || linkRequired;
  retrieveButton.textContent = "Pin It!";
  retrieveButton.dataset.mode = "retrieve";
  retrieveButton.disabled = transactionActive || !canRetrieve;
  if (retrieveAgainLink) {
    retrieveAgainLink.hidden = true;
    retrieveAgainLink.disabled = transactionActive || !canRetrieve;
  }
}

function renderPreflightStatus() {
  if (!preflightStatus) return;
  preflightStatus.hidden = true;
  preflightStatus.innerHTML = "";
}

function renderCurrentPreflightInlineHtml() {
  const body = buildPreflightBody();
  if (!body) {
    return "";
  }
  let tone = "muted";
  let text = "";
  if (!datacatState || !datacatState.sessionReady) {
    return `
      <div class="current-page-note datacat-settings-note">
        <button class="datacat-settings-link" data-action="open-datacat-settings" type="button">Link Datacat in Settings</button>
      </div>
    `;
  } else if (preflightLoading) {
    text = "Checking Datacat...";
  } else if (preflightError) {
    tone = "danger";
    text = `Datacat check failed: ${preflightError}`;
  } else if (isCurrentDatacatCharacterCrossOwner()) {
    tone = "ok";
    text = "Already public on Datacat; pin to save it to your account.";
  } else if (hasExistingAccessibleCharacter()) {
    return "";
  } else if (preflightState && preflightState.success !== false) {
    tone = "ok";
    const creator = preflightState.creator || {};
    const freshness = creator.freshness || {};
    text = compactMeta([
      "Not on Datacat",
      creator.fresh === true ? "creator fresh" : creator.fresh === false ? "creator refresh needed" : null,
      freshness.ageLabel ? `age ${freshness.ageLabel}` : null,
    ]);
  } else {
    text = "Waiting for Datacat check.";
  }
  return text ? `<div class="current-page-note is-${escapeHtml(tone)}">${escapeHtml(text)}</div>` : "";
}

function isCurrentDatacatPreflightBlockingControls() {
  const body = buildPreflightBody();
  if (!body) return false;
  const key = buildPreflightKey(body);
  // Request-staleness bookkeeping stays in the sidebar: a resolved preflight for
  // a different character key is not yet a decision for this character.
  if (preflightKey !== key) return true;
  // The actual block/allow rule lives in shared/policy.js so it matches the
  // background gate; the sidebar only feeds it settled inputs.
  return SourceVaultPolicy.evaluatePreflightBlock({
    connected: !!(datacatState && datacatState.sessionReady),
    loading: preflightLoading === true,
    error: preflightError || null,
    preflight: preflightState || null,
  }).blocked;
}

function renderCurrentLocalSavedHint() {
  const item = getCurrentLocalSavedItem();
  if (!item || !item.id) return "";
  const summary = item.summary && typeof item.summary === "object" ? item.summary : {};
  const label = formatRelativeTime(item.updatedAt || item.savedAt || summary.capturedAt);
  return `
    <div class="current-local-history-row">
      <div class="current-local-history-hint">
        also saved locally${label ? ` ${escapeHtml(label)}` : ""}
      </div>
    </div>
  `;
}

function renderCurrentCharacterOverflowMenuHtml(localItem, options = {}) {
  if (!localItem || !localItem.id) return "";
  const canRetrieve = options.canRetrieve !== false;
  return `
    <details class="download-menu current-character-overflow-menu" data-download-menu-key="current-overflow:${escapeHtml(String(localItem.id).toLowerCase())}">
      <summary class="mini-button current-character-overflow-trigger" aria-label="More character actions" title="More character actions">${renderUiIcon("more-vertical")}</summary>
      <div class="download-menu-options current-character-overflow-options" role="menu" aria-label="Character actions">
        <button type="button" role="menuitem" data-action="retrieve-again-existing" ${canRetrieve ? "" : "disabled"}>Refresh Local Copy</button>
        <button type="button" role="menuitem" data-action="open-current-local-details">View local details</button>
      </div>
    </details>
  `;
}

function renderCurrentPageControlsHtml(canRetrieve) {
  const page = currentState && currentState.page ? currentState.page : null;
  const canAttemptRetrieve = canAttemptCurrentPageRetrieval();
  if (!page || page.unsupported || page.isDatacatSite || (!page.isCharacterPage && !page.isCreatorPage)) return "";
  if (page.isCreatorPage) return "";
  if (isCurrentPageTransactionActive()) return "";
  const currentCharacterId = getCurrentCharacterId();
  const queuedItem = [
    queueState && queueState.activeItem,
    ...(Array.isArray(queueState && queueState.pending) ? queueState.pending : []),
  ].find((item) => item && idsMatch(item.characterId, currentCharacterId));
  if (queuedItem) {
    const localItem = getCurrentLocalSavedItem();
    return `
      <div class="current-page-controls has-existing-character${localItem ? " has-local-actions" : ""}">
        <button class="primary" data-action="open-queue-item" data-queue-item-id="${escapeHtml(queuedItem.queueItemId)}">View queue</button>
        ${localItem ? renderDownloadMenuHtml(localItem, { label: "Download", className: "current-character-download" }) : ""}
        ${localItem ? renderCurrentCharacterOverflowMenuHtml(localItem, { canRetrieve: canAttemptRetrieve }) : ""}
      </div>
      <div class="current-page-note is-ok">This character is already in the retrieval queue.</div>
    `;
  }
  if (!hasExistingAccessibleCharacter() && isCurrentDatacatPreflightBlockingControls()) {
    return renderCurrentPreflightInlineHtml();
  }
  if (hasExistingAccessibleCharacter()) {
    const primaryAction = getCurrentCharacterPrimaryAction();
    const localItem = primaryAction.localItem;
    const localHintHtml = localItem ? renderCurrentLocalSavedHint() : "";
    const datacatActionLabel = getCurrentDatacatActionLabel();
    const owned = isCurrentDatacatCharacterOwned();
    const primaryLabel = primaryAction.kind === "view"
      ? datacatActionLabel
      : primaryAction.label;
    const primaryClass = primaryAction.kind === "view"
      ? "primary current-datacat-view-button"
      : "primary";
    return `
      <div class="current-page-controls has-existing-character${localItem ? " has-local-actions" : ""}">
        <button class="${primaryClass}" data-action="${escapeHtml(primaryAction.kind === "view" && getCurrentSourceQuality().degraded === true ? "open-current-datacat-reimagination" : primaryAction.action)}" ${primaryAction.kind === "view" || canAttemptRetrieve ? "" : "disabled"}>${escapeHtml(primaryLabel)}</button>
        ${localItem ? renderDownloadMenuHtml(localItem, { label: "Download", className: "current-character-download" }) : ""}
        ${primaryAction.kind === "view" ? "" : `<button class="mini-button existing-datacat-view" data-action="${getCurrentSourceQuality().degraded === true ? "open-current-datacat-reimagination" : "view-existing-datacat"}">${escapeHtml(datacatActionLabel)}</button>`}
        ${localItem ? renderCurrentCharacterOverflowMenuHtml(localItem, { canRetrieve: canAttemptRetrieve }) : ""}
      </div>
      ${localHintHtml}
      ${!owned ? `<div class="current-page-note is-ok">Already public on Datacat; pin to save it to your account.</div>` : ""}
    `;
  }
  const primaryAction = getCurrentCharacterPrimaryAction();
  const localItem = primaryAction.localItem;
  return `
    <div class="current-page-controls is-single-action${localItem ? " has-local-actions" : ""}">
      <div class="current-page-primary-actions${localItem ? " has-local-actions" : ""}">
        <button class="primary" data-action="${escapeHtml(primaryAction.action)}" ${canAttemptRetrieve ? "" : "disabled"}>${escapeHtml(primaryAction.label)}</button>
        ${localItem ? renderDownloadMenuHtml(localItem, { label: "Download", className: "current-character-download" }) : ""}
        ${localItem ? renderCurrentCharacterOverflowMenuHtml(localItem, { canRetrieve: canAttemptRetrieve }) : ""}
      </div>
    </div>
    ${localItem ? renderCurrentLocalSavedHint() : ""}
    ${renderPrivateVaultSourceWarning()}
    ${renderCurrentPreflightInlineHtml()}
  `;
}

function getCurrentPageTerminalMessage(retrieval, logs) {
  const root = retrieval && typeof retrieval === "object" ? retrieval : {};
  const rows = Array.isArray(logs) ? logs : [];
  if (root.error) return sanitizeRecentStatusText(root.error) || "Retrieval needs attention.";
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : {};
  const lastLog = rows.length ? sanitizeRecentLogEntry(rows[rows.length - 1]) : "";
  if (page.isCreatorPage && lastLog) return lastLog;
  if (page.isCreatorPage) return "Creator capture finished.";
  if (root.summary) return "Retrieved locally. Saving to Datacat...";
  if (lastLog) return lastLog;
  return "";
}

function renderCurrentPageStatusHtml() {
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : {};
  const pageRetrieval = currentState && currentState.retrieval && typeof currentState.retrieval === "object"
    ? currentState.retrieval
    : null;
  if (page.isCharacterPage && hasRetrievalActivity(pageRetrieval)) return "";
  const activeItem = buildActiveRecentItem();
  if (activeItem && deriveRetrievalTransaction(activeItem).active) return "";
  const retrieval = activeItem && activeItem.retrieval && typeof activeItem.retrieval === "object" ? activeItem.retrieval : null;
  const logs = retrieval && Array.isArray(retrieval.logs) ? retrieval.logs : [];
  const jannyJob = getVisibleJannyRecoveryJob(retrieval, activeItem && activeItem.isActive === true);
  const jannyActive = !!(jannyJob && isJannyRecoveryJobActive(jannyJob));
  const running = !!(retrieval && retrieval.running) || jannyActive;
  if (running) {
    dismissedCurrentPageStatusSignature = null;
    const title = jannyActive ? "Action Required" : "Retrieving";
    const message = jannyActive
      ? `Continue in the opened source page. Job ends in ${Math.max(0, Number(jannyJob.remainingSeconds || 0))}s.`
      : sanitizeRecentStatusText(retrieval && retrieval.message) || "Retrieval is running.";
    const rows = logs.length
      ? logs.slice(-7).reverse().map((entry) => sanitizeRecentLogEntry(entry)).filter(Boolean)
      : [message];
    const sourceKind = activeItem ? getRecentItemSourceKind(activeItem) : getCurrentSourceKind();
    const components = activeItem
      ? getItemComponentsForStatus(activeItem)
      : retrieval && retrieval.components ? retrieval.components : null;
    return `
      <div class="current-page-status is-running">
        <div class="current-page-status-head">
          <span class="kicker">Retrieving</span>
          <strong>${escapeHtml(title)}</strong>
        </div>
        <div class="current-page-status-message">${escapeHtml(message)}</div>
        ${renderComponentChecklistHtml(components, sourceKind)}
        <details class="activity-disclosure current-activity-disclosure" open>
          <summary>Activity <span>${rows.length}</span></summary>
          <div class="current-page-status-rows">
            ${rows.map((row) => `<div class="current-page-status-row">${escapeHtml(row)}</div>`).join("")}
          </div>
        </details>
        ${
          jannyActive
            ? `<div class="recent-actions retrieval-activity-actions">
                <button class="mini-button" data-action="open-janny-recovery-tab" data-job-id="${escapeHtml(jannyJob.jobId || "")}">Open source page</button>
                <button class="mini-button" data-action="skip-janny-recovery" data-job-id="${escapeHtml(jannyJob.jobId || "")}">Continue without additional details</button>
              </div>`
            : ""
        }
      </div>
    `;
  }
  if (retrieval && (retrieval.error || retrieval.summary || logs.length)) {
    if (dismissedCurrentPageStatusSignature === getCurrentPageTerminalSignature()) return "";
    const failed = !!retrieval.error;
    const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : {};
    const title = failed ? "Failed" : page.isCreatorPage ? "Creator ready" : "Saving to Datacat";
    const message = getCurrentPageTerminalMessage(retrieval, logs);
    if (message) {
      return `
        <div class="current-page-status ${failed ? "is-failed" : "is-completed"}">
          <div class="current-page-status-head">
            <span class="kicker">Retrieving</span>
            <strong>${escapeHtml(title)}</strong>
          </div>
          <div class="current-page-status-message">${escapeHtml(message)}</div>
        </div>
      `;
    }
  }
  const terminal = getMatchingCurrentPageTerminalState();
  if (!terminal || !terminal.message) return "";
  if (dismissedCurrentPageStatusSignature === getCurrentPageTerminalSignature()) return "";
  return `
    <div class="current-page-status is-${escapeHtml(terminal.tone)}">
      <div class="current-page-status-head">
        <span class="kicker">Retrieving</span>
        <strong>${escapeHtml(terminal.title)}</strong>
      </div>
      <div class="current-page-status-message">${escapeHtml(terminal.message)}</div>
    </div>
  `;
}

function getContextDestinationHost(value) {
  try {
    return new URL(String(value || "")).hostname;
  } catch (_) {
    return "";
  }
}

function getSourceHomeDestination(sourceKind) {
  const descriptor = getSourceDescriptor(sourceKind);
  const host = descriptor && Array.isArray(descriptor.hosts) ? descriptor.hosts.find(Boolean) : null;
  if (!descriptor || !host) return null;
  const label = descriptor.displayName || descriptor.label || descriptor.id || "Source";
  return {
    kind: descriptor.id || normalizeSourceKind(sourceKind) || "source",
    glyph: descriptor.iconGlyph || String(label).slice(0, 1),
    label: `${label} home`,
    description: "Open the source site",
    url: `https://${host}/`,
  };
}

function renderContextNavigationLink(destination, options = {}) {
  const root = destination && typeof destination === "object" ? destination : {};
  const current = options.current === true;
  const action = options.action || "open-context-destination";
  const kind = String(root.kind || root.id || "destination").replace(/[^a-z0-9_-]/gi, "").toLowerCase();
  const label = root.label || "Open destination";
  const glyph = root.glyph || String(label).slice(0, 2).toUpperCase();
  return `
    <button
      class="context-navigation-link is-${escapeHtml(kind)}${current ? " is-current" : ""}"
      data-action="${escapeHtml(action)}"
      data-url="${escapeHtml(root.url || "#")}"
      type="button"
      ${current ? 'aria-current="page"' : ""}
    >
      <span class="context-navigation-glyph" aria-hidden="true">${escapeHtml(glyph)}</span>
      <span class="context-navigation-copy">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(root.description || "Open in this tab")}</span>
      </span>
      ${current
        ? '<span class="context-navigation-current">Here</span>'
        : '<span class="context-navigation-arrow" aria-hidden="true">›</span>'}
    </button>
  `;
}

function isCurrentDatacatSection(section, page) {
  let currentPath = "";
  try {
    currentPath = new URL(String(page && (page.url || page.normalizedUrl) || "")).pathname.toLowerCase();
  } catch (_) {}
  const sectionId = String(section && (section.id || section.label) || "").trim().toLowerCase();
  if (!currentPath || !sectionId) return false;
  if (sectionId === "fresh") return currentPath === "/" || currentPath.startsWith("/fresh");
  if (sectionId === "characters") return currentPath.startsWith("/characters");
  return currentPath.startsWith(`/${sectionId}`);
}

function renderDatacatSectionsCard(page) {
  const sections = Array.isArray(page && page.datacatSections) ? page.datacatSections : [];
  const datacatUrl = (page && (page.url || page.datacatOrigin)) || buildDatacatUrl("/");
  const host = getContextDestinationHost(datacatUrl) || "your Datacat site";
  const sectionRows = sections
    .map((section) => renderContextNavigationLink(
      { ...section, kind: `datacat-${section.id || section.label || "section"}` },
      { action: "open-datacat-section", current: isCurrentDatacatSection(section, page) },
    ))
    .join("");
  return `
    ${renderDetectedContextHeader(page)}
    <div class="context-state-card datacat-home-card">
      <div class="context-state-hero">
        <div class="context-state-mark is-datacat" aria-hidden="true">D</div>
        <div class="context-state-copy">
          <div class="context-state-eyebrow">${escapeHtml(host)}</div>
          <div class="context-state-title">Your Datacat</div>
          <div class="context-state-description">Jump to another section without leaving this tab.</div>
        </div>
      </div>
      <nav class="context-navigation-list" aria-label="Datacat sections">
        ${sectionRows || `<div class="context-navigation-empty">Set a Datacat site URL in Settings to show its sections.</div>`}
      </nav>
    </div>
  `;
}

function renderSourceRouteGuideCard(page) {
  const sourceKind = normalizeSourceKind(page && page.sourceKind);
  const descriptor = getSourceDescriptor(sourceKind);
  if (!sourceKind || !descriptor) return renderUnsupportedCard(page);
  const label = descriptor.displayName || descriptor.label || descriptor.id || "Source";
  const sourceHome = getSourceHomeDestination(sourceKind);
  const destinations = [
    sourceHome,
    {
      kind: "datacat",
      glyph: "D",
      label: "Datacat",
      description: "Return to your pinned library",
      url: buildDatacatUrl("/"),
    },
  ].filter(Boolean);
  const capabilities = [
    descriptor.capabilities && descriptor.capabilities.character ? "Character pages" : null,
    descriptor.capabilities && descriptor.capabilities.creator ? "Creator profiles" : null,
  ].filter(Boolean);
  return `
    ${renderDetectedContextHeader(page)}
    <div class="context-state-card source-route-guide">
      <div class="context-state-hero">
        <div class="context-state-mark is-${escapeHtml(sourceKind)}" aria-hidden="true">${escapeHtml(descriptor.iconGlyph || String(label).slice(0, 1))}</div>
        <div class="context-state-copy">
          <div class="context-state-eyebrow">Supported source · other page</div>
          <div class="context-state-title">Nothing to pin on this ${escapeHtml(label)} page</div>
          <div class="context-state-description">Open a character or creator profile and Pincat will recognize it automatically.</div>
        </div>
      </div>
      ${capabilities.length ? `<div class="context-capability-list" aria-label="Supported page types">${capabilities.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
      <nav class="context-navigation-list" aria-label="Where to go next">
        ${destinations.map((destination) => renderContextNavigationLink(destination)).join("")}
      </nav>
    </div>
  `;
}

function renderUnsupportedCard(page) {
  if (page && page.managedRetrievalWindow) {
    return `
      ${renderDetectedContextHeader(page)}
      <div class="current-card-main">
        <div class="current-avatar current-avatar-placeholder">P</div>
        <div>
          <div class="character-name">Managed retrieval window</div>
          <div class="character-id">Use Activity to monitor the shared queue.</div>
        </div>
      </div>
    `;
  }
  const host = page && page.hostname ? page.hostname : "this website";
  const destinations = [
    {
      kind: "datacat",
      glyph: "D",
      label: "Datacat",
      description: "Open your pinned library",
      url: buildDatacatUrl("/"),
    },
    getSourceHomeDestination("janitor"),
    getSourceHomeDestination("saucepan"),
  ].filter(Boolean);
  return `
    ${renderDetectedContextHeader(page)}
    <div class="context-state-card unsupported-site-guide">
      <div class="context-state-hero">
        <div class="context-state-mark is-unknown" aria-hidden="true">P</div>
        <div class="context-state-copy">
          <div class="context-state-eyebrow">Current tab · ${escapeHtml(host)}</div>
          <div class="context-state-title">Pincat is ready when you are</div>
          <div class="context-state-description">This website is not a supported source. Choose a destination to continue.</div>
        </div>
      </div>
      <nav class="context-navigation-list" aria-label="Supported destinations">
        ${destinations.map((destination) => renderContextNavigationLink(destination)).join("")}
      </nav>
    </div>
  `;
}

function renderUnifiedBlockingLoaderHtml(title, message) {
  return `
    <div class="unified-blocking-loader" role="status" aria-live="polite">
      <div class="unified-blocking-spinner" aria-hidden="true"></div>
      <div class="unified-blocking-copy">
        <div class="character-name">${escapeHtml(title || "Loading page...")}</div>
        <div class="character-id">${escapeHtml(message || "Waiting for the source page to settle.")}</div>
      </div>
    </div>
  `;
}

function renderCurrentPageBlockingCard(page, title, message) {
  return renderUnifiedBlockingLoaderHtml(title, message);
}

function getCurrentPageBlockingRenderKey(page) {
  const root = page && typeof page === "object" ? page : {};
  return JSON.stringify({
    url: root.normalizedUrl || root.url || "",
    sourceKind: normalizeSourceKind(root.sourceKind) || (root.isDatacatSite ? "datacat" : "unknown"),
    type: root.isCreatorPage ? "creator" : root.isCharacterPage ? "character" : root.isDatacatSite ? "datacat" : "unknown",
  });
}

function renderCurrentPageCard() {
  if (!characterPanel) return;
  const state = currentState || null;
  const character = state && state.character ? state.character : null;
  const page = state && state.page ? state.page : null;
  const retrieval = state && state.retrieval ? state.retrieval : null;
  const sourceAccountGate = getCurrentSourceAccountGate();
  const sourceBlockStatus = renderSourceAccountBlockStatus(sourceAccountGate);
  characterPanel.hidden = false;
  if (page && page.isCreatorPage) {
    renderAccountGatePanel();
    applySourceAccountGateVisualState(sourceAccountGate);
    updateRetrieveActions(false);
    if (captureButton) captureButton.disabled = true;
    characterPanel.hidden = true;
    characterPanel.innerHTML = "";
    return;
  }
  const characterSettling = !!(page && page.isCharacterPage && !isCharacterStateSettled(character, page));
  let currentPageHtml = "";
  let currentPageBlocking = false;
  if (page && page.unsupported) {
    currentPageHtml = renderUnsupportedCard(page);
  } else if (page && page.pendingNavigation) {
    currentPageBlocking = true;
    currentPageHtml = renderCurrentPageBlockingCard(
      page,
      "Loading page...",
      "Waiting for the source page to settle.",
    );
  } else if (page && page.isDatacatSite) {
    currentPageHtml = renderDatacatSectionsCard(page);
  } else if (!page || !page.isCharacterPage) {
    currentPageHtml = renderSourceRouteGuideCard(page);
  } else if (!character || characterSettling) {
    currentPageBlocking = true;
    currentPageHtml = renderCurrentPageBlockingCard(page, "Loading page...", "Waiting for the source page to settle.");
  } else {
    const avatarUrl = shouldRenderDetectedAvatar(page, character) ? getCharacterAvatarUrl(character, page.sourceKind) : null;
    const characterId = character.id || character.characterId || character.companionId || "";
    currentPageHtml = `
      ${renderDetectedContextHeader(page)}
      <div class="current-card-main">
        ${
          avatarUrl
            ? `<img class="current-avatar" src="${escapeHtml(avatarUrl)}" alt="">`
            : `<div class="current-avatar current-avatar-placeholder">${escapeHtml(getCharacterInitial(character))}</div>`
        }
        <div class="current-card-copy">
          <div class="character-name-row">
            <div class="character-name">${escapeHtml(character.name || "Unknown character")}</div>
            ${renderSourceVisibilityBadge()}
            ${renderSourceQualityBadge(getCurrentSourceQuality())}
          </div>
          ${
            character.creatorName || character.creatorHandle || character.creatorId
              ? `<button class="inline-creator-link" data-action="open-current-creator" ${renderCreatorLinkAttributes(character, page)}>${escapeHtml(`by ${character.creatorName || character.creatorHandle || character.creatorId}`)}</button>`
              : ""
          }
          <div class="character-id">${escapeHtml(characterId)}</div>
          ${sourceBlockStatus}
        </div>
      </div>
    `;
  }
  if (currentPageBlocking) {
    if (accountGatePanel) {
      accountGatePanel.hidden = true;
      accountGatePanel.innerHTML = "";
    }
    applySourceAccountGateVisualState({ required: false, allowed: true });
  } else {
    renderAccountGatePanel();
    applySourceAccountGateVisualState(sourceAccountGate);
  }
  const canRetrieve = canRetrieveCurrentPage();
  updateRetrieveActions(currentPageBlocking ? false : canRetrieve);
  captureButton.disabled = !(retrieval && retrieval.summary);
  const blockingRenderKey = currentPageBlocking ? getCurrentPageBlockingRenderKey(page) : "";
  if (currentPageBlocking && characterPanel.dataset.blockingRenderKey === blockingRenderKey) {
    renderCurrentComponentChecklist(null, page && page.sourceKind);
    if (statusLine) statusLine.textContent = (retrieval && retrieval.message) || "Idle";
    if (summaryLine) summaryLine.textContent = (retrieval && (retrieval.summary || retrieval.error)) || "";
    return;
  }
  characterPanel.dataset.blockingRenderKey = blockingRenderKey;
  replaceDownloadMenuAwareHtml(characterPanel, `
    <div class="panel-header current-page-section-header">
      <div>
        <div class="kicker">Current Page</div>
      </div>
    </div>
    ${currentPageHtml}
    ${currentPageBlocking ? "" : renderCurrentSourceQualityNote()}
    ${currentPageBlocking ? "" : renderCurrentPageControlsHtml(canRetrieve)}
    ${currentPageBlocking ? "" : renderCurrentPageStatusHtml()}
  `);
  renderCurrentComponentChecklist(currentPageBlocking ? null : retrieval, page && page.sourceKind);
  if (statusLine) statusLine.textContent = (retrieval && retrieval.message) || "Idle";
  if (summaryLine) summaryLine.textContent = (retrieval && (retrieval.summary || retrieval.error)) || "";
  const logs = retrieval && Array.isArray(retrieval.logs) ? retrieval.logs.slice(-12).reverse() : [];
  if (logList) {
    logList.innerHTML = logs
      .map((entry) => {
        return `<div class="log-row"><span>${escapeHtml(entry.stage)}</span>${escapeHtml(entry.message)}</div>`;
      })
      .join("");
  }
}
