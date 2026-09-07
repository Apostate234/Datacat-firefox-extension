"use strict";

(function initPincatRuntimeHealth(globalScope) {
  const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
  const PING_TIMEOUT_MS = 2500;
  const RELOAD_DELAY_MS = 50;
  const RELOAD_GUARD_MS = 15000;
  const PING_MIN_INTERVAL_MS = 1000;
  const RELOAD_MARKER_KEY = "pincatRuntimeReloadAttemptedAt";
  const TIMEOUT_ERROR = "Pincat is taking too long to respond. Try again.";

  function createRuntimeHealth(options = {}) {
    const runtime = options.runtime || (globalScope.chrome && globalScope.chrome.runtime);
    const session = options.sessionStorage || globalScope.sessionStorage || null;
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const setTimer = typeof options.setTimeout === "function" ? options.setTimeout : globalScope.setTimeout.bind(globalScope);
    const clearTimer = typeof options.clearTimeout === "function" ? options.clearTimeout : globalScope.clearTimeout.bind(globalScope);
    const reload = typeof options.reload === "function"
      ? options.reload
      : () => globalScope.location.reload();
    const dispatch = typeof options.dispatch === "function"
      ? options.dispatch
      : (name, detail) => {
          if (typeof globalScope.dispatchEvent !== "function" || typeof globalScope.CustomEvent !== "function") return;
          globalScope.dispatchEvent(new globalScope.CustomEvent(name, { detail }));
        };

    let recoveryStarted = false;
    let pingInFlight = null;
    let lastPingAt = 0;

    function readReloadMarker() {
      try {
        return Number(session && session.getItem(RELOAD_MARKER_KEY)) || 0;
      } catch (_) {
        return 0;
      }
    }

    function writeReloadMarker(value) {
      try {
        if (!session) return;
        if (value) session.setItem(RELOAD_MARKER_KEY, String(value));
        else session.removeItem(RELOAD_MARKER_KEY);
      } catch (_) {}
    }

    function normalizeRuntimeError(error, fallback = TIMEOUT_ERROR) {
      const message = String(error && error.message || error || fallback).trim() || fallback;
      return { code: "runtime_unavailable", message };
    }

    function recover(error) {
      if (recoveryStarted) return false;
      recoveryStarted = true;
      const detail = normalizeRuntimeError(error, "Pincat background is unavailable.");
      const attemptedAt = readReloadMarker();
      const currentTime = now();
      if (!attemptedAt || currentTime - attemptedAt >= RELOAD_GUARD_MS) {
        writeReloadMarker(currentTime);
        dispatch("pincat-runtime-recovering", detail);
        setTimer(() => {
          try {
            reload();
          } catch (reloadError) {
            dispatch("pincat-runtime-unavailable", normalizeRuntimeError(reloadError));
          }
        }, RELOAD_DELAY_MS);
        return true;
      }
      dispatch("pincat-runtime-unavailable", detail);
      return false;
    }

    function send(message, callback, requestOptions = {}) {
      const timeoutMs = Math.max(250, Number(requestOptions.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS));
      let settled = false;
      let timer = null;

      const finish = (response, error) => {
        if (settled) return;
        settled = true;
        if (timer != null) clearTimer(timer);
        if (typeof callback === "function") callback(response, error || null);
        if (error && requestOptions.recover === true) recover(error);
      };

      timer = setTimer(() => {
        const error = normalizeRuntimeError(TIMEOUT_ERROR);
        finish({ ok: false, error: error.message, code: "runtime_request_timeout" }, error);
      }, timeoutMs);

      try {
        runtime.sendMessage(message, (response) => {
          let runtimeError = null;
          try {
            if (runtime.lastError) runtimeError = normalizeRuntimeError(runtime.lastError);
          } catch (error) {
            runtimeError = normalizeRuntimeError(error);
          }
          finish(response, runtimeError);
        });
      } catch (error) {
        finish(undefined, normalizeRuntimeError(error));
      }
    }

    function ping(pingOptions = {}) {
      if (pingInFlight) return pingInFlight;
      const currentTime = now();
      if (pingOptions.force !== true && lastPingAt && currentTime - lastPingAt < PING_MIN_INTERVAL_MS) {
        return Promise.resolve(true);
      }
      lastPingAt = currentTime;
      const request = new Promise((resolve) => {
        send({ type: "SV2_RUNTIME_PING" }, (response, error) => {
          if (!error && response && response.ok) {
            recoveryStarted = false;
            writeReloadMarker(0);
            dispatch("pincat-runtime-ready", { version: response.version || null });
            resolve(true);
            return;
          }
          recover(error || (response && response.error) || "Pincat background is unavailable.");
          resolve(false);
        }, { timeoutMs: PING_TIMEOUT_MS, recover: false });
      });
      pingInFlight = request.finally(() => {
        pingInFlight = null;
      });
      return pingInFlight;
    }

    return Object.freeze({ send, ping, recover });
  }

  const api = Object.freeze({
    createRuntimeHealth,
    DEFAULT_REQUEST_TIMEOUT_MS,
    PING_TIMEOUT_MS,
    PING_MIN_INTERVAL_MS,
    RELOAD_GUARD_MS,
    RELOAD_MARKER_KEY,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (
    globalScope &&
    globalScope.chrome &&
    globalScope.chrome.runtime &&
    typeof globalScope.chrome.runtime.sendMessage === "function" &&
    globalScope.location
  ) {
    const client = createRuntimeHealth();
    globalScope.PincatRuntimeHealth = client;
    const checkRuntime = () => client.ping();
    client.ping({ force: true });
    if (typeof globalScope.addEventListener === "function") {
      globalScope.addEventListener("focus", checkRuntime);
    }
    if (globalScope.document && typeof globalScope.document.addEventListener === "function") {
      globalScope.document.addEventListener("visibilitychange", () => {
        if (!globalScope.document.hidden) checkRuntime();
      });
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
