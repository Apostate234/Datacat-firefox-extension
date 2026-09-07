"use strict";
// background/source_accounts.js — source-account identity + approval gate
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, storage.js, broadcasts.js, tab_state.js (tabStates)

function normalizeAnnouncementSourceKind(value) {
  if (globalThis.SourceVaultSourceRegistry && typeof SourceVaultSourceRegistry.normalizeSourceId === "function") {
    const sourceId = SourceVaultSourceRegistry.normalizeSourceId(value);
    if (sourceId) return sourceId;
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (["global", "all", "companion", "source_vault"].includes(normalized)) return "global";
  if (normalized === "sauce" || normalized === "saucepan") return "saucepan";
  if (normalized === "janitor" || normalized === "janitorai" || normalized === "janny") return "janitor";
  return null;
}

function normalizeSourceAccountApprovalState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["confirmed", "confirm", "confirmed_new", "confirmed_dedicated", "dedicated"].includes(normalized)) {
    return SOURCE_ACCOUNT_APPROVAL_CONFIRMED;
  }
  if (["rejected", "blocked", "not_confirmed", "not_dedicated", "remove"].includes(normalized)) {
    return SOURCE_ACCOUNT_APPROVAL_REJECTED;
  }
  return null;
}

function buildSourceAccountKey(sourceKind, accountId) {
  const source = normalizeAnnouncementSourceKind(sourceKind);
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

function getStateSourceKind(state) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  const character = root.character && typeof root.character === "object" ? root.character : {};
  return normalizeAnnouncementSourceKind(page.sourceKind || character.sourceKind);
}

function getSourceAccountIdentity(state) {
  const root = state && typeof state === "object" ? state : {};
  const auth = root.auth && typeof root.auth === "object" ? root.auth : null;
  if (!auth || auth.loggedIn !== true) return null;
  const sourceKind = getStateSourceKind(root);
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

function getSourceAccountApprovalGate(state, approvals) {
  const root = state && typeof state === "object" ? state : {};
  const sourceKind = getStateSourceKind(root);
  const auth = root.auth && typeof root.auth === "object" ? root.auth : null;
  const loggedIn = !!(auth && auth.loggedIn === true);
  // Only derive identity when logged in (identity requires an auth user).
  const account = sourceKind && loggedIn ? getSourceAccountIdentity(root) : null;
  const approvalMap = approvals && typeof approvals === "object" ? approvals : {};
  const approval =
    account && approvalMap[account.key] && typeof approvalMap[account.key] === "object"
      ? approvalMap[account.key]
      : null;
  // Pure decision lives in shared/policy.js; keep account/approval context here.
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
    // A rejected approval is still relevant context; a confirmed one is only
    // surfaced when it actually granted access (matches prior behavior).
    approval: decision.allowed ? approval : approval && approval.state === SOURCE_ACCOUNT_APPROVAL_REJECTED ? approval : null,
  };
}

function buildSourceAccountSessionSummaries(approvals) {
  const sessions = {};
  if (globalThis.SourceVaultSourceRegistry && typeof SourceVaultSourceRegistry.list === "function") {
    for (const provider of SourceVaultSourceRegistry.list()) sessions[provider.id] = null;
  } else {
    sessions.janitor = null;
    sessions.saucepan = null;
  }
  for (const [tabId, state] of tabStates.entries()) {
    const root = state && typeof state === "object" ? state : {};
    const sourceKind = getStateSourceKind(root);
    if (!sourceKind) continue;
    if (!Object.prototype.hasOwnProperty.call(sessions, sourceKind)) sessions[sourceKind] = null;
    const gate = getSourceAccountApprovalGate(root, approvals);
    const updatedAt = Date.parse(root.lastUpdatedAt || "") || 0;
    const current = sessions[sourceKind];
    if (current && current.updatedAtMs > updatedAt) continue;
    sessions[sourceKind] = {
      tabId,
      sourceKind,
      gate,
      auth: root.auth || null,
      page: root.page || null,
      updatedAt: root.lastUpdatedAt || null,
      updatedAtMs: updatedAt,
    };
  }
  return sessions;
}

