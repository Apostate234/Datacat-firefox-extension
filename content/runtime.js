"use strict";

(function initPincatContentRuntime(globalScope) {
  const current = globalScope.__pincatContentRuntimeV021;
  if (current && current.version === "0.21.0") return;
  globalScope.__pincatContentRuntimeV021 = {
    version: "0.21.0",
    contentInstanceId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    started: false,
    state: null,
    bridge: {
      key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      pending: new Map(),
      readyPromise: null,
      listenerInstalled: false,
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
