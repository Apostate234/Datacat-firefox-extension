"use strict";

/* ui/sidebar/legacy_app.js — remaining sidebar runtime (state model, coordinators, effects, handlers).
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 * This holds the current UI state variables and orchestration that have not yet been fully migrated to the store/selectors. It is NOT the entry file; ui/sidebar/index.js wires events + boot.
 */

"use strict";

const MessageTypes = (globalThis.SourceVaultMessages && SourceVaultMessages.MessageTypes) || {};

const SourceVaultCore = globalThis.SourceVaultCore || {};
const SourceVaultQueue = globalThis.SourceVaultQueue || {};
const SourceRegistry = globalThis.SourceVaultSourceRegistry || null;
const ANNOUNCEMENT_REFRESH_MS = 30000;
const DATACAT_STATE_REFRESH_MIN_MS = 15000;
const EXTENSION_VERSION_REFRESH_MS = 5 * 60 * 1000;
const DETAILS_LOADING_MIN_DWELL_MS = 250;
const PAGE_STATE_FALLBACK_MS = 1200;
const DEBUG_LOG_LIMIT = 120;
const POINTER_ACTION_REPLAY_MS = 700;
const ACTIVITY_PAGE_SIZE = 20;

let currentState = null;
let retrievedList = [];
let activeMainTab = "detected";
let retrievedDetailItem = null;
let retrievedDetailTab = "core";
let inspectionState = { active: false, kind: null, characterId: null, origin: null };
let expandedRecentId = null;
let selectedActivityId = null;
let pendingActivityDatacatNavigation = null;
let activityVisibleLimit = ACTIVITY_PAGE_SIZE;
let activitySearchQuery = "";
let activitySourceFilterValue = "all";
let activityFilteredCount = 0;
let activityScrollTicking = false;
let retrievedLoading = false;
let retrievedError = null;
let latestSavedCharacter = null;
let retrievalDisplayMachine = {
  focusTabId: null,
  focusState: null,
  flight: null,
};
let pageStateCoordinator = SourceVaultSidebarStore.createCoordinator();
let datacatState = {
  origin: "https://datacat.run",
  authenticated: false,
  connected: false,
  canUpload: false,
  sessionReady: false,
  message: "Connect Datacat to save.",
};
let datacatLoading = false;
let datacatError = null;
let datacatStateRequestInFlight = false;
let datacatStateLastSettledAt = 0;
let datacatStateRequestSeq = 0;
let uploadVisibility = "public";
let preflightState = null;
let preflightLoading = false;
let preflightError = null;
let preflightKey = null;
let preflightSeq = 0;
let announcementState = {
  sourceKind: null,
  loading: false,
  error: null,
  visible: null,
  announcements: [],
  showAll: false,
  requestKey: null,
  seq: 0,
  lastRequestedAt: 0,
};
let sourceAccountApprovals = {};
let sourceAccountApprovalsLoading = false;
let sourceAccountApprovalsError = null;
let sourceAccountApprovalsRequestSeq = 0;
let sourceAccountApprovalsDecisionSeq = 0;
const promptedSourceAccountReviewKeys = new Set();
let sourceAccountReviewDecision = null;
let announcementRefreshTimer = null;
let extensionVersionRefreshTimer = null;
let extensionVersionState = {
  loading: false,
  error: null,
  currentVersion: null,
  latestVersion: null,
  updateAvailable: false,
  downloadUrl: null,
  lastRequestedAt: 0,
  seq: 0,
};
let activeBrowserTabId = null;
let panelWindowId = null;
let queueState = {
  revision: 0,
  status: "idle",
  activeItem: null,
  activeItemId: null,
  pending: [],
  finished: [],
  counts: { outstanding: 0, pending: 0, finished: 0, total: 0 },
};
let queueLoading = true;
let queueError = null;
let pendingCreatorQueueItems = [];
let optimisticQueueItems = [];
let queueOverlayExpanded = false;
let queueOverlayVisible = false;
let thumbnailCacheEntries = {};
let thumbnailRequestTimer = null;
const thumbnailRequestInFlightKeys = new Set();
let currentCreatorOpenSeq = 0;
let currentDetailsLoadingSeq = 0;
let currentInspectionOpenSeq = 0;
let creatorDetailState = {
  active: false,
  loading: false,
  error: null,
  record: null,
  freshness: null,
  request: null,
  phase: null,
};
let currentDetailsMessageState = null;
let currentPageTerminalState = null;
let dismissedCurrentPageStatusSignature = null;
let lastRenderedPageSignature = null;
let autoCreatorOpenKey = null;
let autoCreatorOpenTimer = null;
let autoCharacterDetailOpenKey = null;
let pendingSourceNavigationUrl = null;
let debugEnabled = false;
let debugCollapsed = true;
let debugLogs = [];
let debugSeq = 0;
let pendingRetrievalStartSeq = 0;
let debugPointerToggleAt = 0;
let pointerHandledActionAt = 0;
let pointerHandledActionSignature = "";

