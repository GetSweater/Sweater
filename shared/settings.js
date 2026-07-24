// Sweater v2 — Settings Service
(function (global) {
  "use strict";

  const DEFAULT_PROVIDERS = [
    { id: "prov_gemini", provider: "gemini", model: "gemini-3.5-flash", apiKey: "", label: "My Gemini", enabled: true },
    { id: "prov_groq", provider: "groq", model: "openai/gpt-oss-120b", apiKey: "", label: "Groq Fast", enabled: true },
    { id: "prov_openai", provider: "openai", model: "gpt-4o-mini", apiKey: "", label: "OpenAI Mini", enabled: true },
    { id: "prov_anthropic", provider: "anthropic", model: "claude-sonnet-4-6", apiKey: "", label: "Claude Sonnet", enabled: true },
    { id: "prov_deepseek", provider: "deepseek", model: "deepseek-v4-flash", apiKey: "", label: "DeepSeek Flash", enabled: true },
    { id: "prov_openrouter", provider: "openrouter", model: "openrouter/free", apiKey: "", label: "OpenRouter Free", enabled: true }
  ];

  // Deprecated / retired model IDs → current equivalents (verified against provider docs, Jul 2026)
  const MODEL_MIGRATIONS = {
    "gemini-1.5-flash": "gemini-3.5-flash",
    "gemini-1.5-pro": "gemini-3.5-flash",
    "gemini-2.0-flash": "gemini-3.5-flash",
    "mixtral-8x7b-32768": "llama-3.3-70b-versatile",
    "o1-mini": "gpt-5.6-luna",
    "claude-3-5-sonnet-latest": "claude-sonnet-4-6",
    "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
    "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-pro",
    "google/gemini-2.0-flash-exp:free": "openrouter/free",
    "google/gemini-2.5-flash": "openrouter/free",
    "deepseek/deepseek-chat:free": "openrouter/free",
    // Groq deprecated these June 17, 2026 (see console.groq.com/docs/deprecations).
    "qwen/qwen3-32b": "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
    "llama-3.1-8b-instant": "openai/gpt-oss-20b",
    "meta-llama/llama-4-scout-17b-16e-instruct": "openai/gpt-oss-120b",
    "meta-llama/llama-4-maverick-17b-128e-instruct": "openai/gpt-oss-120b",
    // Cerebras deprecated llama-3.3-70b and qwen-3-32b Feb 16, 2026; Cerebras itself
    // was removed as a Try Models provider July 2026 (see CHANGES.md), so any lingering
    // saved model id just gets normalized in case a slot still references it.
    "llama-3.3-70b": "openai/gpt-oss-120b",
    "qwen-3-235b-a22b-instruct-2507": "openai/gpt-oss-120b",
    "qwen-3-32b": "openai/gpt-oss-120b"
  };

  function migrate(oldSettings) {
    const providers = Array.isArray(oldSettings.providers)
      ? oldSettings.providers
      : DEFAULT_PROVIDERS.map(p => ({ ...p }));

    // Detect old-style active provider and set activeProviderId
    let activeProviderId = oldSettings.activeProviderId;
    if (!activeProviderId && oldSettings.provider) {
      const match = providers.find(p => p.provider === oldSettings.provider);
      if (match) activeProviderId = match.id;
    }
    if (!activeProviderId) {
      activeProviderId = "prov_groq";
    }
    if (activeProviderId === "prov_gemini") {
      activeProviderId = "prov_groq";
    }

    // Migrate old flat apiKey if applicable
    if (oldSettings.apiKey) {
      const activeSlot = providers.find(p => p.id === activeProviderId);
      if (activeSlot && !activeSlot.apiKey) {
        activeSlot.apiKey = oldSettings.apiKey;
      }
    }

    // Ensure all 6 reference providers exist in settings
    DEFAULT_PROVIDERS.forEach(defProv => {
      const exists = providers.some(p => p.provider === defProv.provider);
      if (!exists) {
        providers.push({ ...defProv });
      }
    });

    // Migrate retired / renamed model IDs to current provider docs
    providers.forEach(p => {
      if (p.model && MODEL_MIGRATIONS[p.model]) {
        p.model = MODEL_MIGRATIONS[p.model];
      }
      // Keep labels in sync with migrated defaults for known provider ids
      const def = DEFAULT_PROVIDERS.find(d => d.id === p.id);
      if (def && (!p.label || p.label === "OpenAI Mini" || p.label === "DeepSeek Chat" || p.label === "OpenRouter Flash")) {
        if (p.id === def.id && p.model === def.model) p.label = def.label;
      }
    });

    const tryModelSlots = Array.isArray(oldSettings.tryModelSlots)
      ? (globalThis.TryModelsRegistry
        ? globalThis.TryModelsRegistry.normalizeSlots(oldSettings.tryModelSlots)
        : oldSettings.tryModelSlots)
      : (globalThis.TryModelsRegistry
        ? globalThis.TryModelsRegistry.defaultSlots()
        : [{ provider: "", model: "", apiKey: "" }, { provider: "", model: "", apiKey: "" }, { provider: "", model: "", apiKey: "" }]);

    // Migrate try-model slot model IDs too
    tryModelSlots.forEach(slot => {
      if (slot.model && MODEL_MIGRATIONS[slot.model]) {
        slot.model = MODEL_MIGRATIONS[slot.model];
      }
    });

    // Cerebras was removed as a Try Models provider (July 2026 audit — see CHANGES.md):
    // its free tier now requires a verified payment method for an expiring $5 credit,
    // and its previously-used models here were already deprecated. Clear any slot that
    // still points at it so users aren't left with a dead, unselectable configuration
    // holding an unused stored key.
    tryModelSlots.forEach(slot => {
      if (slot.provider === "cerebras") {
        slot.provider = "";
        slot.model = "";
        slot.apiKey = "";
      }
    });

    const defaultLangVal = oldSettings.defaultLang || oldSettings.overrideLanguage || "";

    return {
      providers,
      activeProviderId,
      tryModelSlots,
      smartNaming: oldSettings.smartNaming !== false,
      language: oldSettings.language || "system",
      defaultLang: defaultLangVal,
      overrideLanguage: defaultLangVal,
      features: Object.assign({
        miniSweater: true,
        deepResearch: false,
        experimentalCompression: false,
        visionSupport: true
      }, oldSettings.features || {}),
      queueConcurrency: typeof oldSettings.queueConcurrency === "number" ? oldSettings.queueConcurrency : 2,
      telemetry: Object.assign({
        autofillSuccessCount: 0,
        autofillFailureCount: 0,
        latencies: [],
        compressionDurations: []
      }, oldSettings.telemetry || {})
    };
  }

  const SettingsService = {
    /**
     * Load settings from storage with automatic migration.
     * @returns {Promise<object>}
     */
    loadSettings: async function () {
      const res = await globalThis.StorageService.get("sweater_settings");
      const rawSettings = res.sweater_settings || {};
      const migrated = migrate(rawSettings);

      // Save migrated settings back to storage to keep it clean
      await globalThis.StorageService.set({ sweater_settings: migrated });
      return migrated;
    },

    /**
     * Save settings to storage.
     * @param {object} settings
     * @returns {Promise<void>}
     */
    saveSettings: async function (settings) {
      const oldRes = await globalThis.StorageService.get("sweater_settings");
      const oldSettings = oldRes.sweater_settings || {};

      const newSettings = migrate(settings);
      await globalThis.StorageService.set({ sweater_settings: newSettings });

      if (oldSettings.activeProviderId !== newSettings.activeProviderId) {
        if (globalThis.EventBus) {
          // Trigger both reference and workspace format if event names differ
          if (typeof globalThis.EventBus.emit === "function") {
            globalThis.EventBus.emit("providerChanged", newSettings.activeProviderId);
          }
          if (typeof globalThis.EventBus.publish === "function") {
            globalThis.EventBus.publish("settingsChanged", newSettings);
          }
        }
      }
    },

    /**
     * Find a provider configuration by its id.
     * @param {object} settings
     * @param {string} id
     * @returns {object|null}
     */
    getProvider: function (settings, id) {
      if (!settings || !Array.isArray(settings.providers)) return null;
      return settings.providers.find(p => p.id === id) || null;
    },

    /**
     * Get the currently active provider configuration.
     * @param {object} settings
     * @returns {object|null}
     */
    getActiveProvider: function (settings) {
      if (!settings) return null;
      return this.getProvider(settings, settings.activeProviderId);
    },

    /**
     * Get the current active language code.
     * @param {object} settings
     * @returns {string}
     */
    getLanguageCode: function (settings) {
      if (settings.language === "system") {
        return navigator.language || "en";
      }
      return settings.defaultLang || settings.overrideLanguage || "en";
    }
  };

  // Expose to correct context
  if (typeof module !== "undefined" && module.exports) {
    module.exports = SettingsService;
  } else {
    global.SettingsService = SettingsService;
  }
})(typeof window !== "undefined" ? window : globalThis);
