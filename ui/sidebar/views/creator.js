function syncInspectionDialogAttributes(panel) {
  if (!panel) return;
  if (inspectionState.active) {
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Saved character details");
    return;
  }
  panel.removeAttribute("role");
  panel.removeAttribute("aria-modal");
  panel.removeAttribute("aria-label");
}

function renderRetrievedDetail(item, target = currentDetailsPanel) {
  const panel = target || currentDetailsPanel || retrievedPanel;
  if (!panel) return;
  panel.hidden = false;
  panel.className = `panel current-details-panel${inspectionState.active ? " is-inspection-overlay" : ""}`;
  syncInspectionDialogAttributes(panel);
  panel.dataset.detailsLoadingRenderKey = "";
  const summary = item && item.summary ? item.summary : {};
  const capture = item && item.capture && typeof item.capture === "object" ? item.capture : {};
  const sourceKind = summary.sourceKind || capture.sourceKind || (capture.saucepanCore ? "saucepan" : "janitor");
  const core = capture.janitorCore && typeof capture.janitorCore === "object" ? capture.janitorCore : {};
  const coreCharacter = core.character && typeof core.character === "object" ? core.character : {};
  const coreChat = core.chat && typeof core.chat === "object" ? core.chat : {};
  const coreGenerate = core.generateAlpha && typeof core.generateAlpha === "object" ? core.generateAlpha : {};
  const coreScripts = core.scripts && typeof core.scripts === "object" ? core.scripts : {};
  const coreSections = coreCharacter.sections && typeof coreCharacter.sections === "object" ? coreCharacter.sections : {};
  const janny = capture.janny && typeof capture.janny === "object" ? capture.janny : {};
  const jannyDetail = janny.detail && typeof janny.detail === "object" ? janny.detail : {};
  const jannyCharacter = janny.character && typeof janny.character === "object" ? janny.character : {};
  const creator = capture.creator && typeof capture.creator === "object" ? capture.creator : {};
  const creatorProfile = creator.profile && typeof creator.profile === "object" ? creator.profile : {};
  const creatorList = creator.characterList && typeof creator.characterList === "object" ? creator.characterList : {};
  const creatorCharacters = Array.isArray(creatorList.characters) ? creatorList.characters : [];
  const saucepanCore = capture.saucepanCore && typeof capture.saucepanCore === "object" ? capture.saucepanCore : {};
  const saucepanCompanion = saucepanCore.companion && typeof saucepanCore.companion === "object" ? saucepanCore.companion : {};
  const saucepanRawCompanion =
    saucepanCompanion.rawCompanion && typeof saucepanCompanion.rawCompanion === "object" ? saucepanCompanion.rawCompanion : {};
  const saucepanDefinition = saucepanCore.definition && typeof saucepanCore.definition === "object" ? saucepanCore.definition : {};
  const saucepanDefinitionStatus =
    saucepanDefinition.status && typeof saucepanDefinition.status === "object" ? saucepanDefinition.status : {};
  const saucepanHiddenCheck = saucepanCore.hiddenCheck && typeof saucepanCore.hiddenCheck === "object" ? saucepanCore.hiddenCheck : {};
  const saucepanHiddenCheckIsHidden =
    typeof saucepanDefinitionStatus.hiddenCheckIsHidden === "boolean"
      ? saucepanDefinitionStatus.hiddenCheckIsHidden
      : typeof saucepanHiddenCheck.is_hidden === "boolean"
        ? saucepanHiddenCheck.is_hidden
        : null;
  const saucepanProviderProfile =
    saucepanCompanion.providersProfile ||
    saucepanCompanion.providerAccess ||
    saucepanRawCompanion.providers_profile ||
    saucepanDefinitionStatus.providersProfile ||
    saucepanDefinitionStatus.providerAccess;
  const saucepanPortraits = Array.isArray(saucepanCompanion.portraits) ? saucepanCompanion.portraits : [];
  const saucepanPortraitImageUrls = saucepanPortraits.map((portrait) => getImageRefUrl(portrait && portrait.image)).filter(Boolean);
  const saucepanRawDescriptionHtml =
    saucepanCompanion.rawDescriptionHtml ||
    saucepanCompanion.descriptionRawHtml ||
    (saucepanCompanion.descriptionHtmlFile && saucepanCompanion.descriptionHtmlFile.html);
  const saucepanCreator = capture.saucepanCreator && typeof capture.saucepanCreator === "object" ? capture.saucepanCreator : {};
  const saucepanCreatorProfile =
    saucepanCreator.profile && typeof saucepanCreator.profile === "object" ? saucepanCreator.profile : {};
  const saucepanCreatorList =
    saucepanCreator.characterList && typeof saucepanCreator.characterList === "object" ? saucepanCreator.characterList : {};
  const saucepanCreatorCharacters = Array.isArray(saucepanCreatorList.characters) ? saucepanCreatorList.characters : [];
  const saucepanSourceMaterials = Array.isArray(saucepanCreator.sourceMaterials) ? saucepanCreator.sourceMaterials : [];
  const coreRawCharacter = coreCharacter.rawCharacter && typeof coreCharacter.rawCharacter === "object" ? coreCharacter.rawCharacter : {};
  const coreProfileImageAssetUrl =
    coreCharacter.profileImageAssetUrl ||
    coreCharacter.avatarUrl ||
    coreCharacter.avatar ||
    coreRawCharacter.profileImageAssetUrl ||
    coreRawCharacter.avatarUrl ||
    coreRawCharacter.avatar_url ||
    coreRawCharacter.avatar;
  const coreRawDescriptionHtml =
    coreCharacter.rawDescriptionHtml ||
    coreCharacter.descriptionRawHtml ||
    (coreCharacter.descriptionHtmlFile && coreCharacter.descriptionHtmlFile.html) ||
    coreRawCharacter.rawDescriptionHtml ||
    coreRawCharacter.description_html ||
    coreRawCharacter.description;
  const creatorProfileImageAssetUrl = creatorProfile.profileImageAssetUrl || creatorProfile.avatarUrl || creatorProfile.avatar;
  const creatorRawDescriptionHtml =
    creatorProfile.rawDescriptionHtml ||
    creatorProfile.descriptionRawHtml ||
    creatorProfile.aboutMeHtml ||
    (creatorProfile.descriptionHtmlFile && creatorProfile.descriptionHtmlFile.html);
  const tokens = compactMeta([
    jannyDetail.totalToken != null ? `Total: ${formatNumber(jannyDetail.totalToken)}` : null,
    jannyDetail.permanentToken != null ? `Permanent: ${formatNumber(jannyDetail.permanentToken)}` : null,
  ]);
  const overview = renderDetailSection("Overview", [
    renderComponentChecklistHtml(summary.components, sourceKind)
      ? `<div class="detail-field detail-component-field">
      <div class="detail-label">Content checklist</div>
          ${renderComponentChecklistHtml(summary.components, sourceKind)}
        </div>`
      : "",
    renderField("Author", compactMeta([summary.author, summary.authorId])),
    renderField("Character ID", item.id || summary.id),
    renderField("Captured", formatDate(summary.capturedAt || item.updatedAt || item.savedAt)),
    renderField("Datacat pin", formatUploadStatus(item.upload)),
    item.upload && item.upload.datacatCharacterId ? renderField("Datacat character ID", item.upload.datacatCharacterId) : "",
    item.upload && item.upload.origin ? renderField("Datacat target", item.upload.origin) : "",
    renderField("Content", compactMeta([
      sourceKind === "saucepan"
        ? (summary.saucepanCaptured || summary.coreCaptured ? "Character ready" : "Character unavailable")
        : (summary.coreCaptured ? "Character ready" : "Character unavailable"),
      sourceKind === "saucepan" ? null : (summary.jannyCaptured ? "Additional details ready" : "Additional details unavailable"),
      summary.creator && summary.creator.captured ? "Creator ready" : "Creator unavailable",
      summary.scripts && summary.scripts.count ? `Lorebooks/scripts: ${summary.scripts.count}` : null,
    ])),
  ]);
  const coreContentSections = [
    makeHtmlFileSection("Raw description HTML file", coreCharacter.descriptionHtmlFile, coreRawDescriptionHtml),
    makeTextSection("Definition", coreSections.definitionText || coreSections.personality),
    makeTextSection("Scenario", coreSections.scenario),
    makeTextSection("First message", coreSections.firstMessage),
    makeTextSection("Alternate first messages", renderFirstMessagesValue(coreSections.firstMessages)),
    makeTextSection("Example dialogs", coreSections.exampleDialogs),
    makeTextSection("First bot message", core.extractedFirstMessage),
  ];
  const jannyContentSections = [
    makeTextSection("Description", jannyDetail.descriptionText),
    makeTextSection("Personality", jannyDetail.personalityText),
    makeTextSection("Scenario", jannyDetail.scenarioText),
    makeTextSection("First message", jannyDetail.firstMessageText),
    makeTextSection("Example dialogs", jannyDetail.exampleDialogsText),
  ];
  const creatorContentSections = [
    makeTextSection("About", creatorProfile.aboutMeText),
    makeHtmlFileSection("Raw description HTML file", creatorProfile.descriptionHtmlFile, creatorRawDescriptionHtml),
    makeTextSection("Character list payload", creatorCharacters.length ? JSON.stringify(creatorCharacters, null, 2) : null),
  ];
  const saucepanContentSections = [
    makeTextSection("Full description", saucepanCompanion.fullDescription),
    makeHtmlFileSection("Raw description HTML file", saucepanCompanion.descriptionHtmlFile, saucepanRawDescriptionHtml),
    makeTextSection("Short description", saucepanCompanion.shortDescription),
    makeTextSection("First message", saucepanCompanion.firstMessageText),
    makeTextSection("Starting scenarios", renderFirstMessagesValue(saucepanCompanion.startingScenarios)),
    makeTextSection("Definition scenario sections", renderFirstMessagesValue(saucepanDefinition.startingScenarios)),
    makeTextSection("Definition sections", getSaucepanDefinitionSectionsText(saucepanDefinition)),
    makeTextSection("Selected definition summary", summarizeSaucepanDefinitionPayload(saucepanDefinition.selectedDefinition)),
    makeLinkSection("Portrait image assets", saucepanPortraitImageUrls),
    makeTextSection("Lorebooks", saucepanCore.lorebooks ? JSON.stringify(saucepanCore.lorebooks, null, 2) : null),
  ];
  const saucepanCreatorContentSections = [
    makeTextSection("Description", saucepanCreatorProfile.description || saucepanCreatorProfile.bioText || saucepanCreatorProfile.aboutMeText),
    makeHtmlFileSection("Raw profile HTML file", saucepanCreatorProfile.descriptionHtmlFile, saucepanCreatorProfile.profileHtml),
  ];
  const tabPanels = {
    core: renderDetailSection("Character", [
      renderField("Status", core.success ? "Captured" : "Not captured"),
      renderField("Character", compactMeta([coreCharacter.name, coreCharacter.id || core.characterId])),
      renderField("Creator", compactMeta([coreCharacter.creatorName, coreCharacter.creatorId])),
      renderField("Source page", core.pageUrl),
      renderLinkList("Main profile image asset", [coreProfileImageAssetUrl]),
      renderField("Definition state", formatDefinitionState(coreCharacter)),
      renderDetailSectionDropdown("Character sections", coreContentSections, "janitor-character"),
    ]),
    janny: renderDetailSection("Additional details", [
      renderField("Status", janny.success ? "Captured" : "Not captured"),
      renderField("Title", jannyDetail.name || jannyCharacter.name),
      renderField("Creator", compactMeta([jannyDetail.creatorName || jannyCharacter.creatorName, jannyDetail.creatorId || jannyCharacter.creatorId])),
      renderField("Source page", janny.characterUrl || jannyDetail.characterUrl || jannyDetail.canonicalUrl),
      renderLinkList("Image asset links", [jannyCharacter.avatarUrl, jannyDetail.avatarUrl]),
      renderField("Stats", formatStats({
        chatCount: jannyDetail.chatCount,
        messageCount: jannyDetail.messageCount,
        viewCount: jannyDetail.viewCount,
        downloadCount: jannyDetail.downloadCount,
        bookmarkCount: jannyDetail.bookmarkCount,
      })),
      renderField("Tokens", tokens || "No token stats saved."),
      renderField("NSFW", typeof jannyDetail.isNsfw === "boolean" ? (jannyDetail.isNsfw ? "Yes" : "No") : "Unknown"),
      renderDetailSectionDropdown("Additional sections", jannyContentSections, "janny-character"),
    ]),
    lorebooks: renderScriptsDetail(coreScripts),
    creator: renderDetailSection("Creator", [
      renderField("Status", creator.success ? "Captured" : "Not captured"),
      renderField("Creator", compactMeta([creatorProfile.userName || creatorProfile.displayName || summary.creator?.name, creatorProfile.creatorId || creator.creatorId])),
      renderField("Profile URL", creator.profileUrl || creatorProfile.profileUrl),
      renderLinkList("Creator profile image asset", [creatorProfileImageAssetUrl]),
      renderField("Followers", creatorProfile.followersCount != null ? formatNumber(creatorProfile.followersCount) : null),
      renderField("Verified", typeof creatorProfile.isVerified === "boolean" ? (creatorProfile.isVerified ? "Yes" : "No") : "Unknown"),
      renderField("Character list", compactMeta([
        creatorList.total != null ? `Total: ${formatNumber(creatorList.total)}` : null,
        creatorCharacters.length ? `Fetched: ${formatNumber(creatorCharacters.length)}` : null,
        creatorList.pagesFetched != null ? `Pages: ${formatNumber(creatorList.pagesFetched)}` : null,
        creatorList.truncated ? "Truncated" : null,
      ])),
      renderDetailSectionDropdown("Creator profile sections", creatorContentSections, "janitor-creator"),
      renderCreatorCharacterList(creatorCharacters),
    ]),
    saucepan: renderDetailSection("Character", [
      renderField("Status", saucepanCore.success ? "Captured" : "Not captured"),
      renderField("Companion", compactMeta([saucepanCompanion.displayName || saucepanCompanion.name, saucepanCompanion.id || saucepanCore.companionId])),
      renderField("Creator", compactMeta([saucepanCompanion.creatorName, saucepanCompanion.creatorHandle || saucepanCompanion.creatorId])),
      renderField("Source page", saucepanCore.pageUrl || saucepanCompanion.pageUrl),
      renderField("Definition state", saucepanCore.definitionState || (
        saucepanCompanion.openDefinition === true ? "open" : saucepanCompanion.openDefinition === false ? "closed" : null
      )),
      renderLinkList("Main profile image asset", [saucepanCompanion.profileImageAssetUrl]),
      renderField("Access", compactMeta([
        saucepanCompanion.accessLevel,
        saucepanCompanion.openDefinition === true ? "Open definition" : saucepanCompanion.openDefinition === false ? "Closed definition" : null,
        saucepanCompanion.lockedStartingMessage === true ? "Locked starting message" : null,
        saucepanProviderProfile ? `Providers: ${formatSaucepanProviderProfile(saucepanProviderProfile) || saucepanProviderProfile}` : null,
      ])),
      renderField("Stats", compactMeta([
        saucepanCompanion.stats && saucepanCompanion.stats.chatCount != null ? `Chats: ${formatNumber(saucepanCompanion.stats.chatCount)}` : null,
        saucepanCompanion.stats && saucepanCompanion.stats.interactionCount != null ? `Interactions: ${formatNumber(saucepanCompanion.stats.interactionCount)}` : null,
        saucepanCompanion.stats && saucepanCompanion.stats.favoriteCount != null ? `Favorites: ${formatNumber(saucepanCompanion.stats.favoriteCount)}` : null,
        saucepanCompanion.stats && saucepanCompanion.stats.scenarioCount != null ? `Scenarios: ${formatNumber(saucepanCompanion.stats.scenarioCount)}` : null,
      ])),
      renderDetailSectionDropdown("Character sections", saucepanContentSections, "saucepan-character"),
      renderSaucepanPortraitList(saucepanPortraits),
      renderSaucepanLorebooks(saucepanCore.lorebooks),
    ]),
    saucepanCreator: renderDetailSection("Creator", [
      renderField("Status", saucepanCreator.success ? "Captured" : "Not captured"),
      renderField("Creator", compactMeta([
        saucepanCreatorProfile.displayName || summary.creator?.name,
        saucepanCreatorProfile.creatorHandle || saucepanCreator.creatorHandle,
        saucepanCreatorProfile.creatorId || saucepanCreator.creatorId,
      ])),
      renderField("Profile URL", saucepanCreator.profileUrl || saucepanCreatorProfile.profileUrl),
      renderLinkList("Creator profile image asset", [saucepanCreatorProfile.profileImageAssetUrl]),
      renderField("Followers", saucepanCreatorProfile.followersCount != null ? formatNumber(saucepanCreatorProfile.followersCount) : null),
      renderField("Source material list", compactMeta([
        saucepanCreatorList.total != null ? `Total: ${formatNumber(saucepanCreatorList.total)}` : null,
        saucepanCreatorCharacters.length ? `Fetched: ${formatNumber(saucepanCreatorCharacters.length)}` : null,
        saucepanCreatorList.pagesFetched != null ? `Pages: ${formatNumber(saucepanCreatorList.pagesFetched)}` : null,
        saucepanCreatorList.truncated ? "Truncated" : null,
        saucepanSourceMaterials.length ? `Materials: ${formatNumber(saucepanSourceMaterials.length)}` : null,
      ])),
      renderDetailSectionDropdown("Saucepan creator sections", saucepanCreatorContentSections, "saucepan-creator"),
      renderCreatorCharacterList(saucepanCreatorCharacters),
      renderSaucepanSourceMaterialList(saucepanSourceMaterials),
    ]),
  };
  if (!isDetailTabAllowed(retrievedDetailTab, sourceKind) || !tabPanels[retrievedDetailTab]) {
    retrievedDetailTab = sourceKind === "saucepan" ? "saucepan" : "core";
  }
  panel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="kicker">${inspectionState.active ? "Inspection" : "Details"}</div>
        <div class="panel-title">${inspectionState.active ? "Viewing saved character" : "Character detail"}</div>
      </div>
      ${inspectionState.active ? `<button class="icon-button detail-overlay-close" data-action="back-to-retrieved" title="Close character details" aria-label="Close character details">×</button>` : ""}
    </div>
    <div class="detail-title">${escapeHtml(summary.title || "Unknown character")}</div>
    <div class="detail-subtitle">${escapeHtml(compactMeta([
      summary.author ? `by ${summary.author}` : "Unknown author",
      formatDate(summary.updatedAt || item.updatedAt || summary.capturedAt),
    ]))}</div>
    ${buildCreatorSourceUrl(buildCreatorRequestFromRetrievedItem(item))
      ? `<button class="inline-creator-link" data-action="open-detail-creator">Open ${escapeHtml(summary.author || "creator")} on source site</button>`
      : ""}
    ${renderTags(summary.tags)}
    <div class="detail-grid">
      ${overview}
      ${renderDetailTabs(retrievedDetailTab, sourceKind)}
      ${tabPanels[retrievedDetailTab]}
    </div>
  `;
}

function beginCurrentDetailsLoading() {
  currentDetailsLoadingSeq += 1;
  return {
    seq: currentDetailsLoadingSeq,
    startedAt: Date.now(),
  };
}

async function waitForCurrentDetailsLoadingDwell(token) {
  const startedAt = token && Number.isFinite(token.startedAt) ? token.startedAt : Date.now();
  const remaining = DETAILS_LOADING_MIN_DWELL_MS - (Date.now() - startedAt);
  if (remaining > 0) await delay(remaining);
  return !!token && token.seq === currentDetailsLoadingSeq;
}

function getDetailsLoadingRenderKey(panel) {
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : {};
  const creatorRequest = creatorDetailState && creatorDetailState.active && creatorDetailState.request
    ? creatorDetailState.request
    : null;
  const currentMessage = currentDetailsMessageState && currentDetailsMessageState.loading
    ? currentDetailsMessageState
    : null;
  return JSON.stringify({
    seq: currentDetailsLoadingSeq,
    panelId: panel && panel.id ? panel.id : "",
    kind: creatorDetailState && creatorDetailState.active
      ? "creator"
      : currentMessage
        ? "message"
        : page.isCreatorPage
          ? "creator-page"
          : "details",
    url: page.normalizedUrl || page.url || "",
    sourceKind: normalizeSourceKind(
      (creatorRequest && creatorRequest.sourceKind) ||
      page.sourceKind ||
      "",
    ) || "",
  });
}

function renderDetailsLoadingPanel(panel, { kicker = "Details", title = "Loading details", message = "Reading details." } = {}) {
  if (!panel) return;
  panel.hidden = false;
  panel.className = `panel current-details-panel is-loading${inspectionState.active ? " is-inspection-overlay" : ""}`;
  syncInspectionDialogAttributes(panel);
  const loadingRenderKey = getDetailsLoadingRenderKey(panel);
  if (panel.dataset.detailsLoadingRenderKey === loadingRenderKey) {
    const titleNode = panel.querySelector(".unified-blocking-copy .character-name");
    const messageNode = panel.querySelector(".unified-blocking-copy .character-id");
    if (titleNode && titleNode.textContent !== String(title || "Loading details")) {
      titleNode.textContent = String(title || "Loading details");
    }
    if (messageNode && messageNode.textContent !== String(message || "Reading details.")) {
      messageNode.textContent = String(message || "Reading details.");
    }
    return;
  }
  panel.dataset.detailsLoadingRenderKey = loadingRenderKey;
  panel.innerHTML = renderUnifiedBlockingLoaderHtml(title || "Loading details", message || "Reading details.");
}

function renderCurrentDetailsMessage({ kicker, title, message, tone = "muted", actionsHtml = "", loading = false }) {
  if (!currentDetailsPanel) return;
  currentDetailsMessageState = { kicker, title, message, tone, actionsHtml, loading };
  if (loading) {
    renderDetailsLoadingPanel(currentDetailsPanel, { kicker, title, message });
    return;
  }
  currentDetailsPanel.hidden = false;
  currentDetailsPanel.className = `panel current-details-panel is-${tone}${inspectionState.active ? " is-inspection-overlay" : ""}`;
  syncInspectionDialogAttributes(currentDetailsPanel);
  currentDetailsPanel.dataset.detailsLoadingRenderKey = "";
  currentDetailsPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <div class="kicker">${escapeHtml(kicker || "Details")}</div>
        <div class="panel-title">${escapeHtml(title || "Details")}</div>
      </div>
      ${actionsHtml || `<button class="mini-button" data-action="back-to-retrieved">Close</button>`}
    </div>
    ${message ? `<div class="retrieved-summary">${escapeHtml(message)}</div>` : ""}
  `;
}

