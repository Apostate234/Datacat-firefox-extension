"use strict";

// The Chrome Web Store edition omits the development diagnostics panel and
// logging buffer. These no-op helpers preserve the production UI call surface.
function sanitizeDebugPayload(value) { return value; }
function summarizeStateForDebug() { return null; }
function getDebugContext() { return null; }
function appendDebugEntry() {}
function debugLog() {}
function toggleDebugPanelCollapsed() {}
function renderDebugPanel() {}
