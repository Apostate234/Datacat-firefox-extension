"use strict";
// background/browser_compat.js — Abstraction layer for Chrome/Firefox API differences
// This module provides a unified API namespace that works across both browsers.
// Firefox uses 'browser.*' while Chrome uses 'chrome.*'. This wrapper normalizes access.

// Detect which API is available and use it as the canonical namespace
const extensionAPI = (typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined')
  ? browser
  : (typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined')
    ? chrome
    : null;

if (!extensionAPI) {
  throw new Error('WebExtension API not available. This extension requires a compatible browser.');
}

// Export as a consistent namespace that can be used throughout the background scripts
const BrowserCompat = {
  // Core runtime APIs
  runtime: extensionAPI.runtime,
  tabs: extensionAPI.tabs,
  windows: extensionAPI.windows,
  storage: extensionAPI.storage,
  alarms: extensionAPI.alarms,
  action: extensionAPI.action,
  scripting: extensionAPI.scripting,

  // API-specific features (may not exist in all browsers)
  sidePanel: extensionAPI.sidePanel || null,
  sidebarAction: extensionAPI.sidebarAction || null,

  // Firefox-specific or Chrome-specific, fallback gracefully
  has: (apiPath) => {
    const parts = apiPath.split('.');
    let current = extensionAPI;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return false;
      current = current[part];
    }
    return current != null;
  },

  // Get current browser name
  getBrowserName() {
    try {
      const ua = navigator.userAgent;
      if (ua.includes('Firefox')) return 'firefox';
      if (ua.includes('Chrome') && !ua.includes('Chromium')) return 'chrome';
      if (ua.includes('Edge')) return 'edge';
      return 'unknown';
    } catch (_) {
      return 'unknown';
    }
  },

  // Check if running on Firefox
  isFirefox() {
    return this.getBrowserName() === 'firefox';
  },

  // Check if running on Chrome/Chromium
  isChrome() {
    const name = this.getBrowserName();
    return name === 'chrome' || name === 'edge';
  },
};

// Object.freeze to prevent accidental modifications
Object.freeze(BrowserCompat);
