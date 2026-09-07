function formatFlag(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

function formatDefinitionState(character) {
  const root = character && typeof character === "object" ? character : {};
  if (root.definitionHidden === true) return "Hidden by author";
  if (root.definitionHidden === false) return "Revealed by author";
  if (root.fullDefinitionRevealedByAuthor === true || root.full_definition_revealed_by_author === true) return "Revealed by author";
  if (root.fullDefinitionRevealedByAuthor === false || root.full_definition_revealed_by_author === false) return "Hidden by author";
  return "Unknown";
}

function formatRetrievalCompleteness(value) {
  const root = value && typeof value === "object" ? value : {};
  if (!Object.keys(root).length) return "Unknown";
  const label = root.partial === true ? "Partial" : "Complete";
  return compactMeta([label, root.state, root.reason, root.message]);
}

function getItemComponentsForStatus(item) {
  const summary = item && item.summary && typeof item.summary === "object" ? item.summary : {};
  const upload = item && item.upload && typeof item.upload === "object" ? item.upload : {};
  const retrieval = item && item.retrieval && typeof item.retrieval === "object" ? item.retrieval : {};
  return summary.components || upload.components || retrieval.components || null;
}

function formatScoringStatus(upload, item = null) {
  const root = upload && typeof upload === "object" ? upload : {};
  const status = String(root.scoringStatus || "").trim();
  if (!status) return null;
  const reason = root.scoringReason && typeof root.scoringReason === "object" ? root.scoringReason : {};
  if (status === "skipped_partial") {
    if (reason.message) return reason.message;
    const sourceKind = getRetrievedItemSourceKind(item) || getRecentItemSourceKind(item);
    const components = getItemComponentsForStatus(item);
    const recovery = components && typeof components === "object" ? components.recovery : null;
    if (
      sourceKind === "janitor" &&
      recovery &&
      typeof recovery === "object" &&
      (recovery.status === "failed" || recovery.passed === false)
    ) {
      return "Scoring skipped: hidden definition not recovered.";
    }
    return "Scoring skipped: partial retrieval.";
  }
  return `Scoring: ${status.replace(/_/g, " ")}`;
}

function formatUploadStatus(upload) {
  const root = upload && typeof upload === "object" ? upload : {};
  const rawStatus = String(root.status || "not_uploaded").replace(/_/g, " ");
  const status = rawStatus === "uploaded"
    ? "pinned"
    : rawStatus === "uploading"
      ? "pinning to Datacat"
      : rawStatus;
  return compactMeta([
    status,
    root.persistenceStatus ? `pin: ${root.persistenceStatus}` : null,
    root.mirrorStatus ? `media: ${root.mirrorStatus}` : null,
    formatScoringStatus(root),
    root.error ? `error: ${root.error}` : null,
  ]);
}

function getUploadStatusKind(upload) {
  const status = String(upload && upload.status || "").trim().toLowerCase();
  if (status === "local_saved" || status === "local-only" || status === "local_only") return "local_saved";
  if (status === "uploaded" || status === "saved") return "uploaded";
  if (status === "failed" || status === "error") return "failed";
  if (status === "uploading" || status === "checking_datacat" || status === "pending") return "pending";
  return status || "not_uploaded";
}

function isUploadTransactionPending(upload) {
  return getUploadStatusKind(upload) === "pending";
}

function getCurrentCharacterPrimaryAction() {
  const localItem = getCurrentLocalSavedItem();
  const upload = localItem && localItem.upload && typeof localItem.upload === "object"
    ? localItem.upload
    : null;
  return {
    localItem,
    ...SourceVaultPolicy.resolveCharacterPrimaryAction({
      hasLocal: !!localItem,
      datacatExists: hasExistingAccessibleCharacter(),
      datacatOwned: isCurrentDatacatCharacterOwned(),
      uploadFailed: getUploadStatusKind(upload) === "failed",
    }),
  };
}

function cleanPinTerminalText(value) {
  return compactText(value, 180);
}

function buildCurrentPinTerminalState(upload, options = {}) {
  const root = upload && typeof upload === "object" ? upload : {};
  const rawStatus = String(root.status || "").trim().toLowerCase();
  const status = getUploadStatusKind(root);
  const detailSuffix = options.detailsOpen === false ? "" : " Character details are below.";
  if (root.localOnly === true || status === "local_saved") {
    return {
      title: "Saved locally",
      message: "Character details are below.",
      tone: "completed",
    };
  }
  if (status === "uploaded") {
    return {
      title: "Pinned to Datacat",
      message: compactMeta([
        cleanPinTerminalText(root.message) || "Saved to Datacat.",
        detailSuffix ? "Character details are below." : null,
      ]),
      tone: "completed",
    };
  }
  if (status === "failed") {
    return {
      title: "Datacat pin failed",
      message: compactMeta([
        cleanPinTerminalText(root.error) || cleanPinTerminalText(root.message) || "Datacat save failed.",
        "Character details are saved locally.",
      ]),
      tone: "failed",
    };
  }
  const pendingMessage =
    rawStatus === "checking_datacat"
      ? "Checking Datacat session..."
      : rawStatus === "uploading"
        ? "Saving to Datacat..."
        : "Character retrieved locally. Saving to Datacat...";
  return {
    title: "Saving to Datacat",
    message: rawStatus === "pending" ? pendingMessage : cleanPinTerminalText(root.message) || pendingMessage,
    tone: "running",
  };
}

function isPassedSkippedComponent(item) {
  const root = item && typeof item === "object" ? item : {};
  const status = String(root.status || "").trim().toLowerCase();
  return status === "skipped" && root.passed === true;
}

function getComponentStatusClass(status, item = null) {
  if (isPassedSkippedComponent(item)) return "is-passed";
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "passed") return "is-passed";
  if (normalized === "failed") return "is-failed";
  if (normalized === "action_required" || normalized === "waiting_user_action" || normalized === "timed_out") return "is-action-required";
  if (normalized === "resuming") return "is-pending";
  if (normalized === "pending") return "is-pending";
  return "is-skipped";
}

