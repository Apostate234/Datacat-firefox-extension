"use strict";

// Pincat settings — entry: element refs, mutable state, chrome messaging
// intents, event wiring, and boot. DOM-render + formatting helpers live in
// ui/settings/render.js (loaded before this file); both share the global
// lexical scope across the ordered <script> tags.

const MessageTypes = (globalThis.SourceVaultMessages && SourceVaultMessages.MessageTypes) || {};
const SourceRegistry = globalThis.SourceVaultSourceRegistry || null;

const originInput = document.getElementById("datacatOriginInput");
const originDisplayRow = document.getElementById("datacatOriginDisplayRow");
const originEditor = document.getElementById("datacatOriginEditor");
const editOriginButton = document.getElementById("editOriginButton");
const cancelOriginEditButton = document.getElementById("cancelOriginEditButton");
const settingsStatus = document.getElementById("settingsStatus");
const datacatStatusText = document.getElementById("datacatStatusText");
const datacatConnectionBadge = document.getElementById("datacatConnectionBadge");
const datacatConnectionIdentity = document.getElementById("datacatConnectionIdentity");
const datacatConnectionOrigin = document.getElementById("datacatConnectionOrigin");
const saveOriginButton = document.getElementById("saveOriginButton");
const checkDatacatButton = document.getElementById("checkDatacatButton");
const loginDatacatButton = document.getElementById("loginDatacatButton");
const unlinkDatacatButton = document.getElementById("unlinkDatacatButton");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const sourceAccountList = document.getElementById("sourceAccountList");
const sourceAccountStatus = document.getElementById("sourceAccountStatus");
const sourceAccountConfirmModal = document.getElementById("sourceAccountConfirmModal");
const sourceAccountConfirmTitle = document.getElementById("sourceAccountConfirmTitle");
const sourceAccountConfirmText = document.getElementById("sourceAccountConfirmText");
const sourceAccountConfirmCancel = document.getElementById("sourceAccountConfirmCancel");
const sourceAccountConfirmReject = document.getElementById("sourceAccountConfirmReject");
const sourceAccountConfirmApply = document.getElementById("sourceAccountConfirmApply");
const latestExtensionDownloadLink = document.getElementById("latestExtensionDownloadLink");
const latestExtensionDownloadUrl = document.getElementById("latestExtensionDownloadUrl");
const storageStatusText = document.getElementById("storageStatusText");
const storageStatsGrid = document.getElementById("storageStatsGrid");
const refreshStorageStatsButton = document.getElementById("refreshStorageStatsButton");
const clearAllStorageButton = document.getElementById("clearAllStorageButton");
const visibilityButtons = Array.from(document.querySelectorAll("[data-visibility]"));
const jobTimeoutMinutesInput = document.getElementById("jobTimeoutMinutesInput");
const jobTimeoutStatus = document.getElementById("jobTimeoutStatus");
const skinButtons = Array.from(document.querySelectorAll("[data-skin]"));
const debugPanelToggle = document.getElementById("debugPanelToggle");
const settingsTabButtons = Array.from(document.querySelectorAll("[data-settings-tab]"));
const settingsPanels = Array.from(document.querySelectorAll("[data-settings-panel]"));

let datacatState = null;
let uploadVisibility = "public";
let jobTimeoutMinutes = 2;
let uiSkin = "bauhaus";
let debugPanelVisible = false;
let sourceAccountApprovals = {};
let sourceAccountSessions = {};
let pendingSourceAccountDecision = null;
let storageStats = null;
let activeSettingsTab = "connections";
let datacatOriginEditing = false;

function sendSettingsMessage(message, callback, options = {}) {
  if (globalThis.PincatRuntimeHealth && typeof globalThis.PincatRuntimeHealth.send === "function") {
    globalThis.PincatRuntimeHealth.send(message, (response, error) => {
      if (typeof callback === "function") callback(response, error);
      if (error) globalThis.PincatRuntimeHealth.ping({ force: true });
    }, {
      timeoutMs: options.timeoutMs || 15000,
      recover: false,
    });
    return;
  }
  chrome.runtime.sendMessage(message, callback);
}

function normalizeSettingsTab(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["connections", "preferences", "storage"].includes(normalized) ? normalized : "connections";
}