// The store owns cross-surface state. Legacy globals remain compatibility
// mirrors until the remaining render helpers are fully view-model driven.
const sidebarStore = SourceVaultSidebarStore.createStore({
  ...SourceVaultSidebarStore.createInitialState(),
  currentState,
  retrievedList,
  activeMainTab,
  queueState,
  datacatState,
  uploadVisibility,
  preflightState,
  sourceAccountApprovals,
  creatorDetail: creatorDetailState,
  inspection: inspectionState,
  coordinator: pageStateCoordinator,
});

function dispatchSidebar(action) {
  sidebarStore.dispatch(action);
  const state = sidebarStore.getState();
  currentState = state.currentState;
  retrievedList = state.retrievedList;
  activeMainTab = state.activeMainTab;
  queueState = state.queueState;
  datacatState = state.datacatState;
  uploadVisibility = state.uploadVisibility;
  preflightState = state.preflightState;
  sourceAccountApprovals = state.sourceAccountApprovals;
  creatorDetailState = state.creatorDetail;
  inspectionState = state.inspection;
  activeBrowserTabId = state.activeBrowserTabId;
  pageStateCoordinator = state.coordinator;
  return state;
}

function updateCreatorDetailState(patch) {
  dispatchSidebar({
    type: SourceVaultSidebarStore.ActionTypes.CREATOR_UPDATED,
    creatorDetail: patch && typeof patch === "object" ? patch : {},
  });
  return creatorDetailState;
}

function sanitizeRecentStatusText(value) {
  const text = compactText(value, 160);
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("waiting in queue")) return "Waiting in queue.";
  if (lower.includes("source page action") || lower.includes("continue in the opened source")) {
    return "Action is required in the opened source tab.";
  }
  if (lower.includes("failed") || lower.includes("error")) return "Retrieval needs attention.";
  if (
    lower.includes("mirror") || lower.includes("media") || lower.includes("score") || lower.includes("scoring") ||
    lower.includes("upload") || lower.includes("uploaded") || lower.includes("local") || lower.includes("persist") ||
    lower.includes("saved") || lower.includes("prepare") || lower.includes("processing")
  ) {
    return "Processing result.";
  }
  if (lower.includes("complete") || lower.includes("completed") || lower.includes("captured") || lower.includes("success")) {
    return "Retrieval completed.";
  }
  if (
    lower.includes("creator") || lower.includes("janny") || lower.includes("recovery") || lower.includes("core") ||
    lower.includes("character") || lower.includes("source") || lower.includes("read") || lower.includes("fetch") ||
    lower.includes("request") || lower.includes("opening") || lower.includes("loading")
  ) return "Collecting source data.";
  return "Retrieval in progress.";
}

function sanitizeRecentLogEntry(entry) {
  const root = entry && typeof entry === "object" ? entry : {};
  const stage = String(root.stage || "").trim().toLowerCase();
  const rawMessage = root.message || root.summary;
  const message = rawMessage ? sanitizeRecentStatusText(rawMessage) : "";
  if (message) return message;
  if (stage.includes("janny") || stage.includes("creator") || stage.includes("core") || stage.includes("source")) {
    return "Collecting source data.";
  }
  if (stage.includes("mirror") || stage.includes("media")) return "Processing result.";
  if (stage.includes("score") || stage.includes("upload") || stage.includes("persist") || stage.includes("save")) {
    return "Processing result.";
  }
  return "Retrieval in progress.";
}

