"use strict";

/* ui/sidebar/views/announcements.js — announcements view render + helpers.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

function getCurrentAnnouncementSourceKind() {
  const page = currentState && currentState.page && typeof currentState.page === "object" ? currentState.page : null;
  const sourceKind = String(page && page.sourceKind ? page.sourceKind : "").trim().toLowerCase();
  if (sourceKind === "janitor" || sourceKind === "saucepan") return sourceKind;
  return "global";
}

function announcementBodyToHtml(markdown) {
  if (!markdown) return "";
  const escape = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const escapeAttr = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  let html = escape(markdown);
  html = html.replace(
    /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
  return html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

function renderAnnouncementPanel() {
  if (!announcementPanel) return;
  const announcements = Array.isArray(announcementState.announcements)
    ? announcementState.announcements
    : announcementState.visible
      ? [announcementState.visible]
      : [];
  if (!announcements.length) {
    announcementPanel.hidden = true;
    announcementPanel.innerHTML = "";
    return;
  }
  const visibleAnnouncements = announcementState.showAll ? announcements : announcements.slice(0, 2);
  const hiddenCount = Math.max(0, announcements.length - visibleAnnouncements.length);
  announcementPanel.hidden = false;
  announcementPanel.innerHTML = `
    ${visibleAnnouncements.map((announcement) => {
      const dismissKey = announcement.clientDismissKey || announcement.dismissKey || announcement.id || "";
      return `
        <div class="source-announcement" role="status" aria-live="polite">
          <div class="source-announcement-copy">${announcementBodyToHtml(announcement.bodyMarkdown || "")}</div>
          <button class="source-announcement-close" data-action="dismiss-source-announcement" data-dismiss-key="${escapeHtml(dismissKey)}" aria-label="Dismiss announcement" title="Dismiss">×</button>
        </div>
      `;
    }).join("")}
    ${
      hiddenCount
        ? `<button class="source-announcement-more" data-action="toggle-source-announcements">show ${hiddenCount} more</button>`
        : announcementState.showAll && announcements.length > 2
          ? `<button class="source-announcement-more" data-action="toggle-source-announcements">show fewer</button>`
          : ""
    }
  `;
}

function renderExtensionUpdateBanner() {
  if (!extensionUpdateBanner) return;
  const currentVersion = String(extensionVersionState.currentVersion || "").trim();
  const latestVersion = String(extensionVersionState.latestVersion || "").trim();
  const downloadUrl = String(extensionVersionState.downloadUrl || "").trim();
  if (extensionVersionState.updateAvailable !== true || !currentVersion || !latestVersion || !downloadUrl) {
    extensionUpdateBanner.hidden = true;
    extensionUpdateBanner.innerHTML = "";
    return;
  }
  extensionUpdateBanner.hidden = false;
  extensionUpdateBanner.innerHTML = `
    <div class="extension-update-copy">
      <strong>v${escapeHtml(currentVersion)} is out of date.</strong>
      <a href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener noreferrer">Update to v${escapeHtml(latestVersion)}</a>
    </div>
  `;
}
