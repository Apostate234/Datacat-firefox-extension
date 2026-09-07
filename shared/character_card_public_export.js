(function initCharacterCardPublicExport(globalScope) {
  "use strict";

  const DATA_FIELDS = Object.freeze([
    "name",
    "description",
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
    "creator_notes",
    "system_prompt",
    "post_history_instructions",
    "alternate_greetings",
    "character_book",
    "tags",
    "creator",
    "character_version",
    "avatar",
  ]);

  const METADATA_FIELDS = Object.freeze([
    "version",
    "created",
    "modified",
    "tool",
    "raw_description_html",
    "source_url",
    "janitor_character_name",
    "janitor_character_chatname",
    "janitor_character_id",
    "janitor_creator_id",
    "janitor_creator_name",
    "janitor_is_nsfw",
    "janitor_is_public",
    "janitor_show_definitions",
    "janitor_allow_proxy",
    "saucepan_character_id",
    "saucepan_creator_id",
    "saucepan_creator_handle",
  ]);

  const DATACAT_PROVENANCE_FIELDS = Object.freeze([
    "source",
    "provider",
    "site",
    "provenanceVersion",
    "provenance_version",
    "datacatCharacterId",
    "datacat_character_id",
    "characterId",
    "character_id",
    "sourceKind",
    "source_kind",
    "characterUrl",
    "character_url",
    "retrievedAt",
    "retrieved_at",
  ]);

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function cloneValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function copyPresentFields(source, fields) {
    const root = asObject(source);
    const output = {};
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(root, field) || root[field] === undefined) continue;
      output[field] = cloneValue(root[field]);
    }
    return output;
  }

  function sanitizeExtensions(value) {
    const root = asObject(value);
    const output = {};
    for (const [namespace, payload] of Object.entries(root)) {
      if (namespace === "source_vault" || namespace === "sourceVault") continue;
      if (namespace !== "datacat") {
        output[namespace] = cloneValue(payload);
        continue;
      }
      const datacat = copyPresentFields(payload, DATACAT_PROVENANCE_FIELDS);
      if (Object.keys(datacat).length) output.datacat = { ...datacat, source: "datacat" };
    }
    return Object.keys(output).length ? output : null;
  }

  function projectPublicCharacterCard(card) {
    const parsed = typeof card === "string" ? JSON.parse(card) : card;
    const root = asObject(parsed);
    const sourceData = asObject(root.data);
    const data = {};
    for (const field of DATA_FIELDS) {
      const container = Object.prototype.hasOwnProperty.call(sourceData, field) ? sourceData : root;
      if (!Object.prototype.hasOwnProperty.call(container, field) || container[field] === undefined) continue;
      data[field] = cloneValue(container[field]);
    }
    const dataExtensions = sanitizeExtensions(sourceData.extensions || root.extensions);
    if (dataExtensions) data.extensions = dataExtensions;

    const metadata = copyPresentFields(root.metadata, METADATA_FIELDS);
    const metadataExtensions = sanitizeExtensions(asObject(root.metadata).extensions);
    if (metadataExtensions) metadata.extensions = metadataExtensions;

    const projected = {
      spec: String(root.spec || "chara_card_v2"),
      spec_version: String(root.spec_version || "2.0"),
      data,
    };
    if (Object.keys(metadata).length) projected.metadata = metadata;
    return projected;
  }

  const api = Object.freeze({
    DATA_FIELDS,
    DATACAT_PROVENANCE_FIELDS,
    METADATA_FIELDS,
    projectPublicCharacterCard,
  });

  if (globalScope) globalScope.CharacterCardPublicExport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