function normalizeUploadVisibility(value) {
  return String(value || "").trim().toLowerCase() === "mine" ? "mine" : "public";
}

function getCurrentCharacterId() {
  const character = currentState && currentState.character ? currentState.character : null;
  const page = currentState && currentState.page ? currentState.page : null;
  return character && (character.id || character.characterId || character.companionId) || page && page.characterId || null;
}

function getCurrentSourceKind() {
  const page = currentState && currentState.page ? currentState.page : null;
  const character = currentState && currentState.character ? currentState.character : null;
  if (page && (page.isDatacatSite || page.unsupported)) return null;
  return page && page.sourceKind
    ? page.sourceKind
    : character && character.sourceKind
      ? character.sourceKind
      : "janitor";
}

function normalizeSourceKind(value) {
  if (SourceRegistry && typeof SourceRegistry.normalizeSourceId === "function") {
    const sourceId = SourceRegistry.normalizeSourceId(value);
    if (sourceId) return sourceId;
  }
  if (typeof SourceVaultCore.normalizeSourceKind === "function") {
    return SourceVaultCore.normalizeSourceKind(value);
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "sauce" || normalized === "saucepan") return "saucepan";
  if (normalized === "janitor" || normalized === "janitorai" || normalized === "janny") return "janitor";
  return null;
}

function getSourceDescriptor(value) {
  const sourceKind = normalizeSourceKind(value);
  return SourceRegistry && typeof SourceRegistry.get === "function" ? SourceRegistry.get(sourceKind) : null;
}

function getSourceLabel(value, fallback = "Source") {
  const descriptor = getSourceDescriptor(value);
  return descriptor && descriptor.displayName ? descriptor.displayName : fallback;
}

function isGenericCharacterTitle(value) {
  if (typeof SourceVaultCore.isGenericSourceCharacterTitle === "function") {
    const sourceKind = getCurrentSourceKind();
    return SourceVaultCore.isGenericSourceCharacterTitle(sourceKind, value);
  }
  const text = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text) return true;
  if ([
    "character profile",
    "chats",
    "create a character",
    "followers",
    "following",
    "janitor",
    "janitor ai",
    "my chats",
    "new chat",
    "search",
  ].includes(text)) {
    return true;
  }
  return (
    /^janitor(?:ai)?(?:\.com)?\b/.test(text) ||
    /janitor\s*(?:ai)?\s*[-|:–—]\s*build,\s*share,\s*and\s*explore/.test(text) ||
    /search for characters/.test(text)
  );
}

function isCharacterStateSettled(character, page) {
  const pageRoot = page && typeof page === "object" ? page : {};
  if (!pageRoot.isCharacterPage) return true;
  const root = character && typeof character === "object" ? character : null;
  const sourceKind = normalizeSourceKind(pageRoot.sourceKind || (root && root.sourceKind));
  if (typeof SourceVaultCore.isSettledSourceCharacterState === "function") {
    return SourceVaultCore.isSettledSourceCharacterState(sourceKind, root, pageRoot);
  }
  if (!root || !root.name || isGenericCharacterTitle(root.name)) return false;
  if (
    ["document_body", "document_fallback", "document_og_title", "document_title", "document_twitter_title", "url"]
      .includes(String(root.source || "").trim())
  ) {
    return false;
  }
  return true;
}

function isCurrentCharacterSettling() {
  const page = currentState && currentState.page ? currentState.page : null;
  const character = currentState && currentState.character ? currentState.character : null;
  return !!(page && page.isCharacterPage && !isCharacterStateSettled(character, page));
}

function normalizeSourceAccountApprovalState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["confirmed", "confirm", "confirmed_new", "confirmed_dedicated", "dedicated"].includes(normalized)) {
    return "confirmed_dedicated";
  }
  if (["rejected", "blocked", "not_confirmed", "not_dedicated", "remove"].includes(normalized)) {
    return "rejected";
  }
  return null;
}