function setSettingsTab(value, options = {}) {
  activeSettingsTab = normalizeSettingsTab(value);
  settingsTabButtons.forEach((button) => {
    const active = button.getAttribute("data-settings-tab") === activeSettingsTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  settingsPanels.forEach((panel) => {
    panel.hidden = panel.getAttribute("data-settings-panel") !== activeSettingsTab;
  });
  if (options.updateHash !== false) {
    const nextHash = `#${activeSettingsTab}`;
    if (window.location.hash !== nextHash) history.replaceState(null, "", nextHash);
  }
}

function setUiSkin(value) {
  if (!window.PincatSkin) return;
  uiSkin = window.PincatSkin.normalizeSkin(value);
  renderAppearance();
  window.PincatSkin.setSkin(uiSkin);
}

function setDebugPanelVisible(value) {
  if (!window.PincatSkin) return;
  debugPanelVisible = value === true;
  renderAppearance();
  window.PincatSkin.setDebugPanelVisible(debugPanelVisible);
}

function requestAppearance() {
  if (!window.PincatSkin) return;
  window.PincatSkin.read((preferences) => {
    uiSkin = preferences.skin;
    debugPanelVisible = preferences.debugPanelVisible;
    renderAppearance();
  });
}

function requestSourceAccountApprovals() {
  if (sourceAccountStatus) sourceAccountStatus.textContent = "Checking source account decisions...";
  sendSettingsMessage({ type: MessageTypes.SV2_GET_SOURCE_ACCOUNT_APPROVALS }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      sourceAccountApprovals = {};
      if (sourceAccountStatus) {
        sourceAccountStatus.textContent =
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not read source account decisions.";
        sourceAccountStatus.classList.add("is-danger");
      }
      renderSourceAccountApprovals();
      return;
    }
    sourceAccountApprovals = response.approvals && typeof response.approvals === "object" ? response.approvals : {};
    if (sourceAccountStatus) sourceAccountStatus.classList.remove("is-danger");
    renderSourceAccountApprovals();
    requestSourceAccountSessionStatus();
  });
}

function requestSourceAccountSessionStatus() {
  sendSettingsMessage({ type: MessageTypes.SV2_GET_SOURCE_ACCOUNT_SESSION_STATUS }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      if (sourceAccountStatus) {
        sourceAccountStatus.textContent =
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not read current source sessions.";
        sourceAccountStatus.classList.add("is-danger");
      }
      renderSourceAccountApprovals();
      return;
    }
    sourceAccountSessions = response.sessions && typeof response.sessions === "object" ? response.sessions : {};
    sourceAccountApprovals = response.approvals && typeof response.approvals === "object" ? response.approvals : sourceAccountApprovals;
    if (sourceAccountStatus) sourceAccountStatus.classList.remove("is-danger");
    renderSourceAccountApprovals();
  });
}

function setSourceAccountApproval(accountKey, state) {
  const approval = getSourceAccountRecord(accountKey);
  if (!approval) return;
  if (sourceAccountStatus) sourceAccountStatus.textContent = "Saving source account decision...";
  sendSettingsMessage({
    type: MessageTypes.SV2_SET_SOURCE_ACCOUNT_APPROVAL,
    sourceKind: approval.sourceKind,
    account: {
      id: approval.id,
      label: approval.label,
    },
    state,
  }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      if (sourceAccountStatus) {
        sourceAccountStatus.textContent =
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not save source account decision.";
        sourceAccountStatus.classList.add("is-danger");
      }
      return;
    }
    if (response.approval && response.approval.key) {
      sourceAccountApprovals = {
        ...(sourceAccountApprovals || {}),
        [response.approval.key]: response.approval,
      };
    }
    if (sourceAccountStatus) sourceAccountStatus.classList.remove("is-danger");
    renderSourceAccountApprovals();
    requestSourceAccountSessionStatus();
  });
}

function requestDatacatState() {
  renderDatacatCheckingState();
  sendSettingsMessage({ type: MessageTypes.SV2_GET_DATACAT_STATE }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      const error = (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Could not check Datacat.";
      datacatState = {
        ...(datacatState || {}),
        ok: false,
        connected: false,
        authenticated: false,
        canUpload: false,
        error,
        message: "Could not check Datacat session.",
      };
      renderDatacatState();
      setStatus(error, "danger");
      return;
    }
    datacatState = response.state || datacatState;
    renderDatacatState();
  });
}