function getComponentStatusSymbol(status, item = null) {
  if (isPassedSkippedComponent(item)) return "✓";
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "passed") return "✓";
  if (normalized === "failed") return "!";
  if (normalized === "action_required" || normalized === "waiting_user_action" || normalized === "timed_out") return "!";
  if (normalized === "resuming") return "...";
  if (normalized === "pending") return "...";
  return "-";
}

function formatComponentChecklistStatus(item) {
  const root = item && typeof item === "object" ? item : {};
  const status = String(root.status || "pending").trim().toLowerCase();
  const message = String(root.message || "").trim().toLowerCase();
  if (root.key === "creator" && status === "skipped" && root.passed === true) {
    if (message.includes("fresh") || message.includes("recently")) return "fresh";
    return "skipped";
  }
  return String(root.status || "pending").replace(/_/g, " ");
}

function getSourceIcon(sourceKind) {
  const descriptor = getSourceDescriptor(sourceKind);
  return descriptor && descriptor.iconGlyph ? descriptor.iconGlyph : "?";
}

function hashThumbnailKey(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getThumbnailImageUrl(value) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object") return null;
  return (
    value.highresUrl ||
    value.cardUrl ||
    value.thumbnailUrl ||
    value.highres_url ||
    value.card_url ||
    value.thumbnail_url ||
    value.imageUrl ||
    value.url ||
    null
  );
}

function buildThumbnailCacheKey(sourceKind, role, entityId, imageUrl) {
  const source = normalizeSourceKind(sourceKind) || "source";
  const normalizedRole = String(role || "image").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48) || "image";
  const entity = String(entityId || "").trim().toLowerCase().slice(0, 96) || "unknown";
  const url = String(imageUrl || "").trim();
  if (!url || /^data:/i.test(url)) return null;
  return `${source}:${normalizedRole}:${entity}:${hashThumbnailKey(url)}`;
}

function getThumbnailDataUrlForImage(sourceKind, role, entityId, imageUrl) {
  const key = buildThumbnailCacheKey(sourceKind, role, entityId, imageUrl);
  const entry = key && thumbnailCacheEntries && thumbnailCacheEntries[key] ? thumbnailCacheEntries[key] : null;
  return entry && entry.dataUrl ? entry.dataUrl : null;
}

function getCharacterThumbnailRef(character, sourceKind) {
  const root = character && typeof character === "object" ? character : {};
  const imageUrl = getThumbnailImageUrl(root.profileImageAssetUrl || root.avatarUrl || root.imageUrl || root.avatar || root.image);
  const entityId = root.id || root.characterId || root.companionId || root.sourceId || imageUrl;
  const source = root.sourceKind || sourceKind || "source";
  if (!imageUrl) return null;
  return {
    sourceKind: source,
    role: "character_profile",
    entityId,
    imageUrl,
    cacheKey: buildThumbnailCacheKey(source, "character_profile", entityId, imageUrl),
  };
}

function getCharacterAvatarUrl(character, sourceKind) {
  const root = character && typeof character === "object" ? character : {};
  if (root.thumbnailDataUrl) return root.thumbnailDataUrl;
  const ref = getCharacterThumbnailRef(root, sourceKind);
  const cached = ref ? getThumbnailDataUrlForImage(ref.sourceKind, ref.role, ref.entityId, ref.imageUrl) : null;
  if (cached) return cached;
  return null;
}

function shouldRenderDetectedAvatar(page, character) {
  const sourceKind = String(page && page.sourceKind ? page.sourceKind : "").trim().toLowerCase();
  const avatarUrl = getCharacterAvatarUrl(character, sourceKind);
  if (sourceKind === "saucepan") return /^data:image\//i.test(String(avatarUrl || ""));
  return !!avatarUrl;
}

function getCharacterInitial(character) {
  const name = character && character.name ? String(character.name).trim() : "";
  return name ? name.slice(0, 1).toUpperCase() : "S";
}

