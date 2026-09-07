"use strict";

/* ui/sidebar/views/datacat.js — datacat view render + helpers.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

function isRegisteredDatacatUser(user) {
  if (!user || typeof user !== "object") return false;
  const userType = String(user.userType || user.user_type || "").trim().toLowerCase();
  if (user.isAnonymous === true || user.is_anonymous === true || userType === "anonymous") return false;
  return (
    user.isRegistered === true ||
    user.is_registered === true ||
    userType === "registered" ||
    userType === "authenticated" ||
    String(user.role || "").trim().toLowerCase() === "admin"
  );
}

function getDatacatBadgeState() {
  const state = datacatState || {};
  const user = state.user && typeof state.user === "object" ? state.user : null;
  const connected = state.connected === true || state.authenticated === true || state.canUpload === true;
  const linkStatus = String(state.linkStatus || (connected ? "linked" : state.ok === false ? "unreachable" : "unlinked"));
  const registered = connected && isRegisteredDatacatUser(user);
  const anonymous = connected && (state.anonymous === true || !registered);
  const accountLabel = user && String(user.username || user.email || user.uuid || user.id || "").trim();
  const lastVerified = formatRelativeTime(state.lastVerifiedAt);
  const verifiedLabel = lastVerified ? `last verified ${lastVerified}` : "not yet verified";
  if (datacatLoading && connected) {
    return registered
      ? { className: "is-ok", symbol: "✓", label: `Linked to Datacat as ${accountLabel || "account"} · ${verifiedLabel}`, title: "Checking Datacat link.", action: "datacat-check", footerActionLabel: "Change" }
      : { className: "is-warn", symbol: "!", label: `Linked to Datacat anonymously · ${verifiedLabel}`, title: "Checking anonymous Datacat link.", action: "datacat-check", footerActionLabel: "Change" };
  }
  if (linkStatus === "linked" && registered) {
    return { className: "is-ok", symbol: "✓", label: `Linked to Datacat as ${accountLabel || "account"} · ${verifiedLabel}`, title: "Datacat account linked.", action: "datacat-check", footerActionLabel: "Change" };
  }
  if (linkStatus === "linked" && anonymous) {
    return { className: "is-warn", symbol: "!", label: `Linked to Datacat anonymously · ${verifiedLabel}`, title: "Anonymous Datacat account linked.", action: "datacat-check", footerActionLabel: "Change" };
  }
  if (linkStatus === "unreachable") {
    return {
      className: "is-danger",
      symbol: "!",
      label: `Datacat link offline · ${verifiedLabel}`,
      title: datacatError || state.message || "Datacat could not be reached; the existing link was kept.",
      action: "datacat-check",
      footerActionLabel: "Change",
    };
  }
  if (linkStatus === "relink_required") {
    return {
      className: "is-danger",
      symbol: "!",
      label: `Reconnect Datacat${accountLabel ? ` for ${accountLabel}` : ""}`,
      title: state.message || "Reconnect Datacat to continue.",
      action: "datacat-check",
      footerActionLabel: "Connect",
    };
  }
  if (datacatLoading) {
    return { className: "is-muted", symbol: "·", label: "Checking Datacat link...", title: "Checking Datacat link.", action: "datacat-check", footerActionLabel: null };
  }
  return {
    className: "is-danger",
    symbol: "!",
    label: "Datacat not linked",
    title: state.message || "Link this Chrome profile to a Datacat account.",
    action: "datacat-check",
    footerActionLabel: "Connect",
  };
}

function renderDatacatPanel() {
  if (!datacatPanel) return;
  const badge = getDatacatBadgeState();
  const manifest = chrome.runtime.getManifest();
  const extensionVersion = String(manifest.version_name || manifest.version || "").trim();
  datacatPanel.className = `datacat-status-panel ${badge.className}`;
  datacatPanel.innerHTML = `
    <div class="datacat-link-row">
      <button
        class="datacat-status-badge ${escapeHtml(badge.className)}"
        data-action="${escapeHtml(badge.action)}"
        title="${escapeHtml(badge.title)}"
        aria-label="${escapeHtml(`Datacat status: ${badge.label}`)}"
      >
        <span class="datacat-status-icon">${escapeHtml(badge.symbol)}</span>
        <span class="datacat-status-text">${escapeHtml(badge.label)}</span>
      </button>
      ${badge.footerActionLabel ? `<button class="datacat-footer-action" data-action="datacat-settings" type="button">${escapeHtml(badge.footerActionLabel)}</button>` : ""}
      ${extensionVersion ? `<span class="extension-version-label" title="${escapeHtml(`Pincat version ${extensionVersion}`)}" aria-label="${escapeHtml(`Pincat version ${extensionVersion}`)}">v${escapeHtml(extensionVersion)}</span>` : ""}
    </div>
  `;
}

function renderSourceSessionLine() {
  if (!sourceSessionLine) return;
  const state = currentState || {};
  const page = state.page && typeof state.page === "object" ? state.page : {};
  const auth = state.auth && typeof state.auth === "object" ? state.auth : null;
  const sourceKind = normalizeSourceKind(page.sourceKind);
  const hide = () => {
    sourceSessionLine.hidden = true;
    sourceSessionLine.textContent = "";
    sourceSessionLine.className = "source-session-line";
    if (uploadVisibilityNav) {
      uploadVisibilityNav.hidden = true;
      uploadVisibilityNav.textContent = "";
    }
  };
  if (!sourceKind || page.isDatacatSite || page.unsupported || !auth || auth.loggedIn !== true) {
    hide();
    return;
  }
  const sourceLabel = getSourceLabel(sourceKind);
  const account = getCurrentSourceAccountIdentity();
  const accountLabel = account && account.label ? account.label : "";
  const sessionLabel = accountLabel
    ? `Logged into ${sourceLabel} as ${accountLabel}`
    : `Logged into ${sourceLabel}`;
  sourceSessionLine.hidden = false;
  sourceSessionLine.className = `source-session-line source-session-badge is-ok is-${sourceKind}`;
  sourceSessionLine.textContent = sessionLabel;
  if (uploadVisibilityNav) {
    uploadVisibilityNav.hidden = false;
    uploadVisibilityNav.innerHTML = renderUploadVisibilitySelector({ className: "nav-visibility-selector" });
  }
}
