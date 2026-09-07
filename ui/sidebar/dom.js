"use strict";

/* ui/sidebar/dom.js — DOM element references + escapeHtml / formatting helpers.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

const datacatPanel = document.getElementById("datacatPanel");
const announcementPanel = document.getElementById("announcementPanel");
const extensionUpdateBanner = document.getElementById("extensionUpdateBanner");
const debugPanel = document.getElementById("debugPanel");
const sourceSessionLine = document.getElementById("sourceSessionLine");
const authPanel = document.getElementById("authPanel");
const accountGatePanel = document.getElementById("accountGatePanel");
const characterPanel = document.getElementById("characterPanel");
const uploadOptionsPanel = document.getElementById("uploadOptionsPanel");
const preflightStatus = document.getElementById("preflightStatus");
const statusLine = document.getElementById("statusLine");
const summaryLine = document.getElementById("summaryLine");
const logList = document.getElementById("logList");
const retrieveButton = document.getElementById("retrieveButton");
const retrieveAgainLink = document.getElementById("retrieveAgainLink");
const retrievalActivityPanel = document.getElementById("retrievalActivityPanel");
const currentDetailsPanel = document.getElementById("currentDetailsPanel");
const refreshButton = document.getElementById("refreshButton");
const settingsButton = document.getElementById("settingsButton");
const captureButton = document.getElementById("captureButton");
const captureText = document.getElementById("captureText");
const retrievedPanel = document.getElementById("retrievedPanel");
const sidebarScrollRegion = document.getElementById("sidebarScrollRegion");
const activityToolbar = document.getElementById("activityToolbar");
const activitySearchInput = document.getElementById("activitySearchInput");
const activitySourceFilter = document.getElementById("activitySourceFilter");
const activityResultCount = document.getElementById("activityResultCount");
const currentPageTab = document.getElementById("currentPageTab");
const charactersTab = document.getElementById("charactersTab");
const uploadVisibilityNav = document.getElementById("uploadVisibilityNav");
const activeRetrievalIndicator = document.getElementById("activeRetrievalIndicator");
const currentPageView = document.getElementById("currentPageView");
const charactersView = document.getElementById("charactersView");
const latestSavedPanel = document.getElementById("latestSavedPanel");
const componentChecklist = document.getElementById("componentChecklist");
const queueAddDialog = document.getElementById("queueAddDialog");
const queueUrlInput = document.getElementById("queueUrlInput");
const queueUrlPreview = document.getElementById("queueUrlPreview");
const queueAddSubmit = document.getElementById("queueAddSubmit");
const creatorQueueConfirmDialog = document.getElementById("creatorQueueConfirmDialog");
const creatorQueueConfirmMessage = document.getElementById("creatorQueueConfirmMessage");
const creatorQueueConfirmSubmit = document.getElementById("creatorQueueConfirmSubmit");
const sourceAccountReviewDialog = document.getElementById("sourceAccountReviewDialog");
const sourceAccountReviewTitle = document.getElementById("sourceAccountReviewTitle");
const sourceAccountReviewIdentity = document.getElementById("sourceAccountReviewIdentity");
const sourceAccountReviewText = document.getElementById("sourceAccountReviewText");
const sourceAccountReviewCancel = document.getElementById("sourceAccountReviewCancel");
const sourceAccountReviewReject = document.getElementById("sourceAccountReviewReject");
const sourceAccountReviewApprove = document.getElementById("sourceAccountReviewApprove");

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function renderUiIcon(name, className = "") {
  const paths = {
    download: '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
    "more-vertical": '<circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle>',
    "pin-check": '<path d="M4 3h12l-2 6 3 3H3l3-3-2-6Z"></path><path d="M10 12v9"></path><path d="m18 12 4 4 7-9"></path>',
    "pin-plus": '<path d="M4 3h12l-2 6 3 3H3l3-3-2-6Z"></path><path d="M10 12v9"></path><path d="M23 7v10"></path><path d="M18 12h10"></path>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66"></path><path d="M20 4v7h-7"></path>',
  };
  const iconName = Object.prototype.hasOwnProperty.call(paths, name) ? name : "download";
  const safeClassName = String(className || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim();
  return `<svg class="ui-icon${safeClassName ? ` ${safeClassName}` : ""}" viewBox="0 0 ${iconName.startsWith("pin-") ? "30 24" : "24 24"}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[iconName]}</svg>`;
}

function formatDate(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

function formatNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat().format(n);
}

function compactMeta(parts) {
  return parts.filter((part) => part != null && String(part).trim() !== "").join(" · ");
}

function compactText(value, maxLength) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const limit = Number.isFinite(maxLength) ? maxLength : 240;
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trim()}...` : text;
}