function getSourceKindFromTab(tab) {
  const rawUrl = String((tab && (tab.pendingUrl || tab.url)) || "").trim();
  if (!rawUrl) return null;
  if (globalThis.SourceVaultSourceRegistry && typeof SourceVaultSourceRegistry.resolveUrl === "function") {
    const resolved = SourceVaultSourceRegistry.resolveUrl(rawUrl);
    if (resolved && resolved.sourceKind) return resolved.sourceKind;
  }
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    if (hostname === "janitorai.com" || hostname === "www.janitorai.com") return "janitor";
    if (hostname === "saucepan.ai" || hostname === "www.saucepan.ai") return "saucepan";
  } catch (_) {}
  return null;
}

function pickSourceAccountRefreshTabs(tabs) {
  const selected = new Map();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    if (!tab || !tab.id) continue;
    const usage = getExtensionTabUsage(tab.id);
    if (usage && isQueueManagedUsage(usage)) continue;
    const sourceKind = getSourceKindFromTab(tab);
    if (!sourceKind) continue;
    const current = selected.get(sourceKind);
    const score = (tab.active === true ? 1e15 : 0) + Math.max(0, Number(tab.lastAccessed || 0));
    const currentScore = current
      ? (current.active === true ? 1e15 : 0) + Math.max(0, Number(current.lastAccessed || 0))
      : -1;
    if (!current || score > currentScore) selected.set(sourceKind, tab);
  }
  return selected;
}

function refreshSourceAccountTabState(tab) {
  return new Promise((resolve) => {
    sendMessageToContentTab(
      tab,
      { type: MessageTypes.SV_REFRESH_STATE, force: true, forceAuth: true },
      {
        injectOnMissing: true,
        retryMessage: { type: MessageTypes.SV_REFRESH_STATE, force: true, forceAuth: true },
      },
      (response) => {
        const state = response && response.state
          ? SourceVaultCore.sanitizeForTransport(response.state)
          : null;
        if (state) tabStates.set(tab.id, state);
        resolve({
          ok: !!state && (!response || response.ok !== false),
          tabId: tab.id,
          sourceKind: getSourceKindFromTab(tab),
          error: response && response.error ? response.error : state ? null : "content_state_unavailable",
        });
      },
    );
  });
}

async function refreshOpenSourceAccountStates() {
  const tabs = await tabsQuery({});
  const selected = pickSourceAccountRefreshTabs(tabs);
  return Promise.all(Array.from(selected.values(), refreshSourceAccountTabState));
}

async function getSourceAccountSessionStatus(sendResponse) {
  try {
    const refreshes = await refreshOpenSourceAccountStates().catch((error) => ([{
      ok: false,
      sourceKind: null,
      tabId: null,
      error: normalizeError(error),
    }]));
    const approvals = await readSourceAccountApprovals();
    sendResponse({
      ok: true,
      error: null,
      refreshes,
      sessions: buildSourceAccountSessionSummaries(approvals),
      approvals,
    });
  } catch (error) {
    sendResponse({ ok: false, error: normalizeError(error), sessions: {}, approvals: {} });
  }
}

async function readSourceAccountApprovals() {
  const result = await storageGet({ [SOURCE_ACCOUNT_APPROVALS_STORAGE_KEY]: {} });
  const stored = result[SOURCE_ACCOUNT_APPROVALS_STORAGE_KEY];
  return stored && typeof stored === "object" ? stored : {};
}

async function writeSourceAccountApproval(input) {
  const sourceKind = normalizeAnnouncementSourceKind(input && input.sourceKind);
  const account = input && input.account && typeof input.account === "object" ? input.account : {};
  const accountId = pickSourceAccountValue(account.id, input && input.accountId);
  const key = buildSourceAccountKey(sourceKind, accountId);
  const state = normalizeSourceAccountApprovalState(input && input.state);
  if (!sourceKind || !key || !accountId) throw new Error("source_account_missing_identity");
  if (!state) throw new Error("source_account_invalid_state");
  const approvals = await readSourceAccountApprovals();
  const label = pickSourceAccountLabel(account.label, account.name, account.userName, account.username, account.handle, accountId);
  approvals[key] = {
    key,
    sourceKind,
    id: accountId,
    label: label || accountId,
    state,
    decidedAt: new Date().toISOString(),
  };
  await storageSet({ [SOURCE_ACCOUNT_APPROVALS_STORAGE_KEY]: approvals });
  broadcast({ type: MessageTypes.SV2_SOURCE_ACCOUNT_APPROVALS_UPDATED, approvals });
  return approvals[key];
}