function requestUploadSettings() {
  sendSettingsMessage({ type: MessageTypes.SV2_GET_UPLOAD_SETTINGS }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok || !response.settings) {
      uploadVisibility = "public";
      jobTimeoutMinutes = 2;
      renderUploadVisibility();
      renderJobTimeout();
      return;
    }
    uploadVisibility = normalizeUploadVisibility(response.settings.visibility);
    jobTimeoutMinutes = normalizeJobTimeoutMinutes(response.settings.jobTimeoutMinutes);
    renderUploadVisibility();
    renderJobTimeout();
  });
}

function requestStorageStats() {
  if (storageStatusText) {
    storageStatusText.textContent = "Checking extension storage...";
    storageStatusText.classList.remove("is-danger", "is-ok");
  }
  if (refreshStorageStatsButton) refreshStorageStatsButton.disabled = true;
  sendSettingsMessage({ type: MessageTypes.SV2_GET_STORAGE_STATS }, (response) => {
    if (refreshStorageStatsButton) refreshStorageStatsButton.disabled = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      if (storageStatusText) {
        storageStatusText.textContent =
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not read extension storage.";
        storageStatusText.classList.add("is-danger");
      }
      return;
    }
    storageStats = response.stats || null;
    if (storageStatusText) {
      storageStatusText.textContent = storageStats && storageStats.checkedAt
        ? `Updated ${new Date(storageStats.checkedAt).toLocaleTimeString()}`
        : "Storage stats updated.";
      storageStatusText.classList.add("is-ok");
    }
    renderStorageStats();
  });
}

function clearAllExtensionStorage() {
  const confirmed = window.confirm(
    "Clear all Pincat by Cressida extension storage for this Chrome profile? This removes the retrieval queue, saved history, cached thumbnails, source account decisions, and Datacat connection state.",
  );
  if (!confirmed) return;
  if (clearAllStorageButton) clearAllStorageButton.disabled = true;
  if (storageStatusText) {
    storageStatusText.textContent = "Clearing extension storage...";
    storageStatusText.classList.remove("is-danger", "is-ok");
  }
  sendSettingsMessage({ type: MessageTypes.SV2_CLEAR_ALL_EXTENSION_STORAGE }, (response) => {
    if (clearAllStorageButton) clearAllStorageButton.disabled = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      if (storageStatusText) {
        storageStatusText.textContent =
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not clear extension storage.";
        storageStatusText.classList.add("is-danger");
      }
      return;
    }
    storageStats = response.stats || null;
    datacatState = null;
    uploadVisibility = "public";
    jobTimeoutMinutes = 2;
    sourceAccountApprovals = {};
    sourceAccountSessions = {};
    if (storageStatusText) {
      storageStatusText.textContent = "Extension storage cleared.";
      storageStatusText.classList.add("is-ok");
    }
    renderStorageStats();
    renderDatacatState();
    renderUploadVisibility();
    renderJobTimeout();
    renderSourceAccountApprovals();
    requestDatacatState();
    requestSourceAccountSessionStatus();
  });
}

function saveDatacatOrigin() {
  const origin = originInput ? originInput.value : "";
  const configuredOrigin = normalizeDatacatOriginValue(datacatState && datacatState.origin);
  const nextOrigin = parseDatacatOriginValue(origin);
  if (!nextOrigin) {
    setStatus("Enter a valid HTTP or HTTPS Datacat site.", "danger");
    renderDatacatOriginAction();
    return;
  }
  if (nextOrigin === configuredOrigin) {
    datacatOriginEditing = false;
    renderDatacatOriginAction();
    return;
  }
  const linkStatus = String(datacatState && datacatState.linkStatus || "unlinked");
  const hasLink = linkStatus !== "unlinked" || datacatState && datacatState.linked === true;
  if (hasLink && !window.confirm("Changing the Datacat site will unlink the current Datacat account. Continue?")) {
    return;
  }
  saveOriginButton.disabled = true;
  saveOriginButton.textContent = "Saving...";
  setStatus("Changing the Datacat site...", "");
  sendSettingsMessage({ type: MessageTypes.SV2_SET_DATACAT_ORIGIN, origin }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      setStatus(
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not save Datacat target.",
        "danger",
      );
      renderDatacatOriginAction();
      return;
    }
    datacatState = response.state || datacatState;
    datacatOriginEditing = false;
    renderDatacatState();
  });
}