function normalizeComponentChecklist(value, sourceKind) {
  const root = value && typeof value === "object" ? value : {};
  const effectiveSourceKind = String(root.sourceKind || sourceKind || "janitor").trim().toLowerCase() === "saucepan"
    ? "saucepan"
    : "janitor";
  const items = [];
  const publicMessage = (status, passed) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (passed || normalized === "passed" || normalized === "completed") return "Ready.";
    if (["failed", "timed_out"].includes(normalized)) return "Not available.";
    if (["action_required", "waiting_user_action"].includes(normalized)) return "Action required.";
    return "Waiting.";
  };
  const add = (key, label) => {
    const item = root[key] && typeof root[key] === "object" ? root[key] : null;
    if (!item) return;
    const status = item.status || (item.passed === true ? "passed" : "pending");
    items.push({
      key,
      label,
      status,
      passed: item.passed === true,
      message: publicMessage(status, item.passed === true),
    });
  };
  add("core", "Character");
  if (effectiveSourceKind === "janitor") add("recovery", "Additional");
  add("creator", "Creator");
  return items;
}

function hasExistingAccessibleCharacter() {
  return !!getCurrentDatacatViewUrl();
}

function isCurrentDatacatCharacterOwned() {
  const item = getCurrentLocalSavedItem();
  const upload = item && item.upload && typeof item.upload === "object" ? item.upload : null;
  if (upload && getUploadStatusKind(upload) === "uploaded" && upload.viewUrl) return true;
  const existing = preflightState && preflightState.existing && typeof preflightState.existing === "object"
    ? preflightState.existing
    : null;
  if (existing && existing.exists === true) return existing.ownerVisible !== false;
  return false;
}

function isCurrentDatacatCharacterCrossOwner() {
  const existing = preflightState && preflightState.existing && typeof preflightState.existing === "object"
    ? preflightState.existing
    : null;
  return !!(existing && existing.exists === true && existing.ownerVisible === false);
}

function getCurrentPrivateVaultDatacatViewUrl() {
  const visibility = getCurrentSourceCharacterVisibility();
  if (visibility !== "private" && visibility !== "unlisted") return null;
  const characterId = SourceVaultCore.normalizeUuid(getCurrentCharacterId());
  const sourceKind = normalizeSourceKind(getCurrentSourceKind());
  if (!characterId || (sourceKind !== "janitor" && sourceKind !== "saucepan")) return null;
  const sourceSegment = sourceKind === "saucepan" ? "sauce" : "janitor";
  return `/characters/vault/${sourceSegment}/${encodeURIComponent(characterId)}`;
}

function getCurrentDatacatViewUrl() {
  const privateVaultViewUrl = getCurrentPrivateVaultDatacatViewUrl();
  const item = getCurrentLocalSavedItem();
  const upload = item && item.upload && typeof item.upload === "object" ? item.upload : null;
  if (upload && getUploadStatusKind(upload) === "uploaded" && upload.viewUrl) {
    return privateVaultViewUrl || upload.viewUrl;
  }
  if (preflightState && preflightState.existing && preflightState.existing.exists && preflightState.actions && preflightState.actions.viewUrl) {
    return privateVaultViewUrl || preflightState.actions.viewUrl;
  }
  return null;
}

function getCurrentDatacatReimaginationUrl() {
  const viewUrl = getCurrentDatacatViewUrl();
  if (!viewUrl) return null;
  try {
    const isAbsolute = /^https?:\/\//i.test(String(viewUrl));
    const parsed = new URL(viewUrl, "https://datacat.invalid");
    parsed.searchParams.set("characterSection", "reimagination");
    return isAbsolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    const separator = String(viewUrl).includes("?") ? "&" : "?";
    return `${viewUrl}${separator}characterSection=reimagination`;
  }
}

function getCurrentTransactionUpload() {
  const item = getCurrentLocalSavedItem();
  const upload = item && item.upload && typeof item.upload === "object" ? item.upload : null;
  if (isUploadTransactionPending(upload)) return upload;
  const flight = retrievalDisplayMachine && retrievalDisplayMachine.flight ? retrievalDisplayMachine.flight : null;
  if (isUploadTransactionPending(flight && flight.upload)) return flight.upload;
  if (isUploadTransactionPending(flight && flight.fallback && flight.fallback.upload)) return flight.fallback.upload;
  return null;
}

function isCurrentPageTransactionActive() {
  const retrieval = currentState && currentState.retrieval && typeof currentState.retrieval === "object"
    ? currentState.retrieval
    : null;
  const activeFallback = getActiveRetrievalFallback();
  const fallbackRetrieval = activeFallback && activeFallback.retrieval && typeof activeFallback.retrieval === "object"
    ? activeFallback.retrieval
    : null;
  return !!(
    (retrieval && retrieval.running) ||
    (fallbackRetrieval && fallbackRetrieval.running) ||
    isRetrievalFlightActive() ||
    getCurrentTransactionUpload()
  );
}

function canRetrieveCurrentPage() {
  const auth = currentState && currentState.auth ? currentState.auth : null;
  const page = currentState && currentState.page ? currentState.page : null;
  const character = currentState && currentState.character ? currentState.character : null;
  const retrieval = currentState && currentState.retrieval ? currentState.retrieval : null;
  const gate = getCurrentSourceAccountGate();
  return !!(auth && auth.loggedIn && gate.allowed && page && page.isCharacterPage && character && !isCurrentCharacterSettling() && !(retrieval && retrieval.running));
}

