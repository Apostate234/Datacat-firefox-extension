# Firefox Compatibility Guide

This document outlines the changes made to support Firefox alongside Chrome, and known limitations.

## Changes Made

### 1. Browser Compatibility Layer
- **File:** `background/browser_compat.js`
- Created a unified API abstraction that detects the available API namespace (`browser` for Firefox, `chrome` for Chrome)
- Provides fallbacks for browser-specific features (e.g., `sidePanel` vs `sidebarAction`)
- Utility methods to detect browser type and feature availability

### 2. Firefox Manifest
- **File:** `manifest.firefox.json`
- Based on Chrome's MV3 manifest with Firefox-specific adjustments:
  - Added `browser_specific_settings` with Firefox-specific configuration
  - Set minimum Firefox version to 109.0 (MV3 support)
  - Added unique extension ID for Firefox (`pincat@cressida.dev`)
  - Included fallback for sidebar_action with proper icon configuration

### 3. Service Worker Entry Point
- **Location:** `background/index.js`
- Updated to load `browser_compat.js` first (before other background modules)
- Uses `importScripts()` which works identically in both browsers

## How to Use

### For Chrome (Current):
- Use the standard `manifest.json`
- Load extension in Chrome normally

### For Firefox:
1. Rename or copy `manifest.firefox.json` to `manifest.json` when building for Firefox
2. Or use a build script to swap manifests
3. Load as a temporary add-on in Firefox Developer Edition using `about:debugging`
4. For production, submit to Mozilla Add-ons store with `manifest.firefox.json`

## Known Issues & Limitations

### 1. Side Panel vs Sidebar
- **Chrome:** Uses `chrome.sidePanel` (newer API)
- **Firefox:** Uses `sidebar_action` (MV3 support added in Firefox 114+)
- **Status:** ✅ Handled - both APIs are declared in respective manifests

### 2. Tab Opening in Background
- **File:** `background/router.js`, line 463
- **Issue:** `chrome.tabs.create()` doesn't always work reliably from service workers in MV3
- **Firefox Impact:** Same limitation applies
- **Workaround:** May need to refactor to use content scripts or user interaction
- **Status:** ⚠️ Needs testing and potential refactoring

### 3. Window Management APIs
- **API:** `chrome.windows` (used in `background/chrome_adapters.js`)
- **Status:** ✅ Supported - both Chrome and Firefox implement this identically

### 4. Alarms API
- **File:** `background/index.js`, lines 74-92
- **Status:** ✅ Supported - works identically in both browsers

### 5. Storage API
- **File:** `background/storage.js`
- **Chrome:** 10MB limit (or more with `unlimitedStorage`)
- **Firefox:** 10MB limit per area (or unlimited with `unlimitedStorage`)
- **Status:** ✅ Compatible - permission is already declared

### 6. Content Scripts
- **File:** `manifest.json` / `manifest.firefox.json`
- **Status:** ✅ Compatible - same syntax in both browsers

### 7. Scripting API
- **File:** `background/chrome_adapters.js`, lines 101-174
- **Issue:** Firefox has limited support for `chrome.scripting.executeScript()` with `world: "MAIN"`
- **Status:** ⚠️ Needs testing - may need fallback to content scripts
- **Note:** The `world` parameter may not work as expected in Firefox

### 8. External Messaging
- **File:** `background/router.js`, lines 612-637
- **Status:** ✅ Supported - `onMessageExternal` works identically

## Testing Checklist

- [ ] Extension loads in Firefox without errors
- [ ] Sidebar opens when clicking extension icon
- [ ] Content scripts inject successfully
- [ ] Tab navigation detection works
- [ ] Character retrieval flow completes
- [ ] Storage operations work correctly
- [ ] Datacat linking/authentication works
- [ ] All settings persist across browser restarts
- [ ] No console errors related to API calls

## Migration Path

1. **Phase 1 (Current):** Compatibility layer is in place, Firefox manifest prepared
2. **Phase 2:** Full testing on Firefox Developer Edition
3. **Phase 3:** Refactor any failing components (e.g., `chrome.scripting` workarounds)
4. **Phase 4:** Submit to Mozilla Add-ons store

## References

- [MDN WebExtensions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [Firefox MV3 Support Status](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json)
- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/mv3/)

## Next Steps

1. Test on Firefox Developer Edition
2. Debug any runtime errors using Firefox DevTools
3. Create tickets for issues found during testing
4. Consider build tooling to automate manifest selection
