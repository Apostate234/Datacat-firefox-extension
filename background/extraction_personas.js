"use strict";
// background/extraction_personas.js — stable opaque capture-persona aliases.
// The installation secret and hashed account locators stay in chrome.storage.local;
// source account identifiers are never persisted in this state.

const EXTRACTION_PERSONA_STATE_VERSION = 1;
const EXTRACTION_PERSONA_ALIAS_LENGTH = 20;
const EXTRACTION_PERSONA_MAX_ACCOUNT_ALIASES = 200;
const EXTRACTION_PERSONA_CONTENT_CLEANUP_VERSION = 1;
let extractionPersonaStateMutation = Promise.resolve();

function normalizeExtractionPersonaSourceKind(value) {
  const normalized = SourceVaultCore.normalizeSourceKind(value);
  if (normalized === "janitor" || normalized === "saucepan") return normalized;
  return null;
}

function normalizeExtractionPersonaAccountId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized && normalized.length <= 500 ? normalized : null;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) return null;
  try {
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (_) {
    return null;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createExtractionPersonaInstallationSecret() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function normalizeExtractionPersonaState(value) {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const secretBytes = base64UrlToBytes(root.installationSecret);
  const aliases = root.aliases && typeof root.aliases === "object" && !Array.isArray(root.aliases)
    ? { ...root.aliases }
    : {};
  return {
    version: EXTRACTION_PERSONA_STATE_VERSION,
    installationSecret: secretBytes && secretBytes.length === 32
      ? root.installationSecret
      : createExtractionPersonaInstallationSecret(),
    aliases,
    retrievedCleanupVersion: Math.max(0, Number(root.retrievedCleanupVersion) || 0),
  };
}

async function readExtractionPersonaState() {
  const result = await storageGet({ [EXTRACTION_PERSONA_STATE_STORAGE_KEY]: null });
  return normalizeExtractionPersonaState(result[EXTRACTION_PERSONA_STATE_STORAGE_KEY]);
}

async function writeExtractionPersonaState(state) {
  const normalized = normalizeExtractionPersonaState(state);
  await storageSet({ [EXTRACTION_PERSONA_STATE_STORAGE_KEY]: normalized });
  return normalized;
}

function mutateExtractionPersonaState(mutator) {
  const operation = extractionPersonaStateMutation.then(async () => {
    const state = await readExtractionPersonaState();
    const outcome = await mutator(state);
    const nextState = outcome && outcome.state ? outcome.state : state;
    await writeExtractionPersonaState(nextState);
    return outcome && Object.prototype.hasOwnProperty.call(outcome, "result")
      ? outcome.result
      : nextState;
  });
  extractionPersonaStateMutation = operation.catch(() => {});
  return operation;
}

async function signExtractionPersonaValue(secret, value) {
  const secretBytes = base64UrlToBytes(secret);
  if (!secretBytes || secretBytes.length !== 32) throw new Error("extraction_persona_secret_invalid");
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(value || "")),
  );
  return new Uint8Array(signature);
}

function buildExtractionPersonaAliasFromDigest(digest) {
  const firstAlphabet = "abcdefghijklmnopqrstuvwxyz";
  const first = firstAlphabet[digest[0] % firstAlphabet.length];
  return `${first}${bytesToHex(digest.slice(1))}`.slice(0, EXTRACTION_PERSONA_ALIAS_LENGTH);
}

function pruneExtractionPersonaAliases(aliases) {
  const entries = Object.entries(aliases || {});
  if (entries.length <= EXTRACTION_PERSONA_MAX_ACCOUNT_ALIASES) return aliases;
  entries.sort((left, right) => {
    const leftAt = Date.parse(left[1] && left[1].lastUsedAt || "") || 0;
    const rightAt = Date.parse(right[1] && right[1].lastUsedAt || "") || 0;
    return rightAt - leftAt;
  });
  return Object.fromEntries(entries.slice(0, EXTRACTION_PERSONA_MAX_ACCOUNT_ALIASES));
}

async function resolveExtractionPersonaAlias(input) {
  const sourceKind = normalizeExtractionPersonaSourceKind(input && input.sourceKind);
  const accountId = normalizeExtractionPersonaAccountId(input && input.accountId);
  if (!sourceKind || !accountId) throw new Error("extraction_persona_account_identity_required");

  return mutateExtractionPersonaState(async (state) => {
    const seed = `${sourceKind}:${accountId}`;
    const locatorDigest = await signExtractionPersonaValue(
      state.installationSecret,
      `pincat-account-locator:v1:${seed}`,
    );
    const aliasDigest = await signExtractionPersonaValue(
      state.installationSecret,
      `pincat-extraction-persona:v1:${seed}`,
    );
    const locator = bytesToHex(locatorDigest).slice(0, 32);
    const derivedAlias = buildExtractionPersonaAliasFromDigest(aliasDigest);
    const current = state.aliases[locator] && typeof state.aliases[locator] === "object"
      ? state.aliases[locator]
      : {};
    const alias = SourceVaultCore.normalizeExtractionPersonaAlias(current.alias) || derivedAlias;
    const now = new Date().toISOString();
    state.aliases[locator] = {
      alias,
      sourceKind,
      createdAt: current.createdAt || now,
      lastUsedAt: now,
    };
    state.aliases = pruneExtractionPersonaAliases(state.aliases);
    return {
      state,
      result: { alias, sourceKind },
    };
  });
}

async function getExtractionPersonaCleanupVersion() {
  const state = await readExtractionPersonaState();
  return state.retrievedCleanupVersion;
}

async function markExtractionPersonaCleanupComplete() {
  return mutateExtractionPersonaState(async (state) => {
    state.retrievedCleanupVersion = EXTRACTION_PERSONA_CONTENT_CLEANUP_VERSION;
    return { state, result: state.retrievedCleanupVersion };
  });
}
