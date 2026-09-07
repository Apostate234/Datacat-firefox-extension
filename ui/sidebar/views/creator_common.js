"use strict";

/* ui/sidebar/views/creator.js — creator view render + helpers.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

function renderField(label, value) {
  const text = value == null || value === "" ? "Not saved" : String(value);
  return `
    <div class="detail-field">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${escapeHtml(text)}</div>
    </div>
  `;
}

function renderLinkList(label, links) {
  const cleaned = Array.from(new Set((links || []).filter((link) => link && String(link).trim()).map(String)));
  if (!cleaned.length) return renderField(label, "Not saved");
  return `
    <div class="detail-field">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="asset-link-list">
        ${cleaned
          .map((link) => {
            const safe = escapeHtml(link);
            return `<a class="asset-link" href="${safe}" target="_blank" rel="noreferrer noopener">${safe}</a>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function makeTextSection(label, value) {
  const text = normalizeSectionText(value);
  return {
    label,
    text,
    length: text.length,
    html: `<div class="detail-value">${escapeHtml(text || "Not saved")}</div>`,
  };
}

function makeHtmlSection(label, text, html) {
  const normalized = normalizeSectionText(text);
  return {
    label,
    text: normalized,
    length: normalized.length,
    html: html || `<div class="detail-value">${escapeHtml(normalized || "Not saved")}</div>`,
  };
}

function makeLinkSection(label, links) {
  const cleaned = Array.from(new Set((links || []).filter((link) => link && String(link).trim()).map(String)));
  return makeHtmlSection(
    label,
    cleaned.join("\n"),
    cleaned.length
      ? `<div class="asset-link-list">${cleaned.map((link) => {
          const safe = escapeHtml(link);
          return `<a class="asset-link" href="${safe}" target="_blank" rel="noreferrer noopener">${safe}</a>`;
        }).join("")}</div>`
      : `<div class="detail-value">Not saved</div>`,
  );
}

function makeHtmlFileSection(label, file, fallbackHtml) {
  const root = file && typeof file === "object" ? file : null;
  const html = root && typeof root.html === "string" && root.html.trim() ? root.html : fallbackHtml;
  const meta = root ? compactMeta([root.fileName || null, root.mimeType || "text/html"]) : null;
  const text = html ? `${meta ? `${meta}\n\n` : ""}${html}` : "";
  return makeTextSection(label, text);
}

function renderHtmlFileField(label, file, fallbackHtml) {
  const root = file && typeof file === "object" ? file : null;
  const html = root && typeof root.html === "string" && root.html.trim() ? root.html : fallbackHtml;
  const meta = root
    ? compactMeta([root.fileName || null, root.mimeType || "text/html"])
    : null;
  const text = html ? `${meta ? `${meta}\n\n` : ""}${html}` : null;
  return renderField(label, text);
}

function renderDetailSection(title, fields) {
  const body = fields.filter(Boolean).join("");
  if (!body) return "";
  return `
    <div class="detail-section">
      <div class="detail-section-title">${escapeHtml(title)}</div>
      ${body}
    </div>
  `;
}

function renderDetailSectionDropdown(title, items, groupId) {
  const safeGroupId = String(groupId || title || "detail-sections").replace(/[^A-Za-z0-9_-]/g, "-");
  const normalized = (Array.isArray(items) ? items : []).map((item, index) => {
    const label = item && item.label ? String(item.label) : `Section ${index + 1}`;
    const text = item && typeof item.text === "string" ? item.text : normalizeSectionText(item && item.value);
    const length = Number.isFinite(Number(item && item.length)) ? Number(item.length) : text.length;
    return {
      key: `${safeGroupId}-${index}`,
      label,
      length,
      html: item && item.html ? item.html : `<div class="detail-value">${escapeHtml(text || "Not saved")}</div>`,
    };
  });
  if (!normalized.length) return "";
  return `
    <div class="detail-section detail-section-picker" data-section-group="${escapeHtml(safeGroupId)}">
      <div class="detail-section-title">${escapeHtml(title)}</div>
      <select class="detail-section-select" data-action="detail-section-select" aria-label="${escapeHtml(title)}">
        ${normalized
          .map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(`${item.label} (${formatCharCount(item.length)})`)}</option>`)
          .join("")}
      </select>
      <div class="detail-section-selected">
        ${normalized
          .map((item, index) => `
            <div class="detail-section-panel" data-section-panel="${escapeHtml(item.key)}"${index === 0 ? "" : " hidden"}>
              <div class="detail-section-panel-meta">${escapeHtml(`${item.label} · ${formatCharCount(item.length)}`)}</div>
              ${item.html}
            </div>
          `)
          .join("")}
      </div>
    </div>
  `;
}

function getDetailTabsForSource(sourceKind) {
  return sourceKind === "saucepan"
    ? [
        ["saucepan", "Character"],
        ["saucepanCreator", "Creator"],
      ]
    : [
        ["core", "Character"],
        ["janny", "Additional"],
        ["lorebooks", "Lorebooks"],
        ["creator", "Creator"],
      ];
}

function isDetailTabAllowed(tab, sourceKind) {
  return getDetailTabsForSource(sourceKind).some(([id]) => id === tab);
}

function renderDetailTabs(activeTab, sourceKind) {
  const tabs = getDetailTabsForSource(sourceKind);
  return `
    <div class="detail-tabs" role="tablist" style="--detail-tab-count: ${tabs.length}">
      ${tabs
        .map(([id, label]) => {
          const active = activeTab === id;
          return `<button class="detail-tab${active ? " is-active" : ""}" data-action="detail-tab" data-tab="${id}" role="tab" aria-selected="${active ? "true" : "false"}">${escapeHtml(label)}</button>`;
        })
        .join("")}
    </div>
  `;
}

function renderTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return "";
  return `
    <div class="pill-row">
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
    </div>
  `;
}

function renderSaucepanPortraitList(portraits) {
  if (!Array.isArray(portraits) || !portraits.length) return renderField("Portraits", "No portraits saved.");
  return `
    <div class="detail-field">
      <div class="detail-label">Portraits</div>
      <div class="creator-character-list">
        ${portraits
          .slice(0, 40)
          .map((portrait, index) => {
            const title = portrait && portrait.name ? portrait.name : `Portrait ${index + 1}`;
            const description = portrait && portrait.description ? portrait.description : "";
            const imageUrl = getImageRefUrl(portrait && portrait.image);
            return `
              <article class="creator-character-item">
                <div class="creator-character-title">${escapeHtml(title)}</div>
                ${description ? `<div class="creator-character-meta">${escapeHtml(description)}</div>` : ""}
                ${
                  imageUrl
                    ? `<a class="asset-link creator-character-image-link" href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(imageUrl)}</a>`
                    : `<div class="creator-character-meta">Image asset not saved.</div>`
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderSaucepanLorebooks(lorebooks) {
  const root = lorebooks && typeof lorebooks === "object" ? lorebooks : {};
  const items = Array.isArray(root.items) ? root.items : [];
  const counts = compactMeta([
    root.count != null ? `Lorebooks: ${formatNumber(root.count)}` : null,
    root.chapterCount != null ? `Chapters: ${formatNumber(root.chapterCount)}` : null,
    root.totalWordCount != null ? `Words: ${formatNumber(root.totalWordCount)}` : null,
  ]);
  const fields = [
    renderField("Lorebook counts", counts || "No lorebook counts saved."),
  ];
  if (!items.length) {
    fields.push(renderField("Lorebook list", "No lorebooks saved."));
    return renderDetailSection("Saucepan lorebooks", fields);
  }
  fields.push(`
    <div class="detail-field">
      <div class="detail-label">Lorebook list</div>
      <div class="creator-character-list">
        ${items
          .map((item) => {
            const imageUrl = getImageRefUrl(item && item.image) || (item && item.profileImageAssetUrl);
            const meta = compactMeta([
              item && item.id,
              item && item.ownerHandle ? `@${item.ownerHandle}` : null,
              item && item.accessLevel,
              item && item.chapterCount != null ? `Chapters: ${formatNumber(item.chapterCount)}` : null,
              item && item.totalWordCount != null ? `Words: ${formatNumber(item.totalWordCount)}` : null,
              item && item.favoriteCount != null ? `Favorites: ${formatNumber(item.favoriteCount)}` : null,
            ]);
            return `
              <article class="creator-character-item">
                <div class="creator-character-title">${escapeHtml((item && item.title) || "Untitled lorebook")}</div>
                ${meta ? `<div class="creator-character-meta">${escapeHtml(meta)}</div>` : ""}
                ${item && item.description ? `<div class="creator-character-meta">${escapeHtml(item.description)}</div>` : ""}
                ${item && item.url ? `<a class="asset-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(item.url)}</a>` : ""}
                ${
                  imageUrl
                    ? `<a class="asset-link creator-character-image-link" href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(imageUrl)}</a>`
                    : `<div class="creator-character-meta">Image asset not saved.</div>`
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </div>
  `);
  return renderDetailSection("Saucepan lorebooks", fields);
}

function renderCreatorCharacterList(characters) {
  if (!Array.isArray(characters) || !characters.length) return renderField("Listed characters", "No character list saved.");
  return `
    <div class="detail-field">
      <div class="detail-label">Listed characters</div>
      <div class="creator-character-list">
        ${characters
          .slice(0, 12)
          .map((character) => {
            const title = character && (character.name || character.title) ? (character.name || character.title) : "Unknown character";
            const imageUrl = getCharacterProfileImageAssetUrl(character);
            const meta = compactMeta([
              character && character.id ? character.id : null,
              character && character.stats && character.stats.chatCount != null
                ? `Chats: ${formatNumber(character.stats.chatCount)}`
                : null,
              character && character.stats && character.stats.messageCount != null
                ? `Messages: ${formatNumber(character.stats.messageCount)}`
                : null,
            ]);
            return `
              <article class="creator-character-item">
                <div class="creator-character-title">${escapeHtml(title)}</div>
                ${meta ? `<div class="creator-character-meta">${escapeHtml(meta)}</div>` : ""}
                ${
                  imageUrl
                    ? `<a class="asset-link creator-character-image-link" href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(imageUrl)}</a>`
                    : `<div class="creator-character-meta">Profile image asset not saved.</div>`
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderCreatorBotRows(record) {
  const sourceKind = record && record.sourceKind === "saucepan" ? "saucepan" : "janitor";
  const characters = getCreatorRecordCharacters(record);
  if (!characters.length) {
    return `<div class="retrieved-summary creator-empty">No creator characters found.</div>`;
  }
  return `
    <div class="creator-bot-list">
      ${characters
        .slice(0, 120)
        .map((character) => {
          const title = character && (character.name || character.title) ? (character.name || character.title) : "Unknown character";
          const id = character && (character.id || character.characterId || character.companionId || character.sourceId) || "";
          const url = buildCreatorCharacterSourceUrl(sourceKind, character);
          const excerpt = getCreatorCharacterExcerpt(character);
          const localItem = getLocallySavedCreatorCharacter(sourceKind, character);
          const pinned = !!localItem;
          const queueStatus = pinned ? null : getCreatorCharacterQueueState(sourceKind, character);
          const sourceQuality = getCreatorCharacterSourceQuality(sourceKind, character);
          const stats = character && character.stats && typeof character.stats === "object" ? character.stats : {};
          const imageUrl = getCharacterProfileThumbnailUrl(sourceKind, character);
          const meta = compactMeta([
            id,
            stats.chatCount != null ? `Chats ${formatNumber(stats.chatCount)}` : null,
            stats.messageCount != null ? `Msgs ${formatNumber(stats.messageCount)}` : null,
            stats.interactionCount != null ? `Int ${formatNumber(stats.interactionCount)}` : null,
            stats.favoriteCount != null ? `Fav ${formatNumber(stats.favoriteCount)}` : null,
          ]);
          return `
            <article class="creator-bot-row${pinned ? " is-pinned" : ""}${queueStatus ? ` is-${escapeHtml(queueStatus.state)}` : ""}">
              <button
                class="creator-bot-open"
                data-action="open-creator-character"
                data-source-kind="${escapeHtml(sourceKind)}"
                data-character-id="${escapeHtml(id)}"
                data-url="${escapeHtml(url || "")}"
                data-title="${escapeHtml(title)}"
                title="Open ${escapeHtml(title)} on the source site"
                ${url ? "" : "disabled"}
              >
                ${
                  imageUrl
                    ? `<img class="creator-bot-thumb" src="${escapeHtml(imageUrl)}" alt="">`
                    : `<span class="creator-bot-thumb creator-bot-thumb-placeholder">${escapeHtml(sourceKind === "saucepan" ? "P" : "J")}</span>`
                }
                <span class="creator-bot-main">
                  <span class="creator-bot-title-row">
                    <span class="creator-bot-title">${escapeHtml(title)}</span>
                    ${renderSourceQualityBadge(sourceQuality)}
                  </span>
                  ${meta ? `<span class="creator-bot-meta">${escapeHtml(meta)}</span>` : ""}
                  ${excerpt ? `<span class="creator-bot-desc">${escapeHtml(excerpt)}</span>` : ""}
                </span>
              </button>
              ${
                pinned
                  ? `<span class="creator-bot-pinned-actions">
                      <span class="creator-bot-pinned-status compact-icon-button" role="img" aria-label="Pinned" title="Pinned">${renderUiIcon("pin-check")}</span>
                      ${renderDownloadMenuHtml(localItem, { sourceKind, label: "Download", className: "creator-bot-download", iconOnly: true })}
                    </span>`
                  : queueStatus && queueStatus.state !== "failed"
                    ? `<span class="creator-bot-queue-status is-${escapeHtml(queueStatus.state)}">${escapeHtml(queueStatus.label)}</span>`
                  : queueStatus && queueStatus.state === "failed"
                    ? `<span class="creator-bot-failed-control">
                        <span class="creator-bot-queue-status is-failed">Failed</span>
                        <button
                          class="mini-button creator-bot-retrieve creator-bot-queue-button compact-icon-button"
                          data-action="queue-creator-character"
                          data-source-kind="${escapeHtml(sourceKind)}"
                          data-character-id="${escapeHtml(id)}"
                          data-url="${escapeHtml(url || "")}"
                          data-title="${escapeHtml(title)}"
                          data-author="${escapeHtml(record && record.summary && record.summary.name || "")}"
                          title="Retry retrieval"
                          aria-label="Retry ${escapeHtml(title)} retrieval"
                        >${renderUiIcon("pin-plus")}</button>
                      </span>`
                  : `<button
                      class="mini-button creator-bot-retrieve creator-bot-queue-button compact-icon-button"
                      data-action="queue-creator-character"
                      data-source-kind="${escapeHtml(sourceKind)}"
                      data-character-id="${escapeHtml(id)}"
                      data-url="${escapeHtml(url || "")}"
                      data-title="${escapeHtml(title)}"
                      data-author="${escapeHtml(record && record.summary && record.summary.name || "")}"
                      title="Add to retrieval queue"
                      aria-label="Add ${escapeHtml(title)} to retrieval queue"
                      ${id || url ? "" : "disabled"}
                    >${renderUiIcon("pin-plus")}</button>`
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCreatorDetailPanel(target = currentDetailsPanel) {
  const panel = target || currentDetailsPanel || retrievedPanel;
  if (!panel) return;
  panel.hidden = false;
  const state = creatorDetailState || {};
  const currentCreatorPage = isCurrentCreatorPage();
  const sectionKicker = currentCreatorPage ? "Creator" : "Details";
  const record = state.record || null;
  const summary = record && record.summary && typeof record.summary === "object" ? record.summary : {};
  const freshness = state.freshness || {};
  const sourceKind = normalizeSourceKind(record && record.sourceKind)
    || normalizeSourceKind(state.request && state.request.sourceKind)
    || "unknown";
  const sourceLabel = getSourceLabel(sourceKind);
  const title = summary.name || (state.request && (state.request.creatorName || state.request.creatorHandle || state.request.creatorId)) || "Creator";
  const subtitle = compactMeta([
    sourceLabel,
    summary.creatorHandle ? `@${summary.creatorHandle}` : null,
    summary.creatorId,
    summary.characterTotal != null ? `${formatNumber(summary.characterTotal)} listed` : null,
    freshness.ageLabel ? `${freshness.fresh ? "fresh" : "stale"} ${freshness.ageLabel}` : null,
  ]);
  const queueableCharacterCount = getQueueableCreatorRecordCharacters(record).length;
  const degradedCharacterCount = getCreatorRecordCharacters(record)
    .filter((character) => getCharacterSourceQuality(character, sourceKind).degraded === true)
    .length;
  const maxOutstanding = Number(SourceVaultQueue.MAX_OUTSTANDING_ITEMS || 100);
  const queueCapacity = Math.max(0, maxOutstanding - getQueueOutstandingCount());
  const queueAddCount = Math.min(queueableCharacterCount, queueCapacity);
  const localDownloadCount = record ? getCreatorLocalDownloadItems(record).length : 0;
  if (state.loading) {
    renderDetailsLoadingPanel(panel, {
      kicker: sectionKicker,
      title: "Loading page...",
      message: getCreatorLoadingMessage(),
    });
    return;
  }
  panel.dataset.detailsLoadingRenderKey = "";
  if (state.error) {
    replaceDownloadMenuAwareHtml(panel, `
      <div class="panel-header">
        <div>
          <div class="kicker">${escapeHtml(sectionKicker)}</div>
          <div class="panel-title">Creator unavailable</div>
        </div>
        <div class="detail-header-actions">
          <button class="mini-button" data-action="refresh-creator-view">Retry</button>
          ${currentCreatorPage ? "" : `<button class="mini-button" data-action="back-to-retrieved">Close</button>`}
        </div>
      </div>
      <div class="alert danger">${escapeHtml(state.error)}</div>
    `);
    return;
  }
  if (!record) {
    replaceDownloadMenuAwareHtml(panel, `
      <div class="panel-header">
        <div>
          <div class="kicker">${escapeHtml(sectionKicker)}</div>
          <div class="panel-title">No creator loaded</div>
        </div>
        ${currentCreatorPage ? "" : `<button class="mini-button" data-action="back-to-retrieved">Close</button>`}
      </div>
      <div class="retrieved-summary">Open a creator from a page or character detail.</div>
    `);
    return;
  }
  replaceDownloadMenuAwareHtml(panel, `
    <div class="panel-header">
      <div>
        <div class="kicker">${escapeHtml(sectionKicker)}</div>
        <div class="panel-title">${escapeHtml(sourceLabel)} creator</div>
      </div>
      ${currentCreatorPage ? "" : `<div class="creator-header-controls"><button class="mini-button" data-action="back-to-retrieved">Close</button></div>`}
    </div>
    <div class="creator-profile-card">
      ${
        getCreatorProfileThumbnailUrl(sourceKind, summary)
          ? `<img class="current-avatar" src="${escapeHtml(getCreatorProfileThumbnailUrl(sourceKind, summary))}" alt="">`
          : `<div class="current-avatar current-avatar-placeholder">${escapeHtml(sourceKind === "saucepan" ? "P" : "J")}</div>`
      }
      <div>
        <div class="detail-title">${escapeHtml(title)}</div>
        <div class="detail-subtitle">${escapeHtml(subtitle)}</div>
        ${summary.description ? `<div class="creator-view-description">${escapeHtml(compactText(summary.description, 260))}</div>` : ""}
      </div>
    </div>
    <div class="creator-list-utility-row">
      <div class="creator-freshness-row" title="${escapeHtml(`${freshness.fresh ? "Using local fresh creator cache" : "Creator cache refreshed or stale"} · ${freshness.ageLabel ? `age ${freshness.ageLabel}` : "age unknown"}`)}">
        <span>${escapeHtml(freshness.fresh ? "Using local fresh creator cache" : "Creator cache refreshed or stale")} · ${escapeHtml(freshness.ageLabel ? `age ${freshness.ageLabel}` : "age unknown")}${degradedCharacterCount ? ` · <strong class="creator-degraded-count">${escapeHtml(`${formatNumber(degradedCharacterCount)} degraded`)}</strong>` : ""}</span>
      </div>
      <div class="creator-list-toolbar" role="toolbar" aria-label="Creator character actions">
        <button
          class="mini-button compact-icon-button"
          data-action="queue-creator-all"
          title="${escapeHtml(queueCapacity ? "Queue unpinned characters" : `Queue full (${maxOutstanding} maximum)`)}"
          aria-label="${escapeHtml(queueCapacity ? "Queue unpinned characters" : `Queue full (${maxOutstanding} maximum)`)}"
          ${queueAddCount ? "" : "disabled"}
        >${renderUiIcon("pin-plus")}</button>
        ${renderBulkDownloadMenuHtml({ scope: "creator", count: localDownloadCount, label: "Download saved", iconOnly: true })}
        <button class="mini-button compact-icon-button" data-action="refresh-creator-view" title="Refresh creator" aria-label="Refresh creator">${renderUiIcon("refresh")}</button>
      </div>
    </div>
    ${renderCreatorBotRows(record)}
  `);
  requestVisibleThumbnailsSoon();
}

function renderSaucepanSourceMaterialList(materials) {
  if (!Array.isArray(materials) || !materials.length) return renderField("Source materials", "No source material list saved.");
  return `
    <div class="detail-field">
      <div class="detail-label">Source materials</div>
      <div class="creator-character-list">
        ${materials
          .slice(0, 24)
          .map((material) => {
            const title = material && (material.title || material.name) ? (material.title || material.name) : "Untitled material";
            const type = material && (material.sourceType || material.source_type) ? (material.sourceType || material.source_type) : "material";
            const imageUrl = getCharacterProfileImageAssetUrl(material);
            const meta = compactMeta([
              type,
              material && (material.sourceId || material.id) ? (material.sourceId || material.id) : null,
              material && material.url ? material.url : null,
              material && material.stats && material.stats.chatCount != null ? `Chats: ${formatNumber(material.stats.chatCount)}` : null,
              material && material.stats && material.stats.interactionCount != null ? `Interactions: ${formatNumber(material.stats.interactionCount)}` : null,
              material && material.stats && material.stats.favoriteCount != null ? `Favorites: ${formatNumber(material.stats.favoriteCount)}` : null,
              material && material.stats && material.stats.fileCount != null ? `Files: ${formatNumber(material.stats.fileCount)}` : null,
            ]);
            return `
              <article class="creator-character-item">
                <div class="creator-character-title">${escapeHtml(title)}</div>
                ${meta ? `<div class="creator-character-meta">${escapeHtml(meta)}</div>` : ""}
                ${material && material.description ? `<div class="creator-character-meta">${escapeHtml(material.description)}</div>` : ""}
                ${
                  imageUrl
                    ? `<a class="asset-link creator-character-image-link" href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(imageUrl)}</a>`
                    : `<div class="creator-character-meta">Image asset not saved.</div>`
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderFirstMessagesValue(firstMessages) {
  if (!Array.isArray(firstMessages) || !firstMessages.length) return null;
  return firstMessages
    .map((item, index) => {
      const root = item && typeof item === "object" ? item : { message: item };
      const label = root.name || root.title || root.id || `Message ${index + 1}`;
      return `${label}\n${root.message || ""}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

function renderSaucepanDefinitionSections(definition) {
  return renderField("Definition sections", getSaucepanDefinitionSectionsText(definition) || "No definition sections saved.");
}

function renderLorebookEntriesBlock(lorebookEntries) {
  const root = lorebookEntries && typeof lorebookEntries === "object" ? lorebookEntries : null;
  if (!root) return "";
  if (!root.parsed) {
    return renderField("Lorebook entries", root.error ? `Not parsed: ${root.error}` : "Not parsed");
  }
  const entries = Array.isArray(root.items) ? root.items : [];
  const count = formatNumber(root.entryCount != null ? root.entryCount : entries.length) || "0";
  const header = compactMeta([
    `${count} entr${String(count) === "1" ? "y" : "ies"}`,
    root.truncated ? "list truncated" : null,
  ]);
  const rows = entries
    .map((entry, index) => {
      const keys = Array.isArray(entry.keys) ? entry.keys : [];
      const secondaryKeys = Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [];
      const title =
        entry.name ||
        entry.category ||
        entry.comment ||
        keys.find((key) => key && String(key).trim()) ||
        `Entry ${index + 1}`;
      const meta = compactMeta([
        keys.length ? `keys: ${keys.join(", ")}` : null,
        secondaryKeys.length ? `not with: ${secondaryKeys.join(", ")}` : null,
        entry.constant === true ? "constant" : entry.constant === false ? "selective" : null,
        entry.enabled === false || entry.disabled === true ? "disabled" : null,
        entry.probability != null ? `probability: ${entry.probability}` : null,
        entry.priority != null ? `priority: ${entry.priority}` : null,
      ]);
      return `
        <article class="lore-entry-item">
          <div class="lore-entry-title">${escapeHtml(title)}</div>
          ${meta ? `<div class="lore-entry-meta">${escapeHtml(meta)}</div>` : ""}
          ${entry.contentPreview ? `<div class="lore-entry-content">${escapeHtml(entry.contentPreview)}</div>` : ""}
        </article>
      `;
    })
    .join("");
  return `
    <div class="lore-entry-block">
      <div class="lore-entry-block-title">Lorebook entries: ${escapeHtml(header)}</div>
      ${rows ? `<div class="lore-entry-list">${rows}</div>` : "<div class=\"lore-entry-empty\">No entry previews saved.</div>"}
    </div>
  `;
}

function renderScriptItems(scripts, kind) {
  const filtered = (Array.isArray(scripts) ? scripts : []).filter((script) => {
    const type = getScriptType(script);
    return kind === "lorebook" ? type === "lorebook" : type !== "lorebook";
  });
  if (!filtered.length) return "";
  return `
    <div class="script-list">
      ${filtered
        .map((script, index) => {
          const sourceText =
            typeof script.scriptText === "string" && script.scriptText.trim()
              ? script.scriptText
              : typeof script.originalScriptText === "string" && script.originalScriptText.trim()
                ? script.originalScriptText
                : "";
          const meta = compactMeta([
            script.type || (kind === "lorebook" ? "lorebook" : "script"),
            script.isPublic === true ? "page public" : script.isPublic === false ? "page private" : null,
            script.isCodePublic === true ? "code public" : script.isCodePublic === false ? "code private" : null,
            sourceText ? `source ${formatNumber(sourceText.length)} chars` : "source unavailable",
          ]);
          return `
            <article class="script-item">
              <div class="script-title">${escapeHtml(script.title || `${kind === "lorebook" ? "Lorebook" : "Script"} ${index + 1}`)}</div>
              <div class="script-id">${escapeHtml(script.id || "unknown id")}</div>
              ${script.description ? `<div class="script-description">${escapeHtml(script.description)}</div>` : ""}
              <div class="script-meta">${escapeHtml(meta || "No metadata saved.")}</div>
              <div class="script-details">
                ${renderField("Detail available", formatBool(script.scriptDetailAvailable))}
                ${renderField("Comments allowed", formatBool(script.isCommentAllowed))}
                ${renderField("Locked", formatBool(script.isLocked))}
                ${renderField("Owner", compactMeta([script.userName, script.userId]))}
                ${renderField("Updated", script.updatedAt ? formatDate(script.updatedAt) : null)}
                ${renderField("Settings", script.settings ? JSON.stringify(script.settings, null, 2) : null)}
                ${renderLorebookEntriesBlock(script.lorebookEntries)}
                ${renderField("Source text", sourceText || "Not captured")}
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderScriptsDetail(scriptsCapture) {
  const capture = scriptsCapture && typeof scriptsCapture === "object" ? scriptsCapture : {};
  const scripts = Array.isArray(capture.items) ? capture.items : [];
  const lorebooks = scripts.filter((script) => getScriptType(script) === "lorebook");
  const otherScripts = scripts.filter((script) => getScriptType(script) !== "lorebook");
  return renderDetailSection("Lorebooks / scripts", [
    renderField("Status", capture.success ? "Captured" : "Not captured"),
    renderField("Counts", compactMeta([
      `Total: ${formatNumber(capture.scriptCount != null ? capture.scriptCount : scripts.length) || 0}`,
      `Lorebooks: ${formatNumber(capture.lorebookCount != null ? capture.lorebookCount : lorebooks.length) || 0}`,
      `Other scripts: ${formatNumber(capture.otherScriptCount != null ? capture.otherScriptCount : otherScripts.length) || 0}`,
    ])),
    capture.error ? renderField("Availability", "Some details are unavailable.") : "",
    lorebooks.length
      ? `<div class="detail-subsection-title">Lorebooks (${formatNumber(lorebooks.length)})</div>${renderScriptItems(scripts, "lorebook")}`
      : renderField("Lorebooks", "None saved."),
    otherScripts.length
      ? `<div class="detail-subsection-title">Other scripts (${formatNumber(otherScripts.length)})</div>${renderScriptItems(scripts, "script")}`
      : "",
  ]);
}