function setDatacatOriginEditing(value) {
  datacatOriginEditing = value === true;
  if (!datacatOriginEditing && originInput) {
    originInput.value = normalizeDatacatOriginValue(datacatState && datacatState.origin);
  }
  renderDatacatOriginAction();
  if (datacatOriginEditing && originInput) {
    setTimeout(() => {
      originInput.focus();
      originInput.select();
    }, 0);
  }
}

function setUploadVisibility(visibility) {
  uploadVisibility = normalizeUploadVisibility(visibility);
  renderUploadVisibility();
  sendSettingsMessage({ type: MessageTypes.SV2_SET_UPLOAD_VISIBILITY, visibility: uploadVisibility }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok || !response.settings) return;
    uploadVisibility = normalizeUploadVisibility(response.settings.visibility);
    renderUploadVisibility();
  });
}

function setJobTimeoutMinutes(value) {
  jobTimeoutMinutes = normalizeJobTimeoutMinutes(value);
  renderJobTimeout();
  if (jobTimeoutStatus) jobTimeoutStatus.textContent = "Saving...";
  sendSettingsMessage({
    type: MessageTypes.SV2_SET_JOB_TIMEOUT,
    minutes: jobTimeoutMinutes,
  }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok || !response.settings) {
      if (jobTimeoutStatus) {
        jobTimeoutStatus.textContent =
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not save the job timeout.";
        jobTimeoutStatus.classList.add("is-danger");
      }
      return;
    }
    jobTimeoutMinutes = normalizeJobTimeoutMinutes(response.settings.jobTimeoutMinutes);
    renderJobTimeout();
    if (jobTimeoutStatus) {
      jobTimeoutStatus.textContent = "Saved.";
      jobTimeoutStatus.classList.remove("is-danger");
    }
  });
}

saveOriginButton.addEventListener("click", saveDatacatOrigin);
if (editOriginButton) editOriginButton.addEventListener("click", () => setDatacatOriginEditing(true));
if (cancelOriginEditButton) cancelOriginEditButton.addEventListener("click", () => setDatacatOriginEditing(false));
checkDatacatButton.addEventListener("click", requestDatacatState);
loginDatacatButton.addEventListener("click", () => {
  loginDatacatButton.disabled = true;
  sendSettingsMessage({ type: MessageTypes.SV2_OPEN_DATACAT_LOGIN }, (response) => {
    loginDatacatButton.disabled = false;
    if (chrome.runtime.lastError || !response || !response.ok) {
      setStatus(
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "Could not open the Datacat connection page.",
        "danger",
      );
      return;
    }
    setStatus("Datacat connection page opened. Complete the connection there; this page updates automatically.", "");
  });
});
if (unlinkDatacatButton) {
  unlinkDatacatButton.addEventListener("click", () => {
    if (!window.confirm("Unlink this Datacat account from Pincat on this Chrome profile?")) return;
    unlinkDatacatButton.disabled = true;
    setStatus("Unlinking Datacat...", "");
    sendSettingsMessage({ type: MessageTypes.SV2_UNLINK_DATACAT }, (response) => {
      unlinkDatacatButton.disabled = false;
      if (chrome.runtime.lastError || !response || !response.ok) {
        setStatus(
          (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
            (response && response.error) ||
            "Could not unlink Datacat.",
          "danger",
        );
        return;
      }
      datacatState = response.state || null;
      renderDatacatState();
    });
  });
}
closeSettingsButton.addEventListener("click", () => window.close());
originInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setDatacatOriginEditing(false);
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  saveDatacatOrigin();
});
originInput.addEventListener("input", () => {
  updateExtensionDownloadLink();
  renderDatacatOriginAction();
});
settingsTabButtons.forEach((button, index) => {
  button.addEventListener("click", () => setSettingsTab(button.getAttribute("data-settings-tab")));
  button.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + settingsTabButtons.length) % settingsTabButtons.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % settingsTabButtons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = settingsTabButtons.length - 1;
    const nextButton = settingsTabButtons[nextIndex];
    setSettingsTab(nextButton.getAttribute("data-settings-tab"));
    nextButton.focus();
  });
});
visibilityButtons.forEach((button) => {
  button.addEventListener("click", () => setUploadVisibility(button.getAttribute("data-visibility")));
});
if (jobTimeoutMinutesInput) {
  jobTimeoutMinutesInput.addEventListener("change", () => setJobTimeoutMinutes(jobTimeoutMinutesInput.value));
  jobTimeoutMinutesInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    setJobTimeoutMinutes(jobTimeoutMinutesInput.value);
    jobTimeoutMinutesInput.blur();
  });
}
skinButtons.forEach((button) => {
  button.addEventListener("click", () => setUiSkin(button.getAttribute("data-skin")));
});
if (debugPanelToggle) {
  debugPanelToggle.addEventListener("click", () => setDebugPanelVisible(!debugPanelVisible));
}
if (refreshStorageStatsButton) {
  refreshStorageStatsButton.addEventListener("click", requestStorageStats);
}
if (clearAllStorageButton) {
  clearAllStorageButton.addEventListener("click", clearAllExtensionStorage);
}

