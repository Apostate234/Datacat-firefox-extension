(function initSourceVaultSidebarDownloads(globalScope) {
  "use strict";

  let downloadBusy = false;
  let downloadStatusTimer = null;

  function escapeAttribute(value) {
    if (typeof globalScope.escapeHtml === "function") return globalScope.escapeHtml(value);
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function renderDownloadMenuHtml(item, options = {}) {
    const root = item && typeof item === "object" ? item : {};
    const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
    const id = root.id || summary.id || options.characterId || "";
    if (!id) return "";
    const sourceKind = options.sourceKind || summary.sourceKind || root.sourceKind || "";
    const label = options.label || "Download";
    const iconOnly = options.iconOnly === true;
    const menuKey = `character:${String(sourceKind).toLowerCase()}:${String(id).toLowerCase()}`;
    const className = options.className ? ` ${escapeAttribute(options.className)}` : "";
    const triggerContent = iconOnly && typeof globalScope.renderUiIcon === "function"
      ? globalScope.renderUiIcon("download")
      : escapeAttribute(label);
    return `
      <details class="download-menu${className}${iconOnly ? " is-icon-only" : ""}" data-download-menu-key="${escapeAttribute(menuKey)}">
        <summary class="mini-button download-menu-trigger${iconOnly ? " compact-icon-button" : ""}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">${triggerContent}</summary>
        <div class="download-menu-options" role="menu" aria-label="Download character">
          <button type="button" role="menuitem" data-download-action="character" data-download-format="png" data-character-id="${escapeAttribute(id)}" data-source-kind="${escapeAttribute(sourceKind)}">PNG</button>
          <button type="button" role="menuitem" data-download-action="character" data-download-format="json" data-character-id="${escapeAttribute(id)}" data-source-kind="${escapeAttribute(sourceKind)}">JSON</button>
        </div>
      </details>
    `;
  }

  function renderBulkDownloadMenuHtml({ scope, count, label = "Download all", iconOnly = false } = {}) {
    const safeScope = scope === "creator" ? "creator" : "activity";
    const total = Math.max(0, Number(count) || 0);
    const triggerContent = iconOnly && typeof globalScope.renderUiIcon === "function"
      ? globalScope.renderUiIcon("download")
      : escapeAttribute(label);
    return `
      <details class="download-menu bulk-download-menu${iconOnly ? " is-icon-only" : ""}${total ? "" : " is-disabled"}" data-download-menu-key="bulk:${escapeAttribute(safeScope)}">
        <summary class="mini-button download-menu-trigger${iconOnly ? " compact-icon-button" : ""}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}" ${total ? "" : "aria-disabled=\"true\""}>${triggerContent}</summary>
        ${total ? `
          <div class="download-menu-options" role="menu" aria-label="Download saved characters">
            <button type="button" role="menuitem" data-download-action="bulk" data-download-scope="${safeScope}" data-download-format="both">PNG + JSON <span>${total}</span></button>
            <button type="button" role="menuitem" data-download-action="bulk" data-download-scope="${safeScope}" data-download-format="png">PNG cards <span>${total}</span></button>
            <button type="button" role="menuitem" data-download-action="bulk" data-download-scope="${safeScope}" data-download-format="json">JSON cards <span>${total}</span></button>
          </div>
        ` : ""}
      </details>
    `;
  }

  function setDownloadStatus(message, tone = "working", timeoutMs = 0) {
    const panel = globalScope.document && globalScope.document.getElementById("downloadStatusBanner");
    if (!panel) return;
    if (downloadStatusTimer) {
      clearTimeout(downloadStatusTimer);
      downloadStatusTimer = null;
    }
    if (!message) {
      panel.hidden = true;
      panel.textContent = "";
      panel.className = "download-status-banner";
      return;
    }
    panel.hidden = false;
    panel.className = `download-status-banner is-${tone}`;
    panel.textContent = message;
    if (timeoutMs > 0) {
      downloadStatusTimer = setTimeout(() => setDownloadStatus(""), timeoutMs);
    }
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      globalScope.chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = globalScope.chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || "extension_message_failed"));
          return;
        }
        if (!response || response.ok === false) {
          reject(new Error(response && response.error || "local_character_not_found"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function getFullLocalRecord(item) {
    const root = item && typeof item === "object" ? item : {};
    const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
    const characterId = root.id || summary.id || root.characterId;
    const sourceKind = root.sourceKind || summary.sourceKind || null;
    if (!characterId) throw new Error("local_character_id_missing");
    const response = await sendMessage({
      type: globalScope.SourceVaultMessages.MessageTypes.SV_GET_RETRIEVED_CHARACTER,
      characterId,
      sourceKind,
    });
    if (!response.item || !response.item.capture) throw new Error("local_character_capture_missing");
    return response.item;
  }

  function getCachedCharacterImage(record) {
    const exportsApi = globalScope.SourceVaultExports;
    const imageUrl = exportsApi.getCharacterImageUrl(record);
    const sourceKind = exportsApi.getRecordSourceKind(record);
    const summary = record && record.summary && typeof record.summary === "object" ? record.summary : {};
    if (!imageUrl || typeof globalScope.getThumbnailDataUrlForImage !== "function") return null;
    return globalScope.getThumbnailDataUrlForImage(sourceKind, "character_profile", record.id || summary.id, imageUrl);
  }

  function buildRecordBaseName(record) {
    const exportsApi = globalScope.SourceVaultExports;
    const summary = record && record.summary && typeof record.summary === "object" ? record.summary : {};
    const title = exportsApi.sanitizeFileName(summary.title || "character");
    const suffix = String(record && record.id || "").slice(0, 8);
    return suffix ? `${title} - ${suffix}` : title;
  }

  async function buildRecordFiles(record, format) {
    const exportsApi = globalScope.SourceVaultExports;
    const card = exportsApi.buildCharacterCard(record);
    const baseName = buildRecordBaseName(record);
    const files = [];
    if (format === "json" || format === "both") {
      files.push({
        name: `${baseName}.json`,
        data: exportsApi.utf8Bytes(`${JSON.stringify(card, null, 2)}\n`),
        mimeType: "application/json",
      });
    }
    if (format === "png" || format === "both") {
      const imageUrl = exportsApi.getCharacterImageUrl(record);
      const pngBytes = await exportsApi.fetchImageAsPngBytes(imageUrl, getCachedCharacterImage(record));
      files.push({
        name: `${baseName}.png`,
        data: exportsApi.embedCharacterCardInPng(pngBytes, card),
        mimeType: "image/png",
      });
    }
    return files;
  }

  function triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = globalScope.document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    globalScope.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function closeDownloadMenu(target) {
    const menu = target && typeof target.closest === "function" ? target.closest("details.download-menu") : null;
    if (menu) menu.open = false;
  }

  async function downloadSingle(target) {
    const characterId = target.getAttribute("data-character-id");
    const sourceKind = target.getAttribute("data-source-kind") || null;
    const format = target.getAttribute("data-download-format") === "json" ? "json" : "png";
    setDownloadStatus(`Preparing ${format.toUpperCase()} card...`, "working");
    const record = await getFullLocalRecord({ id: characterId, sourceKind });
    const [file] = await buildRecordFiles(record, format);
    triggerBlobDownload(new Blob([file.data], { type: file.mimeType }), file.name);
    setDownloadStatus(`${format.toUpperCase()} card downloaded.`, "success", 3500);
  }

  function dedupeLocalItems(items) {
    const byKey = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const root = item && typeof item === "object" ? item : {};
      const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
      const id = root.id || summary.id;
      if (!id) continue;
      const sourceKind = String(root.sourceKind || summary.sourceKind || "").toLowerCase();
      byKey.set(`${sourceKind}:${String(id).toLowerCase()}`, { id, sourceKind, summary });
    }
    return Array.from(byKey.values());
  }

  function getCreatorLocalDownloadItems(recordOverride = null) {
    const state = typeof creatorDetailState !== "undefined" && creatorDetailState && typeof creatorDetailState === "object"
      ? creatorDetailState
      : null;
    const record = recordOverride || state && state.record;
    if (!record || typeof getCreatorRecordCharacters !== "function") return [];
    const sourceKind = record.sourceKind === "saucepan" ? "saucepan" : "janitor";
    return dedupeLocalItems(getCreatorRecordCharacters(record).map((character) => {
      return typeof getLocallySavedCreatorCharacter === "function"
        ? getLocallySavedCreatorCharacter(sourceKind, character)
        : null;
    }).filter(Boolean));
  }

  function getActivityLocalDownloadItems(itemsOverride = null) {
    const list = Array.isArray(itemsOverride)
      ? itemsOverride
      : typeof retrievedList !== "undefined" && Array.isArray(retrievedList) ? retrievedList : [];
    const latest = !itemsOverride && typeof latestSavedCharacter !== "undefined" && latestSavedCharacter
      ? [latestSavedCharacter]
      : [];
    return dedupeLocalItems([...latest, ...list].filter((item) => item && item.isQueueHistory !== true));
  }

  function getBulkItems(scope) {
    return scope === "creator" ? getCreatorLocalDownloadItems() : getActivityLocalDownloadItems();
  }

  function getBulkArchiveName(scope, format) {
    const exportsApi = globalScope.SourceVaultExports;
    const date = new Date().toISOString().slice(0, 10);
    if (scope === "creator") {
      const record = typeof creatorDetailState !== "undefined" && creatorDetailState
        ? creatorDetailState.record
        : null;
      const summary = record && record.summary && typeof record.summary === "object" ? record.summary : {};
      return `pincat-${exportsApi.sanitizeFileName(summary.name || summary.creatorHandle || "creator")}-${format}-${date}.zip`;
    }
    return `pincat-local-pins-${format}-${date}.zip`;
  }

  async function downloadBulk(target) {
    const scope = target.getAttribute("data-download-scope") === "creator" ? "creator" : "activity";
    const requestedFormat = target.getAttribute("data-download-format");
    const format = requestedFormat === "json" || requestedFormat === "png" ? requestedFormat : "both";
    const items = getBulkItems(scope);
    if (!items.length) throw new Error("no_local_characters_to_download");
    const files = [];
    const errors = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      setDownloadStatus(`Preparing ${index + 1} of ${items.length}...`, "working");
      try {
        const record = await getFullLocalRecord(item);
        files.push(...await buildRecordFiles(record, format));
      } catch (error) {
        errors.push(`${item.summary && item.summary.title || item.id}: ${error && error.message || String(error)}`);
      }
    }
    if (errors.length) {
      files.push({
        name: "_errors.txt",
        data: globalScope.SourceVaultExports.utf8Bytes(`${errors.join("\n")}\n`),
        mimeType: "text/plain",
      });
    }
    if (!files.length || (files.length === 1 && files[0].name === "_errors.txt")) {
      throw new Error(errors[0] || "download_export_failed");
    }
    setDownloadStatus("Building ZIP archive...", "working");
    const zip = globalScope.SourceVaultExports.buildStoredZip(files);
    triggerBlobDownload(new Blob([zip], { type: "application/zip" }), getBulkArchiveName(scope, format));
    const result = errors.length
      ? `Downloaded with ${errors.length} skipped item${errors.length === 1 ? "" : "s"}.`
      : `Downloaded ${items.length} character${items.length === 1 ? "" : "s"}.`;
    setDownloadStatus(result, errors.length ? "warning" : "success", 5000);
  }

  async function handleDownloadAction(target) {
    if (downloadBusy) {
      setDownloadStatus("Another download is already being prepared.", "warning", 3500);
      return;
    }
    downloadBusy = true;
    try {
      if (target.getAttribute("data-download-action") === "bulk") await downloadBulk(target);
      else await downloadSingle(target);
    } catch (error) {
      const code = String(error && error.message || error || "download_failed");
      const httpMatch = code.match(/^character_image_http_(.+)$/);
      const message = httpMatch
        ? `Character image could not be downloaded (HTTP ${httpMatch[1]})`
        : code
          .replace(/^character_image_unavailable$/, "Character image is unavailable")
          .replace(/^character_image_fetch_unavailable$/, "Character image download is unavailable")
          .replace(/^local_character_capture_missing$/, "The local capture is unavailable")
          .replace(/^no_local_characters_to_download$/, "No locally saved characters are available");
      setDownloadStatus(`${message}.`, "error", 7000);
    } finally {
      downloadBusy = false;
    }
  }

  function captureDownloadMenuUiState(root) {
    if (!root || typeof root.querySelectorAll !== "function") return null;
    const openKeys = Array.from(root.querySelectorAll("details.download-menu[open][data-download-menu-key]"))
      .map((menu) => menu.getAttribute("data-download-menu-key"))
      .filter(Boolean);
    const activeElement = globalScope.document && globalScope.document.activeElement;
    const focusedMenu = activeElement && typeof activeElement.closest === "function"
      ? activeElement.closest("details.download-menu[data-download-menu-key]")
      : null;
    return {
      openKeys,
      focusedKey: focusedMenu && root.contains(focusedMenu)
        ? focusedMenu.getAttribute("data-download-menu-key")
        : null,
    };
  }

  function restoreDownloadMenuUiState(root, state) {
    if (!root || !state || typeof root.querySelectorAll !== "function") return;
    const openKeys = new Set(Array.isArray(state.openKeys) ? state.openKeys : []);
    let focusedMenu = null;
    for (const menu of root.querySelectorAll("details.download-menu[data-download-menu-key]")) {
      const key = menu.getAttribute("data-download-menu-key");
      if (openKeys.has(key)) menu.open = true;
      if (state.focusedKey && key === state.focusedKey) focusedMenu = menu;
    }
    const trigger = focusedMenu && focusedMenu.querySelector("summary");
    if (trigger && typeof trigger.focus === "function") trigger.focus({ preventScroll: true });
  }

  function replaceDownloadMenuAwareHtml(root, html) {
    if (!root) return;
    const state = captureDownloadMenuUiState(root);
    root.innerHTML = html;
    restoreDownloadMenuUiState(root, state);
  }

  function renderActivityDownloadActions(items) {
    const panel = globalScope.document && globalScope.document.getElementById("activityDownloadActions");
    if (!panel) return;
    const count = dedupeLocalItems(items).length;
    const renderKey = `activity:${count}`;
    const currentMenu = panel.querySelector("details.bulk-download-menu");
    const wasOpen = currentMenu && currentMenu.open === true;
    if (currentMenu && panel.dataset.downloadRenderKey === renderKey) return;
    panel.innerHTML = renderBulkDownloadMenuHtml({ scope: "activity", count, label: "Download all", iconOnly: true });
    panel.dataset.downloadRenderKey = renderKey;
    const nextMenu = panel.querySelector("details.bulk-download-menu");
    if (wasOpen && nextMenu) nextMenu.open = true;
  }

  globalScope.document.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-download-action]");
    if (!target) {
      globalScope.document.querySelectorAll("details.download-menu[open]").forEach((menu) => {
        if (!menu.contains(event.target)) menu.open = false;
      });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    closeDownloadMenu(target);
    handleDownloadAction(target);
  }, true);

  globalScope.renderDownloadMenuHtml = renderDownloadMenuHtml;
  globalScope.renderBulkDownloadMenuHtml = renderBulkDownloadMenuHtml;
  globalScope.renderActivityDownloadActions = renderActivityDownloadActions;
  globalScope.getCreatorLocalDownloadItems = getCreatorLocalDownloadItems;
  globalScope.captureDownloadMenuUiState = captureDownloadMenuUiState;
  globalScope.restoreDownloadMenuUiState = restoreDownloadMenuUiState;
  globalScope.replaceDownloadMenuAwareHtml = replaceDownloadMenuAwareHtml;
})(typeof globalThis !== "undefined" ? globalThis : this);