function buildSourceAccountKey(sourceKind, accountId) {
  const source = normalizeSourceKind(sourceKind);
  const id = String(accountId || "").trim().toLowerCase();
  return source && id ? `${source}::${id}` : null;
}

function pickSourceAccountValue(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function pickSourceAccountLabel(...values) {
  const fallback = pickSourceAccountValue(...values);
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text && !isUuidLike(text)) return text;
  }
  return fallback && !isUuidLike(fallback) ? fallback : "detected account";
}

function getCurrentSourceAccountIdentity() {
  const auth = currentState && currentState.auth && typeof currentState.auth === "object" ? currentState.auth : null;
  if (!auth || auth.loggedIn !== true) return null;
  const sourceKind = normalizeSourceKind(getCurrentSourceKind());
  if (!sourceKind) return null;
  const user = auth.user && typeof auth.user === "object" ? auth.user : {};
  const id = pickSourceAccountValue(
    user.id,
    user.userId,
    user.uuid,
    user.profileId,
    user.publicId,
    user.handle,
    user.userName,
    user.username,
    user.name,
    auth.userId,
    auth.username,
    auth.name,
  );
  const key = buildSourceAccountKey(sourceKind, id);
  if (!key) return null;
  const label = pickSourceAccountLabel(
    user.displayName,
    user.name,
    user.handle,
    user.userName,
    user.username,
    auth.displayName,
    auth.name,
    id,
  );
  return {
    key,
    id,
    label: label || id,
    sourceKind,
  };
}

function getCurrentSourceAccountGate() {
  const sourceKind = normalizeSourceKind(getCurrentSourceKind());
  const auth = currentState && currentState.auth && typeof currentState.auth === "object" ? currentState.auth : null;
  const loggedIn = !!(auth && auth.loggedIn === true);
  const account = sourceKind && loggedIn ? getCurrentSourceAccountIdentity() : null;
  const approval =
    account && sourceAccountApprovals && sourceAccountApprovals[account.key] && typeof sourceAccountApprovals[account.key] === "object"
      ? sourceAccountApprovals[account.key]
      : null;
  // Display-only decision: defer to the shared policy helper so the sidebar
  // never invents block rules that differ from the background gate.
  const decision = SourceVaultPolicy.evaluateAccountGate({
    sourceKind,
    loggedIn,
    hasIdentity: !!account,
    approvalState: approval ? approval.state : null,
  });
  return {
    required: decision.required,
    allowed: decision.allowed,
    reason: decision.reason,
    sourceKind: decision.sourceKind,
    canPin: decision.canPin,
    blockReason: decision.blockReason,
    accountGate: decision.accountGate,
    account: account || null,
    approval: decision.allowed
      ? approval
      : approval && normalizeSourceAccountApprovalState(approval.state) === "rejected"
        ? approval
        : null,
  };
}

function getDatacatAccountLabel() {
  const state = datacatState && typeof datacatState === "object" ? datacatState : {};
  const user = state.user && typeof state.user === "object" ? state.user : {};
  return pickSourceAccountLabel(
    user.displayName,
    user.display_name,
    user.name,
    user.username,
    user.userName,
    user.handle,
    user.uuid,
    user.id,
  );
}

function getDetectedSourceContext(page) {
  const root = page && typeof page === "object" ? page : {};
  if (root.isDatacatSite) {
    return { label: "DATACAT", loginLabel: "Datacat", className: "is-datacat", sourceKind: "datacat" };
  }
  const sourceKind = normalizeSourceKind(root.sourceKind);
  const provider = SourceRegistry && typeof SourceRegistry.get === "function" ? SourceRegistry.get(sourceKind) : null;
  if (provider) {
    const label = provider.displayName || provider.label || provider.id;
    return { label: String(label).toUpperCase(), loginLabel: label, className: `is-${provider.id}`, sourceKind: provider.id };
  }
  if (sourceKind === "saucepan") {
    return { label: "SAUCEPAN", loginLabel: "Saucepan", className: "is-saucepan", sourceKind };
  }
  if (sourceKind === "janitor") {
    return { label: "JANITOR", loginLabel: "Janitor", className: "is-janitor", sourceKind };
  }
  return { label: "UNKNOWN WEBSITE", loginLabel: "Unknown website", className: "is-unknown", sourceKind: "unknown" };
}

