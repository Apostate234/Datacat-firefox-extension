"use strict";

// content/sources/adapter_api.js
// Page-world shared adapter helpers: fetch timeout/backoff, JSON/text envelope
// fetchers, and page-state hydration check. Attaches a factory to
// globalThis.SourceVaultPageSources.createAdapterApi so page_bridge.js can build
// one shared api object and hand it to the per-source adapters. No site-specific
// logic lives here.

(function initSourceVaultAdapterApi() {
  const ns = (globalThis.SourceVaultPageSources = globalThis.SourceVaultPageSources || {});

  ns.createAdapterApi = function createAdapterApi(ctx) {
    const CoreInPage = ctx && ctx.CoreInPage;
    const FETCH_TIMEOUT_MS = 30000;
    const FETCH_BACKOFF_MS = [7000, 10000, 15000];

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    async function fetchJsonEnvelope(name, requestUrl, token, init, options) {
      const response = await fetchWithTimeoutAndRetry(
        requestUrl,
        {
          method: (init && init.method) || "GET",
          credentials: "include",
          headers: {
            accept: "application/json, text/plain, */*",
            ...(init && init.body ? { "content-type": "application/json" } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...((init && init.headers) || {}),
          },
          body: init && init.body ? JSON.stringify(init.body) : undefined,
        },
        options || { timeoutMs: FETCH_TIMEOUT_MS, backoffMs: [1000, 2000] },
      );
      const text = await response.text();
      let json = null;
      let parseError = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (error) {
        parseError = error && error.message ? error.message : String(error);
      }
      return {
        fetched_at: new Date().toISOString(),
        request: {
          name,
          method: (init && init.method) || "GET",
          url: response.url || requestUrl,
          has_bearer: !!token,
        },
        response: {
          ok: response.ok,
          status: response.status,
          status_text: response.statusText,
          url: response.url || requestUrl,
          headers: { content_type: response.headers.get("content-type") || null },
          json,
          text: json ? null : text.slice(0, 1000),
          parse_error: parseError,
        },
      };
    }

    async function fetchTextEnvelope(name, requestUrl, token, init, options) {
      const response = await fetchWithTimeoutAndRetry(
        requestUrl,
        {
          method: (init && init.method) || "GET",
          credentials: "include",
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...((init && init.headers) || {}),
          },
          body: init && init.body ? String(init.body) : undefined,
        },
        options || { timeoutMs: FETCH_TIMEOUT_MS, backoffMs: [1000, 2000] },
      );
      const text = await response.text();
      return {
        fetched_at: new Date().toISOString(),
        request: {
          name,
          method: (init && init.method) || "GET",
          url: response.url || requestUrl,
          has_bearer: !!token,
        },
        response: {
          ok: response.ok,
          status: response.status,
          status_text: response.statusText,
          url: response.url || requestUrl,
          headers: { content_type: response.headers.get("content-type") || null },
          text,
        },
      };
    }

    function isRetriableStatus(status) {
      return status === 408 || status === 425 || status === 429 || status >= 500;
    }

    function isRetriableError(error) {
      const msg = String((error && error.message) || error || "");
      return /AbortError|aborted|timeout|Failed to fetch|NetworkError/i.test(msg);
    }

    async function fetchWithTimeoutAndRetry(requestUrl, init, options) {
      const timeoutMs = Math.max(1000, Number((options && options.timeoutMs) || FETCH_TIMEOUT_MS));
      const backoff = Array.isArray(options && options.backoffMs) ? options.backoffMs : FETCH_BACKOFF_MS;
      const attempts = backoff.length + 1;
      let lastError = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(requestUrl, {
            ...(init || {}),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (isRetriableStatus(response.status) && attempt < attempts) {
            await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)]);
            continue;
          }
          return response;
        } catch (error) {
          clearTimeout(timer);
          lastError = error;
          if (!isRetriableError(error) || attempt >= attempts) throw error;
          await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)]);
        }
      }
      throw lastError || new Error("fetch_failed");
    }

    function hasHydratedPageCharacter(result) {
      const character = result && result.character;
      if (!character || !character.name) return false;
      if (CoreInPage && typeof CoreInPage.isSettledSourceCharacterState === "function") {
        return CoreInPage.isSettledSourceCharacterState(
          character.sourceKind || (result && result.sourceKind) || "janitor",
          character,
          { isCharacterPage: true, sourceKind: character.sourceKind || (result && result.sourceKind) || "janitor" },
        );
      }
      return ![
        "document_body",
        "document_fallback",
        "document_og_title",
        "document_title",
        "document_twitter_title",
        "url",
      ].includes(character.source);
    }

    return {
      FETCH_TIMEOUT_MS,
      FETCH_BACKOFF_MS,
      sleep,
      fetchJsonEnvelope,
      fetchTextEnvelope,
      isRetriableStatus,
      isRetriableError,
      fetchWithTimeoutAndRetry,
      hasHydratedPageCharacter,
    };
  };
})();