function canAttemptCurrentPageRetrieval() {
  const page = currentState && currentState.page ? currentState.page : null;
  const character = currentState && currentState.character ? currentState.character : null;
  const retrieval = currentState && currentState.retrieval ? currentState.retrieval : null;
  return !!(page && page.isCharacterPage && character && !isCurrentCharacterSettling() && !(retrieval && retrieval.running));
}

function getCurrentRetrievalBlockedMessage() {
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : {};
  const auth = currentState && currentState.auth && typeof currentState.auth === "object" ? currentState.auth : {};
  const gate = getCurrentSourceAccountGate();
  if (!page || !page.isCharacterPage) return "Open a supported character page before pinning.";
  if (!currentState || !currentState.character) return "Character details are still loading.";
  if (isCurrentCharacterSettling()) return "Waiting for the character page to settle.";
  if (auth.checking) return "Checking source login. Try again in a moment.";
  if (!auth.loggedIn) return getDetectedLoginLine(page);
  if (!gate.allowed) return gate.account ? "Approve this source account before pinning." : "Checking source account before pinning.";
  return "Pin could not start from the current page.";
}

function canOpenCurrentCreatorPage() {
  const auth = currentState && currentState.auth ? currentState.auth : null;
  const page = currentState && currentState.page ? currentState.page : null;
  const gate = getCurrentSourceAccountGate();
  return !!(auth && auth.loggedIn && gate.allowed && page && page.isCreatorPage && (page.creatorId || page.creatorHandle));
}

function getCreatorLoadingMessage() {
  const explicitPhase = creatorDetailState && creatorDetailState.phase
    ? String(creatorDetailState.phase).trim()
    : "";
  if (explicitPhase) return explicitPhase;
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : {};
  const auth = currentState && currentState.auth && typeof currentState.auth === "object" ? currentState.auth : {};
  const sourceKind = normalizeSourceKind(page.sourceKind);
  const sourceLabel = getSourceLabel(sourceKind, "source");
  if (page.pendingNavigation) return "Waiting for the creator page...";
  if (auth.checking || sourceAccountApprovalsLoading) return `Checking ${sourceLabel} account...`;
  return `Reading ${sourceLabel} creator profile...`;
}

function formatStats(stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  const parts = [
    ["Chats", s.chatCount],
    ["Messages", s.messageCount],
    ["Views", s.viewCount],
    ["Downloads", s.downloadCount],
    ["Bookmarks", s.bookmarkCount],
  ]
    .map(([label, value]) => {
      const formatted = formatNumber(value);
      return formatted ? `${label}: ${formatted}` : null;
    })
    .filter(Boolean);
  return parts.length ? parts.join("\n") : "No stats saved.";
}

