"use strict";

(function initSourceVaultErrors(globalScope) {
  function normalizeError(error) {
    return String((error && error.message) || error || "unknown_error").slice(0, 500);
  }

  function shortError(error) {
    return normalizeError(error);
  }

  function isMissingReceiverError(error) {
    const message = String((error && error.message) || error || "").toLowerCase();
    return (
      message.includes("receiving end does not exist") ||
      message.includes("could not establish connection")
    );
  }

  // Alias used by background tab messaging.
  const isMissingContentReceiverError = isMissingReceiverError;

  const api = Object.freeze({
    normalizeError,
    shortError,
    isMissingReceiverError,
    isMissingContentReceiverError,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.SourceVaultErrors = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