function getDetectedLoginLine(page) {
  const root = page && typeof page === "object" ? page : {};
  const context = getDetectedSourceContext(root);
  if (context.sourceKind === "datacat") {
    const state = datacatState && typeof datacatState === "object" ? datacatState : {};
    const connected = state.connected === true || state.authenticated === true || state.canUpload === true;
    const registered = connected && isRegisteredDatacatUser(state.user);
    if (datacatLoading && !connected) return "Checking Datacat link...";
    if (registered) return `Logged into Datacat as ${getDatacatAccountLabel()}`;
    if (connected) return "Datacat anonymous session";
    return "Not logged into Datacat";
  }
  if (context.sourceKind === "unknown") return "No supported source login detected";
  const auth = currentState && currentState.auth && typeof currentState.auth === "object" ? currentState.auth : null;
  if (auth && auth.checking) return `Checking ${context.loginLabel} login...`;
  if (auth && auth.loggedIn) {
    const account = getCurrentSourceAccountIdentity();
    const accountLabel = account && account.label ? account.label : "detected account";
    return `Logged into ${context.loginLabel} as ${accountLabel}`;
  }
  return `Not logged into ${context.loginLabel}`;
}

function isDetectedLoginChecking(page) {
  const root = page && typeof page === "object" ? page : {};
  const context = getDetectedSourceContext(root);
  if (context.sourceKind === "datacat") {
    const state = datacatState && typeof datacatState === "object" ? datacatState : {};
    const connected = state.connected === true || state.authenticated === true || state.canUpload === true;
    return datacatLoading && !connected;
  }
  if (context.sourceKind === "unknown") return false;
  const auth = currentState && currentState.auth && typeof currentState.auth === "object" ? currentState.auth : null;
  return !!(auth && auth.checking);
}

function getDetectedContentTypeLabel(page) {
  const root = page && typeof page === "object" ? page : {};
  if (root.isCharacterPage) return "Detected character";
  if (root.isCreatorPage) return "Detected creator";
  if (root.isDatacatSite) return "Datacat repository";
  return "Unknown content";
}

function getStatePageSignature(state) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  const character = root.character && typeof root.character === "object" ? root.character : {};
  return JSON.stringify({
    url: page.url || page.normalizedUrl || "",
    sourceKind: normalizeSourceKind(page.sourceKind) || (page.isDatacatSite ? "datacat" : "unknown"),
    isCharacterPage: page.isCharacterPage === true,
    isCreatorPage: page.isCreatorPage === true,
    isDatacatSite: page.isDatacatSite === true,
    unsupported: page.unsupported === true,
    characterId: character.id || character.characterId || character.companionId || page.characterId || page.companionId || null,
    creatorId: page.creatorId || character.creatorId || null,
    creatorHandle: page.creatorHandle || character.creatorHandle || null,
  });
}

function getCreatorRequestKey(request) {
  const root = request && typeof request === "object" ? request : {};
  const sourceKind = normalizeSourceKind(root.sourceKind) || "source";
  const id = root.creatorId || root.creatorHandle || root.url || root.profileUrl || "";
  return `${sourceKind}:${String(id).trim().toLowerCase()}`;
}

function creatorRequestMatchesPage(request, page) {
  const root = request && typeof request === "object" ? request : {};
  const pageRoot = page && typeof page === "object" ? page : {};
  if (!pageRoot.isCreatorPage) return false;
  const requestSource = normalizeSourceKind(root.sourceKind);
  const pageSource = normalizeSourceKind(pageRoot.sourceKind);
  if (requestSource && pageSource && requestSource !== pageSource) return false;
  if (root.creatorId && pageRoot.creatorId && String(root.creatorId).toLowerCase() !== String(pageRoot.creatorId).toLowerCase()) return false;
  if (
    root.creatorHandle &&
    pageRoot.creatorHandle &&
    String(root.creatorHandle).toLowerCase() !== String(pageRoot.creatorHandle).toLowerCase()
  ) {
    return false;
  }
  if (root.creatorId || root.creatorHandle) return true;
  return !!(root.url && pageRoot.normalizedUrl && String(root.url).toLowerCase() === String(pageRoot.normalizedUrl).toLowerCase());
}