if (sourceAccountList) {
  sourceAccountList.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-source-account-action]");
    if (!target) return;
    openSourceAccountConfirmModal(
      target.getAttribute("data-account-key"),
      target.getAttribute("data-source-account-action"),
    );
  });
}

if (sourceAccountConfirmCancel) {
  sourceAccountConfirmCancel.addEventListener("click", closeSourceAccountConfirmModal);
}

if (sourceAccountConfirmModal) {
  sourceAccountConfirmModal.addEventListener("click", (event) => {
    const target = event.target && event.target.closest("[data-modal-action]");
    if (target && target.getAttribute("data-modal-action") === "cancel") closeSourceAccountConfirmModal();
  });
}

if (sourceAccountConfirmApply) {
  sourceAccountConfirmApply.addEventListener("click", () => {
    const pending = pendingSourceAccountDecision;
    if (!pending) return;
    closeSourceAccountConfirmModal();
    setSourceAccountApproval(pending.accountKey, pending.state);
  });
}

if (sourceAccountConfirmReject) {
  sourceAccountConfirmReject.addEventListener("click", () => {
    const pending = pendingSourceAccountDecision;
    if (!pending) return;
    closeSourceAccountConfirmModal();
    setSourceAccountApproval(pending.accountKey, "rejected");
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sourceAccountConfirmModal && !sourceAccountConfirmModal.hidden) {
    closeSourceAccountConfirmModal();
  }
});

window.addEventListener("pincat-appearance-changed", (event) => {
  const detail = event && event.detail && typeof event.detail === "object" ? event.detail : {};
  uiSkin = window.PincatSkin ? window.PincatSkin.normalizeSkin(detail.skin) : "bauhaus";
  debugPanelVisible = detail.debugPanelVisible === true;
  renderAppearance();
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === MessageTypes.SV2_DATACAT_STATE_UPDATED) {
    datacatState = message.state || datacatState;
    renderDatacatState();
  }
  if (message.type === MessageTypes.SV2_UPLOAD_SETTINGS_UPDATED) {
    if (message.scope === "window") return;
    uploadVisibility = normalizeUploadVisibility(message.settings && message.settings.visibility);
    jobTimeoutMinutes = normalizeJobTimeoutMinutes(message.settings && message.settings.jobTimeoutMinutes);
    renderUploadVisibility();
    renderJobTimeout();
  }
  if (message.type === MessageTypes.SV2_SOURCE_ACCOUNT_APPROVALS_UPDATED) {
    sourceAccountApprovals = message.approvals && typeof message.approvals === "object" ? message.approvals : {};
    renderSourceAccountApprovals();
    requestSourceAccountSessionStatus();
  }
  if (message.type === MessageTypes.SV2_THUMBNAIL_CACHE_UPDATED || message.type === MessageTypes.SV2_STORAGE_CLEARED) {
    requestStorageStats();
  }
  if (message.type === MessageTypes.SV2_STORAGE_CLEARED) {
    datacatState = null;
    uploadVisibility = "public";
    jobTimeoutMinutes = 2;
    sourceAccountApprovals = {};
    sourceAccountSessions = {};
    renderDatacatState();
    renderUploadVisibility();
    renderJobTimeout();
    renderSourceAccountApprovals();
  }
});

requestDatacatState();
requestUploadSettings();
requestSourceAccountApprovals();
requestStorageStats();
requestAppearance();
updateExtensionDownloadLink();
setSettingsTab(window.location.hash.replace(/^#/, ""), { updateHash: false });
