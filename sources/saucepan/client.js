"use strict";

(function initSaucepanClient(globalScope) {
  globalScope.SourceVaultSaucepanClient = function createSaucepanClient(context = {}) {
    const fetchWithTimeoutAndRetry = context.fetchWithTimeoutAndRetry;
    const fetchJsonEnvelope = context.fetchJsonEnvelope;
    const FETCH_TIMEOUT_MS = context.FETCH_TIMEOUT_MS;
    function getSaucepanAuthToken() {
      const rawToken = window.localStorage ? window.localStorage.getItem("hallucination/auth_token") : null;
      if (!rawToken) return null;
      let token = rawToken;
      try {
        const parsed = JSON.parse(rawToken);
        if (typeof parsed === "string") token = parsed;
        else if (parsed && typeof parsed === "object") token = parsed.access_token || parsed.token || rawToken;
      } catch (_) {}
      return token ? String(token) : null;
    }

    function getSaucepanPreferredGenerationConfig() {
      const raw = window.localStorage ? window.localStorage.getItem("preferred-generation-config") : null;
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : raw;
      } catch (_) {
        return raw;
      }
    }

    function buildSaucepanApiUrl(path, version) {
      const apiVersion = version === "v2" ? "v2" : "v1";
      const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
      return `https://saucepan.ai/api/${apiVersion}${normalizedPath}`;
    }

    async function fetchSaucepanUsersMe(token) {
      return fetchJsonEnvelope("users_me", buildSaucepanApiUrl("/users/me", "v1"), token, null, {
        timeoutMs: 15000,
        backoffMs: [1000],
      });
    }

    async function fetchSaucepanCompanion(token, companionId) {
      const id = String(companionId || "").trim();
      const primary = await fetchJsonEnvelope(
        "companion",
        buildSaucepanApiUrl(`/companions/${encodeURIComponent(id)}`, "v2"),
        token,
      );
      if (primary.response && primary.response.ok === false && (primary.response.status === 405 || primary.response.status === 501)) {
        return fetchJsonEnvelope(
          "companion",
          buildSaucepanApiUrl(`/companion?id=${encodeURIComponent(id)}`, "v1"),
          token,
        );
      }
      return primary;
    }

    function getSaucepanCompanionRecord(envelope) {
      const body = envelope && envelope.response && envelope.response.json ? envelope.response.json : envelope;
      if (!body || typeof body !== "object") return null;
      if (body.companion && typeof body.companion === "object") return body.companion;
      if (body.data && body.data.companion && typeof body.data.companion === "object") return body.data.companion;
      if (body.data && typeof body.data === "object" && (body.data.id || body.data.companion_id)) return body.data;
      return body;
    }

    async function fetchSaucepanCompanionDefinition(token, companionId) {
      return fetchJsonEnvelope(
        "companion_definition",
        buildSaucepanApiUrl(`/companion/definition?companion_id=${encodeURIComponent(String(companionId || ""))}`, "v1"),
        token,
      );
    }

    async function fetchSaucepanCompanionLorebooks(token, companionId) {
      return fetchJsonEnvelope(
        "companion_lorebooks",
        buildSaucepanApiUrl(`/companions/${encodeURIComponent(String(companionId || "").trim())}/lorebooks`, "v2"),
        token,
      );
    }

    async function fetchSaucepanHiddenCheck(token, companionId) {
      return fetchJsonEnvelope(
        "companions_hidden_check",
        buildSaucepanApiUrl(`/companions/hidden/check?companion_id=${encodeURIComponent(String(companionId || ""))}`, "v1"),
        token,
      );
    }

    async function fetchSaucepanChatsByCompanion(token, companionId) {
      return fetchJsonEnvelope(
        "chats_by_companion",
        buildSaucepanApiUrl(`/chats/by-companion?companion_id=${encodeURIComponent(String(companionId || ""))}`, "v1"),
        token,
      );
    }

    async function fetchSaucepanUserByHandle(token, handle) {
      return fetchJsonEnvelope(
        "user_by_handle",
        buildSaucepanApiUrl(`/user?handle=${encodeURIComponent(String(handle || "").trim())}`, "v1"),
        token,
      );
    }

    async function fetchSaucepanUserPage(token, handle) {
      return fetchJsonEnvelope(
        "user_page",
        buildSaucepanApiUrl(`/user-page?handle=${encodeURIComponent(String(handle || "").trim())}`, "v1"),
        token,
      );
    }

    async function fetchSaucepanUserCompanionsV2(token, handle) {
      return fetchJsonEnvelope(
        "user_companions_v2",
        buildSaucepanApiUrl(`/users/${encodeURIComponent(String(handle || "").trim())}/companions?hide_hidden_content=false`, "v2"),
        token,
      );
    }

    async function fetchSaucepanUserLorebooksV2(token, handle) {
      return fetchJsonEnvelope(
        "user_lorebooks_v2",
        buildSaucepanApiUrl(`/users/${encodeURIComponent(String(handle || "").trim())}/lorebooks`, "v2"),
        token,
      );
    }

    async function fetchSaucepanUserPosts(token, handle, limit, offset) {
      return fetchJsonEnvelope(
        "user_posts",
        buildSaucepanApiUrl(`/posts/${encodeURIComponent(String(handle || "").trim())}?limit=${encodeURIComponent(String(limit || 10))}&offset=${encodeURIComponent(String(offset || 0))}`, "v1"),
        token,
      );
    }

    async function fetchSaucepanCompanionsOfUser(token, handle) {
      return fetchJsonEnvelope(
        "companions_of_user",
        buildSaucepanApiUrl(`/companions-of-user?handle=${encodeURIComponent(String(handle || "").trim())}&hide_hidden_content=false`, "v1"),
        token,
      );
    }

    async function fetchSaucepanCustomPageDefault(token, userId) {
      return fetchJsonEnvelope(
        "custom_page_default",
        buildSaucepanApiUrl(`/custom-pages/default?user_id=${encodeURIComponent(String(userId || "").trim())}`, "v1"),
        token,
      );
    }

    async function fetchSaucepanCustomPageInfo(token, handle, pageName, pageType) {
      return fetchJsonEnvelope(
        "custom_page_info",
        buildSaucepanApiUrl(
          `/custom-pages/info?handle=${encodeURIComponent(String(handle || "").trim())}&page_name=${encodeURIComponent(String(pageName || "").trim())}&page_type=${encodeURIComponent(String(pageType || "home").trim() || "home")}`,
          "v1",
        ),
        token,
      );
    }

    async function fetchSaucepanCustomPageRender(token, params) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params || {})) {
        if (value == null || value === "") continue;
        query.set(key, String(value));
      }
      return fetchJsonEnvelope(
        "custom_page_render",
        buildSaucepanApiUrl(`/custom-pages/render?${query.toString()}`, "v1"),
        token,
      );
    }
    return { getSaucepanAuthToken, getSaucepanPreferredGenerationConfig, buildSaucepanApiUrl, fetchSaucepanUsersMe, fetchSaucepanCompanion, getSaucepanCompanionRecord, fetchSaucepanCompanionDefinition, fetchSaucepanCompanionLorebooks, fetchSaucepanHiddenCheck, fetchSaucepanChatsByCompanion, fetchSaucepanUserByHandle, fetchSaucepanUserPage, fetchSaucepanUserCompanionsV2, fetchSaucepanUserLorebooksV2, fetchSaucepanUserPosts, fetchSaucepanCompanionsOfUser, fetchSaucepanCustomPageDefault, fetchSaucepanCustomPageInfo, fetchSaucepanCustomPageRender };
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