function normalizeSectionText(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function formatCharCount(length) {
  const n = Number.isFinite(Number(length)) ? Number(length) : 0;
  return `${formatNumber(n) || "0"} ${n === 1 ? "char" : "chars"}`;
}

function getCharacterProfileImageAssetUrl(character) {
  return character && (character.profileImageAssetUrl || character.avatarUrl || getImageRefUrl(character.avatar || character.image));
}

function getCharacterProfileThumbnailUrl(sourceKind, character) {
  const root = character && typeof character === "object" ? character : {};
  const imageUrl = getCharacterProfileImageAssetUrl(root);
  const entityId = root.id || root.characterId || root.companionId || root.sourceId || imageUrl;
  return getThumbnailDataUrlForImage(sourceKind, "character_profile", entityId, imageUrl);
}

function getCreatorProfileThumbnailUrl(sourceKind, summary) {
  const root = summary && typeof summary === "object" ? summary : {};
  const entityId = root.creatorId || root.creatorHandle || root.id || root.name || root.imageUrl;
  return getThumbnailDataUrlForImage(sourceKind, "creator_profile", entityId, root.imageUrl);
}

function getImageRefUrl(image) {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (typeof image !== "object") return null;
  return image.highresUrl || image.cardUrl || image.thumbnailUrl || image.highres_url || image.card_url || image.thumbnail_url || image.url || null;
}

function getCreatorRecordCharacters(record) {
  const capture = record && record.capture && typeof record.capture === "object" ? record.capture : {};
  const characterList = capture.characterList && typeof capture.characterList === "object" ? capture.characterList : {};
  return Array.isArray(characterList.characters) ? characterList.characters : [];
}

function getCharacterSourceQuality(character, sourceKind) {
  if (!SourceVaultCore || typeof SourceVaultCore.deriveCharacterSourceQuality !== "function") {
    return { state: "unknown", degraded: false, recovered: false, definitionUnavailable: false, reason: null };
  }
  return SourceVaultCore.deriveCharacterSourceQuality(character, sourceKind);
}

function getRetrievedItemSourceQuality(item) {
  const root = item && typeof item === "object" ? item : {};
  const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
  const sourceKind = normalizeSourceKind(summary.sourceKind || root.sourceKind);
  const summaryQuality = getCharacterSourceQuality(summary, sourceKind);
  if (summaryQuality.state !== "unknown") return summaryQuality;
  if (root.capture && SourceVaultCore && typeof SourceVaultCore.deriveRetrievedSourceQuality === "function") {
    return SourceVaultCore.deriveRetrievedSourceQuality(root.capture);
  }
  return summaryQuality;
}

function getCurrentSourceQuality() {
  const localItem = getCurrentLocalSavedItem();
  const localQuality = getRetrievedItemSourceQuality(localItem);
  if (localQuality.state !== "unknown") return localQuality;
  const character = currentState && currentState.character && typeof currentState.character === "object"
    ? currentState.character
    : {};
  return getCharacterSourceQuality(character, getCurrentSourceKind());
}

function getCreatorCharacterSourceQuality(sourceKind, character) {
  const localItem = getLocallySavedCreatorCharacter(sourceKind, character);
  const localQuality = getRetrievedItemSourceQuality(localItem);
  if (localQuality.state !== "unknown") return localQuality;
  return getCharacterSourceQuality(character, sourceKind);
}

function renderSourceQualityBadge(quality) {
  const root = quality && typeof quality === "object" ? quality : {};
  if (root.degraded !== true) return "";
  return `<span class="source-quality-badge is-degraded" title="Source definition is unavailable">DEGRADED</span>`;
}

function getCurrentImprovementState() {
  const improvement = preflightState && preflightState.improvement && typeof preflightState.improvement === "object"
    ? preflightState.improvement
    : {};
  return {
    available: improvement.available === true,
    generatedAt: improvement.generatedAt || null,
    viewUrl: improvement.viewUrl || getCurrentDatacatViewUrl(),
  };
}

function getCurrentDatacatActionLabel() {
  if (getCurrentSourceQuality().degraded !== true) return "View on Datacat";
  return "Reimagine on Datacat";
}

function renderCurrentSourceQualityNote() {
  if (getCurrentSourceQuality().degraded !== true) return "";
  return `<div class="source-quality-note is-degraded">Author has not provided definition for this card. Pin anyway to save  available source content and use Datacat to enrich it</div>`;
}

function getCreatorCharacterExcerpt(character, maxLength = 150) {
  const root = character && typeof character === "object" ? character : {};
  const rawData = root.rawData && typeof root.rawData === "object"
    ? root.rawData
    : root.raw_data && typeof root.raw_data === "object"
      ? root.raw_data
      : {};
  const apiItem = rawData.api_item && typeof rawData.api_item === "object" ? rawData.api_item : {};
  const candidates = [
    root.shortDescription,
    root.short_description,
    root.descriptionText,
    root.description_text,
    root.summary,
    root.tagline,
    apiItem.short_description,
    apiItem.shortDescription,
    apiItem.summary,
    root.description,
    apiItem.description,
  ];
  for (const candidate of candidates) {
    if (candidate == null || typeof candidate === "object") continue;
    const withoutHtml = typeof SourceVaultCore.stripTags === "function"
      ? SourceVaultCore.stripTags(candidate)
      : String(candidate).replace(/<[^>]+>/g, " ");
    const plainText = String(withoutHtml || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~`]+/g, " ")
      .replace(/(^|\s)#{1,6}\s*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    const excerpt = compactText(plainText, maxLength);
    if (excerpt) return excerpt;
  }
  return "";
}

function getLocallySavedCreatorCharacter(sourceKind, character) {
  const root = character && typeof character === "object" ? character : {};
  const characterId = root.id || root.characterId || root.companionId || root.sourceId || null;
  if (!characterId) return null;
  const normalizedSourceKind = normalizeSourceKind(sourceKind);
  const candidates = [latestSavedCharacter, ...(Array.isArray(retrievedList) ? retrievedList : [])].filter(Boolean);
  return candidates.find((item) => {
    if (!idsMatch(item && item.id, characterId)) return false;
    const summary = item && item.summary && typeof item.summary === "object" ? item.summary : {};
    const itemSourceKind = normalizeSourceKind(summary.sourceKind || item.sourceKind);
    return !normalizedSourceKind || !itemSourceKind || itemSourceKind === normalizedSourceKind;
  }) || null;
}

function isCreatorCharacterSavedLocally(sourceKind, character) {
  return !!getLocallySavedCreatorCharacter(sourceKind, character);
}

function getCreatorCharacterQueueState(sourceKind, character) {
  const root = character && typeof character === "object" ? character : {};
  const characterId = root.id || root.characterId || root.companionId || root.sourceId || null;
  const normalizedSourceKind = normalizeSourceKind(sourceKind);
  if (!characterId || !normalizedSourceKind) return null;
  const queue = typeof queueState !== "undefined" && queueState ? queueState : {};
  const candidates = [
    ...(typeof optimisticQueueItems !== "undefined" && Array.isArray(optimisticQueueItems) ? optimisticQueueItems : []),
    queue.activeItem,
    ...(Array.isArray(queue.pending) ? queue.pending : []),
    ...(Array.isArray(queue.finished) ? queue.finished : []),
  ].filter(Boolean);
  const item = candidates.find((candidate) => (
    normalizeSourceKind(candidate && candidate.sourceKind) === normalizedSourceKind &&
    idsMatch(candidate && candidate.characterId, characterId)
  ));
  if (!item) return null;
  const state = String(item.state || "pending").trim().toLowerCase();
  if (state === "failed") return { item, state: "failed", label: "Failed" };
  if (state === "pending" || state === "interrupted") return { item, state: "queued", label: "In queue" };
  return { item, state: "running", label: "Retrieving" };
}

function getUnsavedCreatorRecordCharacters(record) {
  const sourceKind = record && record.sourceKind === "saucepan" ? "saucepan" : "janitor";
  return getCreatorRecordCharacters(record).filter((character) => !isCreatorCharacterSavedLocally(sourceKind, character));
}

function getQueueableCreatorRecordCharacters(record) {
  const sourceKind = record && record.sourceKind === "saucepan" ? "saucepan" : "janitor";
  return getUnsavedCreatorRecordCharacters(record).filter((character) => !getCreatorCharacterQueueState(sourceKind, character));
}

function slugifyJanitorCharacterText(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return text || null;
}

function normalizeCreatorCharacterUrl(value, baseUrl) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const pathLike = raw.startsWith("/") ? raw : /^(?:characters|companion)\//i.test(raw) ? `/${raw}` : null;
  if (!/^https?:\/\//i.test(raw) && !pathLike) return null;
  try {
    return new URL(pathLike || raw, baseUrl || "https://janitorai.com").toString();
  } catch (_) {
    return raw;
  }
}

function buildCreatorCharacterSourceUrl(sourceKind, character) {
  const root = character && typeof character === "object" ? character : {};
  const baseUrl = sourceKind === "saucepan" ? "https://saucepan.ai" : "https://janitorai.com";
  const existingUrl = root.url || root.characterUrl || root.character_url || root.companionUrl || root.companion_url || root.profileUrl || root.profile_url || root.sourceUrl || root.source_url || null;
  const normalizedExistingUrl = normalizeCreatorCharacterUrl(existingUrl, baseUrl);
  if (normalizedExistingUrl) return normalizedExistingUrl;
  const path = root.path || root.pathname || root.slugPath || root.slug_path || null;
  const normalizedPath = normalizeCreatorCharacterUrl(path, baseUrl);
  if (normalizedPath) return normalizedPath;
  const id = root.id || root.characterId || root.companionId || root.sourceId || null;
  if (!id) return null;
  if (sourceKind === "saucepan") return `https://saucepan.ai/companion/${encodeURIComponent(id)}`;
  const slug = slugifyJanitorCharacterText(root.slug || root.public_slug || root.slugified_name || root.slugifiedName || root.name || root.title);
  if (!slug) return `https://janitorai.com/characters/${encodeURIComponent(id)}`;
  const suffix = slug.startsWith("character-") ? slug : `character-${slug}`;
  return `https://janitorai.com/characters/${encodeURIComponent(id)}_${suffix}`;
}

function pushVisibleThumbnailRef(refs, ref) {
  if (!ref || !ref.imageUrl || !ref.cacheKey) return;
  if (thumbnailCacheEntries && thumbnailCacheEntries[ref.cacheKey]) return;
  if (thumbnailRequestInFlightKeys.has(ref.cacheKey)) return;
  if (refs.some((item) => item.cacheKey === ref.cacheKey)) return;
  refs.push(ref);
}

function buildCreatorProfileThumbnailRef(sourceKind, summary) {
  const root = summary && typeof summary === "object" ? summary : {};
  const imageUrl = root.imageUrl || null;
  const entityId = root.creatorId || root.creatorHandle || root.id || root.name || imageUrl;
  const cacheKey = buildThumbnailCacheKey(sourceKind, "creator_profile", entityId, imageUrl);
  return imageUrl && cacheKey ? { sourceKind, role: "creator_profile", entityId, imageUrl, cacheKey } : null;
}

function collectVisibleThumbnailRefs() {
  const refs = [];
  const state = currentState || {};
  const page = state.page && typeof state.page === "object" ? state.page : {};
  const character = state.character && typeof state.character === "object" ? state.character : null;
  pushVisibleThumbnailRef(refs, getCharacterThumbnailRef(character, page.sourceKind));
  for (const item of Array.isArray(retrievedList) ? retrievedList.slice(0, 20) : []) {
    const summary = item && item.summary && typeof item.summary === "object" ? item.summary : {};
    const sourceKind = normalizeSourceKind(summary.sourceKind);
    pushVisibleThumbnailRef(refs, getCharacterThumbnailRef({
      id: summary.id || item.id,
      sourceKind,
      profileImageAssetUrl: summary.imageUrl,
      avatarUrl: summary.imageUrl,
    }, sourceKind));
  }
  if (latestSavedCharacter && latestSavedCharacter.summary) {
    const summary = latestSavedCharacter.summary;
    const sourceKind = normalizeSourceKind(summary.sourceKind);
    pushVisibleThumbnailRef(refs, getCharacterThumbnailRef({
      id: summary.id || latestSavedCharacter.id,
      sourceKind,
      profileImageAssetUrl: summary.imageUrl,
      avatarUrl: summary.imageUrl,
    }, sourceKind));
  }
  if (creatorDetailState && creatorDetailState.active && creatorDetailState.record) {
    const record = creatorDetailState.record;
    const sourceKind = normalizeSourceKind(record.sourceKind || (record.summary && record.summary.sourceKind));
    const summary = record.summary && typeof record.summary === "object" ? record.summary : {};
    pushVisibleThumbnailRef(refs, buildCreatorProfileThumbnailRef(sourceKind, summary));
    for (const creatorCharacter of getCreatorRecordCharacters(record).slice(0, 80)) {
      pushVisibleThumbnailRef(refs, getCharacterThumbnailRef(creatorCharacter, sourceKind));
    }
  }
  return refs.slice(0, 120);
}

function requestVisibleThumbnailsSoon() {
  if (thumbnailRequestTimer) clearTimeout(thumbnailRequestTimer);
  thumbnailRequestTimer = setTimeout(() => {
    thumbnailRequestTimer = null;
    const refs = collectVisibleThumbnailRefs();
    const missingRefs = refs.filter((ref) => ref && ref.cacheKey && !thumbnailCacheEntries[ref.cacheKey] && !thumbnailRequestInFlightKeys.has(ref.cacheKey));
    if (!missingRefs.length) return;
    missingRefs.forEach((ref) => thumbnailRequestInFlightKeys.add(ref.cacheKey));
    chrome.runtime.sendMessage({ type: MessageTypes.SV2_CACHE_THUMBNAILS, refs: missingRefs }, (response) => {
      missingRefs.forEach((ref) => thumbnailRequestInFlightKeys.delete(ref.cacheKey));
      if (chrome.runtime.lastError || !response || !response.ok) return;
      if (response.entries && typeof response.entries === "object") {
        thumbnailCacheEntries = { ...(thumbnailCacheEntries || {}), ...response.entries };
        renderCurrentPageCard();
        renderCurrentDetailsPanel();
        renderRetrievedPanel();
      }
    });
  }, 250);
}

function buildCreatorRequestFromRetrievedItem(item) {
  const summary = item && item.summary && typeof item.summary === "object" ? item.summary : {};
  const capture = item && item.capture && typeof item.capture === "object" ? item.capture : {};
  const sourceKind = summary.sourceKind || capture.sourceKind || (capture.saucepanCore ? "saucepan" : "janitor");
  if (sourceKind === "saucepan") {
    const saucepanCreator = capture.saucepanCreator && typeof capture.saucepanCreator === "object" ? capture.saucepanCreator : {};
    const profile = saucepanCreator.profile && typeof saucepanCreator.profile === "object" ? saucepanCreator.profile : {};
    const saucepanCore = capture.saucepanCore && typeof capture.saucepanCore === "object" ? capture.saucepanCore : {};
    const companion = saucepanCore.companion && typeof saucepanCore.companion === "object" ? saucepanCore.companion : {};
    const creatorHandle = profile.creatorHandle || saucepanCreator.creatorHandle || companion.creatorHandle || summary.creator?.handle || null;
    if (!creatorHandle) return null;
    return {
      sourceKind: "saucepan",
      creatorId: profile.creatorId || saucepanCreator.creatorId || companion.creatorId || null,
      creatorHandle,
      creatorName: profile.displayName || summary.creator?.name || companion.creatorName || creatorHandle,
      url: saucepanCreator.profileUrl || profile.profileUrl || `https://saucepan.ai/u/${encodeURIComponent(creatorHandle)}`,
    };
  }
  const creator = capture.creator && typeof capture.creator === "object" ? capture.creator : {};
  const profile = creator.profile && typeof creator.profile === "object" ? creator.profile : {};
  const core = capture.janitorCore && typeof capture.janitorCore === "object" ? capture.janitorCore : {};
  const character = core.character && typeof core.character === "object" ? core.character : {};
  const creatorId = profile.creatorId || creator.creatorId || summary.creator?.id || character.creatorId || null;
  if (!creatorId) return null;
  return {
    sourceKind: "janitor",
    creatorId,
    creatorHandle: null,
    creatorName: profile.userName || profile.displayName || summary.creator?.name || character.creatorName || null,
    url: creator.profileUrl || profile.profileUrl || `https://janitorai.com/profiles/${encodeURIComponent(creatorId)}`,
  };
}

function openDetailCreatorFromRetrieved(source) {
  const request = buildCreatorRequestFromRetrievedItem(retrievedDetailItem);
  const url = buildCreatorSourceUrl(request);
  debugLog("detail_creator_link_click", {
    source,
    url,
    request,
    detailId: retrievedDetailItem && retrievedDetailItem.id || null,
  });
  if (url) {
    navigateSourcePageFromExtension(url, { reason: "detail_creator_click" });
    return true;
  }
  debugLog("detail_creator_link_no_url", {
    source,
    request,
    detailId: retrievedDetailItem && retrievedDetailItem.id || null,
  });
  return false;
}

function refreshCreatorViewFromCurrentState(source) {
  const request = creatorDetailState && creatorDetailState.request ? creatorDetailState.request : buildCurrentCreatorRequest();
  const url = buildCreatorSourceUrl(request);
  debugLog("creator_refresh_click", { source, url, request });
  if (url) {
    navigateSourcePageFromExtension(url, { reason: "creator_refresh_click" });
    return true;
  }
  if (isCurrentCreatorPage()) {
    openCurrentCreatorView({ force: true });
    return true;
  }
  debugLog("creator_refresh_no_request", { source, request, state: summarizeStateForDebug(currentState) });
  return false;
}

function retryUploadFromTarget(target, source) {
  const id = target && target.getAttribute("data-character-id");
  if (!id) {
    debugLog("retry_upload_blocked_no_id", { source });
    return false;
  }
  debugLog("retry_upload_sent", { source, characterId: id });
  chrome.runtime.sendMessage({ type: MessageTypes.SV2_RETRY_UPLOAD, characterId: id }, (response) => {
    debugLog("retry_upload_response", {
      source,
      characterId: id,
      runtimeError: chrome.runtime.lastError && chrome.runtime.lastError.message,
      ok: response && response.ok !== false,
      error: response && response.error || null,
    });
    requestRetrievedCharacters();
    renderRetrievalActivityPanel();
    if (retrievedDetailItem && retrievedDetailItem.id === id) openRetrievedDetail(id);
  });
  return true;
}

function sendJannyRecoveryActionFromTarget(target, action, source) {
  const jobId = target && target.getAttribute("data-job-id") || null;
  const type = action === "skip-janny-recovery" ? MessageTypes.SV_SKIP_JANNY_RECOVERY_NOW : MessageTypes.SV_OPEN_JANNY_RECOVERY_TAB;
  debugLog("janny_recovery_action_sent", { source, action, type, jobId });
  chrome.runtime.sendMessage({ type, jobId }, (response) => {
    debugLog("janny_recovery_action_response", {
      source,
      action,
      jobId,
      runtimeError: chrome.runtime.lastError && chrome.runtime.lastError.message,
      ok: response && response.ok !== false,
      error: response && response.error || null,
    });
  });
  return true;
}

function formatSaucepanProviderProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "vetted_only") return "Vetted providers";
  if (normalized === "all") return "All providers";
  if (normalized === "none") return "No providers";
  return String(value);
}

function getSaucepanDefinitionSectionsText(definition) {
  const root = definition && typeof definition === "object" ? definition : {};
  const selectedDefinition = root.selectedDefinition && typeof root.selectedDefinition === "object" ? root.selectedDefinition : {};
  const openDefinitionApi = root.openDefinitionApi && typeof root.openDefinitionApi === "object" ? root.openDefinitionApi : {};
  const sections = Array.isArray(root.definitionSections) && root.definitionSections.length
    ? root.definitionSections
    : Array.isArray(selectedDefinition.definitionSections) && selectedDefinition.definitionSections.length
      ? selectedDefinition.definitionSections
      : Array.isArray(openDefinitionApi.definitionSections) && openDefinitionApi.definitionSections.length
        ? openDefinitionApi.definitionSections
        : Array.isArray(selectedDefinition.decoded_sections) && selectedDefinition.decoded_sections.length
          ? selectedDefinition.decoded_sections
          : Array.isArray(openDefinitionApi.decoded_sections) && openDefinitionApi.decoded_sections.length
            ? openDefinitionApi.decoded_sections
            : [];
  if (!sections.length) return "";
  return sections
    .map((section, index) => {
      const title = section && (section.title || section.field) ? (section.title || section.field) : `Section ${index + 1}`;
      const meta = compactMeta([
        section && section.field ? `Field: ${section.field}` : null,
        section && section.source ? `Source: ${section.source}` : null,
      ]);
      const text = section && section.text ? section.text : "";
      return `${title}${meta ? `\n${meta}` : ""}\n\n${text}`.trim();
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function summarizeSaucepanDefinitionPayload(payload) {
  const root = payload && typeof payload === "object" ? payload : null;
  if (!root) return null;
  const parts = [];
  const keys = Object.keys(root).filter((key) => key !== "sections" && key !== "decoded_sections" && key !== "definitionSections");
  if (keys.length) parts.push(`Keys: ${keys.join(", ")}`);
  const sectionDecode = root.section_decode || root.sectionDecode;
  if (sectionDecode && typeof sectionDecode === "object") {
    parts.push(compactMeta([
      sectionDecode.format,
      sectionDecode.decoded_section_count != null ? `Decoded sections: ${formatNumber(sectionDecode.decoded_section_count)}` : null,
      Array.isArray(sectionDecode.decoded_fields) && sectionDecode.decoded_fields.length
        ? `Fields: ${sectionDecode.decoded_fields.join(", ")}`
        : null,
    ]));
  }
  const fieldLengths = ["card", "example_dialogue", "formatting_instructions", "advanced_prompt"]
    .map((field) => (typeof root[field] === "string" ? `${field}: ${formatNumber(root[field].length)} chars` : null))
    .filter(Boolean);
  if (fieldLengths.length) parts.push(fieldLengths.join("\n"));
  return parts.filter(Boolean).join("\n") || null;
}

function formatBool(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

function getScriptType(script) {
  return String(script && script.type ? script.type : "").trim().toLowerCase();
}
