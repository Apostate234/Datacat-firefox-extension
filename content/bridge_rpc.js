"use strict";

// content/bridge_rpc.js
// Isolated-world side of the page-bridge RPC protocol.
// Injects the page-world bridge script and exchanges postMessage requests
// over the v2r channel. Shared globals declared here (single content-script
// realm) are consumed by the other content/ modules.

// Shared globals use `var` (not const/let) so the isolated content bundle stays
// safe to re-inject into a tab that already ran it (e.g. background re-injection
// on a jannyai.com managed tab). Re-declaration of `var` is a no-op; the ready
// guard in isolated.js prevents duplicate listeners/boot.
var CONTENT_RUNTIME = globalThis.__pincatContentRuntimeV021;
if (!CONTENT_RUNTIME || CONTENT_RUNTIME.version !== "0.21.0") throw new Error("pincat_content_runtime_missing");
var shortErrorShared = (globalThis.SourceVaultErrors && SourceVaultErrors.shortError) || null;
var CHANNEL = "source-vault-sidebar-bridge-v2r";
var BRIDGE_KEY = CONTENT_RUNTIME.bridge.key;
var PAGE_TARGET = "source-vault-page";
var CONTENT_TARGET = "source-vault-content";
var pendingBridge = CONTENT_RUNTIME.bridge.pending;
var bridgeReadyPromise = CONTENT_RUNTIME.bridge.readyPromise;

function shortError(error) {
  if (typeof shortErrorShared === "function") return shortErrorShared(error);
  return String((error && error.message) || error || "unknown_error").slice(0, 500);
}

  function injectPageScriptUrl(scriptUrl) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`failed_to_load_${scriptUrl}`));
      };
      (document.documentElement || document.head || document.body).appendChild(script);
    });
  }

  function getExtensionResourceUrls(path) {
    const cleanPath = String(path || "").replace(/^\/+/, "");
    return cleanPath ? [chrome.runtime.getURL(cleanPath)] : [];
  }

  function injectFirstPageScriptUrl(scriptUrls, index, errors) {
    const urls = Array.isArray(scriptUrls) ? scriptUrls : [];
    const nextIndex = Number.isFinite(index) ? index : 0;
    const loadErrors = Array.isArray(errors) ? errors : [];
    if (nextIndex >= urls.length) {
      throw new Error(loadErrors.length ? `failed_to_load_any_${loadErrors.join("|")}` : "no_script_urls");
    }
    return injectPageScriptUrl(urls[nextIndex]).catch((error) => {
      loadErrors.push(shortError(error));
      return injectFirstPageScriptUrl(urls, nextIndex + 1, loadErrors);
    });
  }

  function injectPageScriptFromFile(path) {
    return injectFirstPageScriptUrl(getExtensionResourceUrls(path));
  }

  function buildPageBridgeScriptUrls() {
    return getExtensionResourceUrls("content/page_bridge.js").map((url) => {
      const scriptUrl = new URL(url);
      scriptUrl.searchParams.set("sourceVaultPageBridge", "1");
      scriptUrl.searchParams.set("channel", CHANNEL);
      scriptUrl.searchParams.set("key", BRIDGE_KEY);
      scriptUrl.searchParams.set("pageTarget", PAGE_TARGET);
      scriptUrl.searchParams.set("contentTarget", CONTENT_TARGET);
      return scriptUrl.href;
    });
  }

  function ensureBridgeReady() {
    if (CONTENT_RUNTIME.bridge.readyPromise) return CONTENT_RUNTIME.bridge.readyPromise;
    // Ordered page-world injection: shared core, then the source adapters (which
    // attach factories to globalThis.SourceVaultPageSources), then page_bridge.js
    // last (the only script carrying the sourceVaultPageBridge=1 config params and
    // the only one that boots).
    bridgeReadyPromise = Promise.resolve()
      .then(() => injectPageScriptFromFile("shared/source_vault_core.js"))
      .then(() => injectPageScriptFromFile("generated/source_registry.js"))
      .then(() => injectPageScriptFromFile("content/sources/runtime.js"))
      .then(() => injectPageScriptFromFile("content/sources/adapter_api.js"))
      .then(async () => {
        const registry = globalThis.SourceVaultSourceRegistry;
        if (!registry || typeof registry.list !== "function") throw new Error("source_registry_missing");
        for (const descriptor of registry.list()) {
          for (const scriptPath of descriptor.pageScripts || [descriptor.pageAdapter]) {
            await injectPageScriptFromFile(scriptPath);
          }
        }
      })
      .then(() => injectFirstPageScriptUrl(buildPageBridgeScriptUrls()))
      .catch((error) => {
        CONTENT_RUNTIME.bridge.readyPromise = null;
        bridgeReadyPromise = null;
        throw error;
      });
    CONTENT_RUNTIME.bridge.readyPromise = bridgeReadyPromise;
    return CONTENT_RUNTIME.bridge.readyPromise;
  }

  function sourceBridgeRequest(sourceId, operation, payload, timeoutMs, retrievalId) {
    return bridgeRequest("sourceRequest", {
      sourceId,
      operation,
      payload: payload || {},
    }, timeoutMs, retrievalId);
  }

  function bridgeRequest(action, payload, timeoutMs, retrievalId) {
    return ensureBridgeReady().then(() => {
      return new Promise((resolve, reject) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const timer = setTimeout(() => {
          pendingBridge.delete(id);
          reject(new Error(`${action}_timeout`));
        }, Math.max(3000, timeoutMs || 30000));
        pendingBridge.set(id, { resolve, reject, timer });
        window.postMessage(
          {
            channel: CHANNEL,
            key: BRIDGE_KEY,
            target: PAGE_TARGET,
            id,
            action,
            payload: payload || {},
            retrievalId: retrievalId || null,
          },
          "*",
        );
      });
    });
  }

function isActiveCharacterRetrievalBridgeStatus(message) {
  const messageRetrievalId = String(message && message.retrievalId || "").trim();
  const currentRetrievalId = typeof activeRetrievalId === "undefined"
    ? ""
    : String(activeRetrievalId || "").trim();
  const currentRetrieval = typeof state === "undefined" || !state || !state.retrieval
    ? null
    : state.retrieval;
  return !!(
    messageRetrievalId &&
    currentRetrievalId &&
    messageRetrievalId === currentRetrievalId &&
    currentRetrieval &&
    currentRetrieval.running === true &&
    String(currentRetrieval.retrievalId || "").trim() === messageRetrievalId
  );
}

function installBridgeWindowListener() {
  if (CONTENT_RUNTIME.bridge.listenerInstalled) return;
  CONTENT_RUNTIME.bridge.listenerInstalled = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || msg.key !== BRIDGE_KEY || msg.target !== CONTENT_TARGET) return;
    if (msg.type === "status") {
      if (isActiveCharacterRetrievalBridgeStatus(msg)) {
        appendRetrievalLog(msg.stage, msg.message, msg.details);
      }
      return;
    }
    const pending = pendingBridge.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingBridge.delete(msg.id);
    if (msg.ok) pending.resolve(msg.payload);
    else pending.reject(new Error(msg.error || "bridge_request_failed"));
  });
}