function clearCurrentDetailState() {
  currentDetailsLoadingSeq += 1;
  currentInspectionOpenSeq += 1;
  currentCreatorOpenSeq += 1;
  autoCharacterDetailOpenKey = null;
  retrievedDetailItem = null;
  dispatchSidebar({ type: SourceVaultSidebarStore.ActionTypes.CLOSE_INSPECTION });
  updateCreatorDetailState({ active: false, loading: false, error: null, phase: null });
  currentDetailsMessageState = null;
  if (currentDetailsPanel) {
    currentDetailsPanel.hidden = true;
    currentDetailsPanel.innerHTML = "";
    currentDetailsPanel.className = "panel current-details-panel";
    currentDetailsPanel.dataset.detailsLoadingRenderKey = "";
    currentDetailsPanel.removeAttribute("role");
    currentDetailsPanel.removeAttribute("aria-modal");
    currentDetailsPanel.removeAttribute("aria-label");
  }
}

function renderCurrentDetailsPanel() {
  if (!currentDetailsPanel) return;
  currentDetailsPanel.className = "panel current-details-panel";
  currentDetailsPanel.removeAttribute("role");
  currentDetailsPanel.removeAttribute("aria-modal");
  currentDetailsPanel.removeAttribute("aria-label");
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : null;
  if (inspectionState.active && inspectionState.kind === "character") {
    if (retrievedDetailItem) {
      currentDetailsMessageState = null;
      renderRetrievedDetail(retrievedDetailItem, currentDetailsPanel);
      return;
    }
    if (currentDetailsMessageState) {
      renderCurrentDetailsMessage(currentDetailsMessageState);
      return;
    }
    renderDetailsLoadingPanel(currentDetailsPanel, {
      kicker: "Inspection",
      title: "Loading saved character...",
      message: "Reading pinned character details.",
    });
    return;
  }
  if (page && page.isCreatorPage) {
    currentDetailsMessageState = null;
    if (creatorDetailState && creatorDetailState.active) {
      renderCreatorDetailPanel(currentDetailsPanel);
      return;
    }
    if (page.pendingNavigation || isDetectedLoginChecking(page) || sourceAccountApprovalsLoading) {
      renderDetailsLoadingPanel(currentDetailsPanel, {
        kicker: "Creator",
        title: "Loading page...",
        message: getCreatorLoadingMessage(),
      });
      return;
    }
    if (!canOpenCurrentCreatorPage()) {
      currentDetailsPanel.hidden = false;
      currentDetailsPanel.className = "panel current-details-panel is-muted";
      currentDetailsPanel.dataset.detailsLoadingRenderKey = "";
      currentDetailsPanel.innerHTML = `
        <div class="panel-header">
          <div>
            <div class="kicker">Creator</div>
            <div class="panel-title">Creator unavailable</div>
          </div>
        </div>
        <div class="retrieved-summary">${escapeHtml(getDetectedLoginLine(page))}</div>
      `;
      return;
    }
    renderDetailsLoadingPanel(currentDetailsPanel, {
      kicker: "Creator",
      title: "Loading page...",
      message: getCreatorLoadingMessage(),
    });
    return;
  }
  if (creatorDetailState && creatorDetailState.active) {
    currentDetailsMessageState = null;
    renderCreatorDetailPanel(currentDetailsPanel);
    return;
  }
  if (currentDetailsMessageState) {
    renderCurrentDetailsMessage(currentDetailsMessageState);
    return;
  }
  currentDetailsPanel.hidden = true;
  currentDetailsPanel.innerHTML = "";
  currentDetailsPanel.dataset.detailsLoadingRenderKey = "";
}