function creatorRequestsMatch(a, b) {
  const left = a && typeof a === "object" ? a : {};
  const right = b && typeof b === "object" ? b : {};
  const leftSource = normalizeSourceKind(left.sourceKind);
  const rightSource = normalizeSourceKind(right.sourceKind);
  if (leftSource && rightSource && leftSource !== rightSource) return false;
  if (left.creatorId && right.creatorId && String(left.creatorId).toLowerCase() === String(right.creatorId).toLowerCase()) return true;
  if (
    left.creatorHandle &&
    right.creatorHandle &&
    String(left.creatorHandle).toLowerCase() === String(right.creatorHandle).toLowerCase()
  ) {
    return true;
  }
  return !!(left.url && right.url && String(left.url).toLowerCase() === String(right.url).toLowerCase());
}

function isCreatorRequestCurrentPage(request) {
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : null;
  return !!(page && page.isCreatorPage && creatorRequestMatchesPage(request, page));
}

function handleActivePageTransition(nextState) {
  const nextSignature = getStatePageSignature(nextState);
  const pageChanged = lastRenderedPageSignature != null && nextSignature !== lastRenderedPageSignature;
  lastRenderedPageSignature = nextSignature;
  const page = nextState && nextState.page && typeof nextState.page === "object" ? nextState.page : {};
  if (!page.isCreatorPage) autoCreatorOpenKey = null;
  if (!pageChanged) return;
  currentPageTerminalState = null;
  dismissedCurrentPageStatusSignature = null;
  autoCharacterDetailOpenKey = null;
  preflightState = null;
  preflightError = null;
  preflightLoading = false;
  preflightKey = null;
  if (!inspectionState.active) {
    if (retrievedDetailItem) retrievedDetailItem = null;
    if (currentDetailsMessageState) currentDetailsMessageState = null;
    currentDetailsLoadingSeq += 1;
  }
  if (!creatorDetailState || !creatorDetailState.active) return;
  if (creatorRequestMatchesPage(creatorDetailState.request, page)) return;
  currentCreatorOpenSeq += 1;
  updateCreatorDetailState({
    active: false,
    loading: false,
    error: null,
    phase: null,
  });
  retrievedDetailItem = null;
  if (
    (page.isCharacterPage || page.isCreatorPage || page.isDatacatSite || page.unsupported) &&
    !shouldPreserveActivityForDatacatState(nextState)
  ) {
    setActiveMainTab("detected", { skipRefresh: true });
  }
}

function maybeAutoOpenCurrentCreatorView() {
  if (inspectionState.active) return;
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : null;
  if (!page || !page.isCreatorPage) return;
  if (page.pendingNavigation) return;
  if (!canOpenCurrentCreatorPage()) return;
  const request = buildCurrentCreatorRequest();
  if (!request) return;
  const key = getCreatorRequestKey(request);
  if (!key || key === "source:") return;
  if (creatorDetailState && creatorDetailState.active && creatorRequestsMatch(creatorDetailState.request, request)) {
    autoCreatorOpenKey = key;
    return;
  }
  if (autoCreatorOpenTimer && autoCreatorOpenKey === key) return;
  autoCreatorOpenKey = key;
  if (autoCreatorOpenTimer) clearTimeout(autoCreatorOpenTimer);
  autoCreatorOpenTimer = setTimeout(() => {
    autoCreatorOpenTimer = null;
    const latestRequest = buildCurrentCreatorRequest();
    if (!latestRequest || getCreatorRequestKey(latestRequest) !== key || !canOpenCurrentCreatorPage()) return;
    openCurrentCreatorView({ auto: true });
  }, 120);
}

