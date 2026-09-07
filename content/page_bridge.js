(function initSourceVaultPageBridge() {
  "use strict";

  // content/page_bridge.js
  // Page-world dispatcher. Injected by the isolated content script
  // (bridge_rpc.js) as a web-accessible resource with the v2r channel config in
  // its script-URL query params, AFTER the shared page-world scripts
  // (source_vault_core.js + generated registry + packaged source adapters).
  // Reads that config, builds the shared adapter API, and routes generic source
  // bridge requests to them. Every response payload leaving the page world is
  // passed through sanitize (CoreInPage.sanitizeForTransport): detect/pageState
  // results are sanitized here; retrieval adapters return already-sanitized
  // payloads and sendStatus sanitizes status detail.

  function readInjectedPageBridgeConfig() {
    try {
      const currentScript = document.currentScript;
      if (!currentScript || !currentScript.src) return null;
      const scriptUrl = new URL(currentScript.src);
      if (scriptUrl.searchParams.get("sourceVaultPageBridge") !== "1") return null;
      return {
        channel: scriptUrl.searchParams.get("channel") || "source-vault-sidebar-bridge-v2r",
        key: scriptUrl.searchParams.get("key") || "",
        pageTarget: scriptUrl.searchParams.get("pageTarget") || "source-vault-page",
        contentTarget: scriptUrl.searchParams.get("contentTarget") || "source-vault-content",
      };
    } catch (_) {
      return null;
    }
  }

  function pageBridgeMain(config) {
    const CHANNEL_IN_PAGE = config.channel;
    const BRIDGE_KEY_IN_PAGE = config.key;
    const PAGE_TARGET_IN_PAGE = config.pageTarget;
    const CONTENT_TARGET_IN_PAGE = config.contentTarget;
    const CoreInPage = window.SourceVaultCore;

    window.__SOURCE_VAULT_PAGE_BRIDGE_V2R_COUNT__ =
      Number(window.__SOURCE_VAULT_PAGE_BRIDGE_V2R_COUNT__ || 0) + 1;

    function sendResponse(id, ok, payload, error) {
      window.postMessage(
        {
          channel: CHANNEL_IN_PAGE,
          key: BRIDGE_KEY_IN_PAGE,
          target: CONTENT_TARGET_IN_PAGE,
          id,
          ok,
          payload: payload || null,
          error: error || null,
        },
        "*",
      );
    }

    function sendStatus(retrievalId, stage, message, details) {
      window.postMessage(
        {
          channel: CHANNEL_IN_PAGE,
          key: BRIDGE_KEY_IN_PAGE,
          target: CONTENT_TARGET_IN_PAGE,
          type: "status",
          retrievalId: retrievalId || null,
          stage,
          message,
          details: sanitize(details || null),
        },
        "*",
      );
    }

    function sanitize(value) {
      return CoreInPage && CoreInPage.sanitizeForTransport
        ? CoreInPage.sanitizeForTransport(value)
        : value;
    }

    const sources = globalThis.SourceVaultPageSources || {};
    const registry = globalThis.SourceVaultSourceRegistry;
    if (typeof sources.createAdapterApi !== "function" || typeof sources.create !== "function" || !registry) {
      throw new Error("source_vault_page_adapters_missing");
    }
    const adapterApi = sources.createAdapterApi({ CoreInPage });
    const adapterCtx = { CoreInPage, sanitize, sendStatus, api: adapterApi };
    const adapters = new Map();

    function resolveSourceId(value) {
      const explicit = registry.normalizeSourceId(value);
      if (explicit) return explicit;
      const resolved = registry.resolveUrl(location.href);
      return resolved && resolved.sourceKind ? resolved.sourceKind : null;
    }

    function getAdapter(sourceId) {
      const id = resolveSourceId(sourceId);
      if (!id) throw new Error("source_not_detected");
      if (!adapters.has(id)) adapters.set(id, sources.create(id, adapterCtx));
      return { id, adapter: adapters.get(id) };
    }

    async function performSourceRequest(sourceId, operation, payload, retrievalId) {
      const { adapter } = getAdapter(sourceId);
      const methods = {
        detectSession: "detectAuth",
        detectLocalSession: "detectLocalAuth",
        readPageState: "readPageState",
        captureCharacter: "retrieveCore",
        captureCreator: "retrieveCreatorProfile",
      };
      const methodName = methods[String(operation || "")];
      if (!methodName || typeof adapter[methodName] !== "function") {
        throw new Error(`source_operation_unsupported_${String(operation || "unknown")}`);
      }
      if (operation === "captureCharacter" || operation === "captureCreator") {
        return adapter[methodName](payload || {}, retrievalId || null);
      }
      return adapter[methodName](payload || {});
    }

    window.addEventListener("message", async (event) => {
      if (event.source !== window) return;
      const msg = event.data;
      if (!msg || msg.channel !== CHANNEL_IN_PAGE || msg.key !== BRIDGE_KEY_IN_PAGE || msg.target !== PAGE_TARGET_IN_PAGE) return;
      try {
        if (msg.action === "sourceRequest") {
          const request = msg.payload && typeof msg.payload === "object" ? msg.payload : {};
          const result = await performSourceRequest(
            request.sourceId,
            request.operation,
            request.payload || {},
            msg.retrievalId || null,
          );
          sendResponse(msg.id, true, sanitize(result));
          return;
        }
        sendResponse(msg.id, false, null, `unknown_action_${msg.action}`);
      } catch (error) {
        sendResponse(msg.id, false, null, String((error && error.message) || error || "bridge_error"));
      }
    });
  }

  const pageBridgeConfig = readInjectedPageBridgeConfig();
  if (pageBridgeConfig) {
    pageBridgeMain(pageBridgeConfig);
  }
})();
