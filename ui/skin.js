"use strict";

(function initPincatSkin() {
  const StorageKeys = (globalThis.SourceVaultStorageKeys && SourceVaultStorageKeys.StorageKeys) || {};
  const SKIN_KEY = StorageKeys.UI_SKIN || "sv2rUiSkin";
  const DEBUG_PANEL_KEY = StorageKeys.DEBUG_PANEL_VISIBLE || "sv2rDebugPanelVisible";
  const DEFAULT_SKIN = "bauhaus";

  function normalizeSkin(value) {
    return String(value || "").trim().toLowerCase() === "classic" ? "classic" : DEFAULT_SKIN;
  }

  function applyPreferences(preferences = {}) {
    const skin = normalizeSkin(preferences.skin);
    const debugPanelVisible = preferences.debugPanelVisible === true;
    const root = document.documentElement;
    root.classList.toggle("skin-bauhaus", skin === "bauhaus");
    root.classList.toggle("skin-classic", skin === "classic");
    root.classList.toggle("show-debug-panel", debugPanelVisible);
    root.dataset.pincatSkin = skin;
    window.dispatchEvent(new CustomEvent("pincat-appearance-changed", {
      detail: { skin, debugPanelVisible },
    }));
    return { skin, debugPanelVisible };
  }

  function read(callback) {
    chrome.storage.local.get([SKIN_KEY, DEBUG_PANEL_KEY], (values) => {
      const preferences = applyPreferences({
        skin: values && values[SKIN_KEY],
        debugPanelVisible: values && values[DEBUG_PANEL_KEY] === true,
      });
      if (typeof callback === "function") callback(preferences);
    });
  }

  function setSkin(value, callback) {
    const skin = normalizeSkin(value);
    const debugPanelVisible = document.documentElement.classList.contains("show-debug-panel");
    applyPreferences({ skin, debugPanelVisible });
    chrome.storage.local.set({ [SKIN_KEY]: skin }, () => {
      if (typeof callback === "function") callback(skin);
    });
  }

  function setDebugPanelVisible(value, callback) {
    const debugPanelVisible = value === true;
    const skin = normalizeSkin(document.documentElement.dataset.pincatSkin);
    applyPreferences({ skin, debugPanelVisible });
    chrome.storage.local.set({ [DEBUG_PANEL_KEY]: debugPanelVisible }, () => {
      if (typeof callback === "function") callback(debugPanelVisible);
    });
  }

  window.PincatSkin = {
    SKIN_KEY,
    DEBUG_PANEL_KEY,
    DEFAULT_SKIN,
    normalizeSkin,
    applyPreferences,
    read,
    setSkin,
    setDebugPanelVisible,
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes[SKIN_KEY] && !changes[DEBUG_PANEL_KEY]) return;
    read();
  });

  read();
})();