function maybeAutoOpenCurrentCharacterDetail() {
  // Character details are an explicit inspection surface. Creator pages still
  // auto-open because they are the page itself; saved character details do not.
  autoCharacterDetailOpenKey = null;
  return false;
}

function getCurrentCreatorInfo() {
  const character = currentState && currentState.character ? currentState.character : {};
  const page = currentState && currentState.page ? currentState.page : {};
  return {
    sourceKind: getCurrentSourceKind(),
    creatorId: character.creatorId || page.creatorId || null,
    creatorHandle: character.creatorHandle || page.creatorHandle || null,
    creatorName: character.creatorName || page.creatorName || page.creatorHandle || null,
    profileUrl: page && page.isCreatorPage ? page.normalizedUrl || page.url || null : null,
  };
}

function isCurrentCreatorPage() {
  const page = currentState && currentState.page ? currentState.page : null;
  return !!(page && page.isCreatorPage && (page.creatorId || page.creatorHandle));
}

function buildCurrentCreatorRequest() {
  const creator = getCurrentCreatorInfo();
  if (!creator || (!creator.creatorId && !creator.creatorHandle && !creator.profileUrl)) return null;
  return {
    sourceKind: creator.sourceKind,
    creatorId: creator.creatorId || null,
    creatorHandle: creator.creatorHandle || null,
    creatorName: creator.creatorName || null,
    url: creator.profileUrl || null,
  };
}

function buildCreatorRequestFromCharacter(character, page) {
  const root = character && typeof character === "object" ? character : {};
  const pageRoot = page && typeof page === "object" ? page : {};
  const request = {
    sourceKind: normalizeSourceKind(root.sourceKind || pageRoot.sourceKind || getCurrentSourceKind()),
    creatorId: root.creatorId || pageRoot.creatorId || null,
    creatorHandle: root.creatorHandle || pageRoot.creatorHandle || null,
    creatorName: root.creatorName || pageRoot.creatorName || pageRoot.creatorHandle || null,
    url: root.creatorUrl || root.creatorProfileUrl || null,
  };
  return request.creatorId || request.creatorHandle || request.url ? request : null;
}

function renderCreatorLinkAttributes(character, page) {
  const request = buildCreatorRequestFromCharacter(character, page);
  if (!request) return "";
  return [
    `data-source-kind="${escapeHtml(request.sourceKind || "")}"`,
    `data-creator-id="${escapeHtml(request.creatorId || "")}"`,
    `data-creator-handle="${escapeHtml(request.creatorHandle || "")}"`,
    `data-creator-name="${escapeHtml(request.creatorName || "")}"`,
    `data-creator-url="${escapeHtml(request.url || "")}"`,
  ].join(" ");
}

function buildCreatorRequestFromTarget(target) {
  const root = target && typeof target.getAttribute === "function" ? target : null;
  if (!root) return null;
  const request = {
    sourceKind: normalizeSourceKind(root.getAttribute("data-source-kind")),
    creatorId: root.getAttribute("data-creator-id") || null,
    creatorHandle: root.getAttribute("data-creator-handle") || null,
    creatorName: root.getAttribute("data-creator-name") || null,
    url: root.getAttribute("data-creator-url") || null,
  };
  return request.creatorId || request.creatorHandle || request.url ? request : null;
}

function getCurrentCreatorDetailSummary() {
  const state = creatorDetailState && typeof creatorDetailState === "object" ? creatorDetailState : {};
  const record = state.record && typeof state.record === "object" ? state.record : null;
  if (!record) return null;
  const summary = record.summary && typeof record.summary === "object" ? record.summary : {};
  const request = state.request && typeof state.request === "object"
    ? state.request
    : {
        sourceKind: record.sourceKind || summary.sourceKind || null,
        creatorId: record.creatorId || summary.creatorId || null,
        creatorHandle: record.creatorHandle || summary.creatorHandle || null,
      };
  if (!isCreatorRequestCurrentPage(request)) return null;
  return summary;
}

function normalizeCurrentSourceCharacterVisibility(value) {
  if (value === false) return "private";
  if (value === true) return "public";
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (["private", "owner", "mine", "only_me", "only-me"].includes(normalized)) return "private";
  if (["unlisted", "link_only", "link-only"].includes(normalized)) return "unlisted";
  if (["public", "published", "listed"].includes(normalized)) return "public";
  return "unknown";
}

function getCurrentSourceCharacterVisibility() {
  const character = currentState && currentState.character ? currentState.character : {};
  const page = currentState && currentState.page ? currentState.page : {};
  const candidates = [
    character.visibility,
    character.privacy,
    character.accessLevel,
    character.access_level,
    character.isPublic,
    character.is_public,
    page.sourceVisibility,
    page.source_visibility,
    page.visibility,
    page.privacy,
    page.accessLevel,
    page.access_level,
    page.isPublic,
    page.is_public,
  ];
  let resolved = "unknown";
  for (const value of candidates) {
    const normalized = normalizeCurrentSourceCharacterVisibility(value);
    if (normalized === "private") return "private";
    if (normalized === "unlisted") resolved = "unlisted";
    else if (normalized === "public" && resolved === "unknown") resolved = "public";
  }
  return resolved;
}

function isCurrentSourceCharacterPrivate() {
  const visibility = getCurrentSourceCharacterVisibility();
  return visibility === "private" || visibility === "unlisted";
}

function buildDatacatUrl(path) {
  const origin = datacatState && datacatState.origin ? datacatState.origin : "https://datacat.run";
  try {
    return new URL(String(path || "/"), origin).toString();
  } catch (_) {
    return `${origin}${String(path || "").startsWith("/") ? "" : "/"}${path || ""}`;
  }
}

function normalizeComparableSourceUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return `${url.origin}${url.pathname}${url.search}`.toLowerCase();
  } catch (_) {
    return String(value || "").replace(/#.*$/, "").toLowerCase();
  }
}

function getComparableSourceIdentity(value) {
  const url = String(value || "").trim();
  if (!url) return null;
  const parsers = [
    ["janitor-character", SourceVaultCore.parseJanitorCharacterUrl, "characterId"],
    ["janitor-creator", SourceVaultCore.parseJanitorCreatorUrl, "creatorId"],
    ["saucepan-character", SourceVaultCore.parseSaucepanCompanionUrl, "companionId"],
    ["saucepan-creator", SourceVaultCore.parseSaucepanCreatorUrl, "handle"],
  ];
  for (const [kind, parser, idKey] of parsers) {
    if (typeof parser !== "function") continue;
    const parsed = parser(url);
    const id = parsed && parsed.valid ? parsed[idKey] : null;
    if (id) return `${kind}:${String(id).trim().toLowerCase()}`;
  }
  return normalizeComparableSourceUrl(url);
}

function sourceUrlsMatch(left, right) {
  const leftIdentity = getComparableSourceIdentity(left);
  const rightIdentity = getComparableSourceIdentity(right);
  return !!(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

function getStateRevision(state) {
  const value = Number(state && state.revision);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getStateNavigationId(state) {
  const page = state && state.page && typeof state.page === "object" ? state.page : {};
  const value = Number(page.navigationId);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function getStateContextKey(tabId, state) {
  const page = state && state.page && typeof state.page === "object" ? state.page : {};
  const instanceId = String(state && state.instanceId || page.contentInstanceId || "background");
  const identity = getComparableSourceIdentity(page.normalizedUrl || page.url || "") || getStatePageSignature(state);
  return `${Number(tabId || 0)}:${instanceId}:${getStateNavigationId(state)}:${identity}`;
}

function isStateDisplaySettled(state) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  if (!root.page || page.pendingNavigation || page.navigationPhase === "loading") return false;
  if (page.isCharacterPage) return isCharacterStateSettled(root.character, page);
  return true;
}

// Phase 5: acceptance decision + bookkeeping are owned by ui/sidebar/store.js
// (the single, unit-tested implementation). These thin wrappers pass the live
// coordinator/currentState/flight-owner context so runtime behaviour is
// identical to the pre-split shouldAcceptIncomingState/recordAcceptedIncomingState.
