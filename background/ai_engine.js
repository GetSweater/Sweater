// Sweater v2 — AI Request Supervisor Engine
(function (global) {
  "use strict";

  const AIEngine = {
    execute: async function (prompt, options = {}) {
      const {
        systemPrompt = null,
        maxTokens = 1000,
        temperature = 0.7,
        customProviderId = null,
        useFallbackChain = false
      } = options;

      const settings = await global.SettingsService.loadSettings();
      const chain = this._buildProviderChain(settings, customProviderId, useFallbackChain);

      if (chain.length === 0) {
        throw new Error("No active API provider or key configured. Go to Settings and configure an API provider.");
      }

      let lastError = null;
      let failedProvider = null;

      for (let i = 0; i < chain.length; i++) {
        const activeProvider = chain[i];
        if (!activeProvider || !activeProvider.provider) continue;

        const needsKey = activeProvider.provider !== "ollama" && activeProvider.provider !== "lmstudio";
        if (needsKey && !activeProvider.apiKey) {
          if (customProviderId) {
            lastError = new Error(`No API key configured for ${activeProvider.provider}.`);
            lastError.status = 401;
            failedProvider = activeProvider;
            break;
          }
          continue;
        }

        try {
          console.log(`[AIEngine] Executing request using ${activeProvider.provider} (${activeProvider.model || "default"})`);
          return await this._executeOnce(prompt, { systemPrompt, maxTokens, temperature }, activeProvider);
        } catch (err) {
          lastError = err;
          failedProvider = activeProvider;
          if (customProviderId) break;
          if (i < chain.length - 1 && useFallbackChain) {
            console.warn(`[AIEngine] Provider ${activeProvider.provider} failed, trying next fallback...`, err.message);
            continue;
          }
          break;
        }
      }

      const providerForDiag = failedProvider?.provider
        || lastError?.provider
        || "unknown";
      const diagnostic = global.Diagnostics.diagnose(providerForDiag, lastError);
      const enrichedError = new Error(diagnostic.message);
      enrichedError.diagnostic = diagnostic;
      enrichedError.originalError = lastError;
      throw enrichedError;
    },

    _buildProviderChain: function (settings, customProviderId, useFallbackChain) {
      const chain = [];

      if (customProviderId) {
        if (customProviderId.startsWith("try_slot_")) {
          const idx = parseInt(customProviderId.replace("try_slot_", ""), 10);
          const slots = global.TryModelsRegistry
            ? global.TryModelsRegistry.normalizeSlots(settings.tryModelSlots)
            : [];
          const slot = slots[idx];
          if (slot && slot.provider && slot.model) {
            const isLocal = slot.provider === "ollama" || slot.provider === "lmstudio";
            chain.push({
              id: customProviderId,
              provider: slot.provider,
              model: slot.model,
              apiKey: isLocal ? (slot.apiKey || "local") : (slot.apiKey || "")
            });
          }
          return chain;
        }

        const slot = settings.providers.find(p => p.id === customProviderId);
        if (slot) chain.push(slot);
        return chain;
      }

      const primary = settings.providers.find(p => p.id === settings.activeProviderId);
      if (primary && primary.provider !== "gemini") chain.push(primary);

      if (useFallbackChain && global.TryModelsRegistry) {
        global.TryModelsRegistry.normalizeSlots(settings.tryModelSlots).forEach((slot, idx) => {
          if (!slot.provider || !slot.model) return;
          const isLocal = slot.provider === "ollama" || slot.provider === "lmstudio";
          if (!isLocal && !slot.apiKey) return;
          chain.push({
            id: `try_slot_${idx}`,
            provider: slot.provider,
            model: slot.model,
            apiKey: isLocal ? (slot.apiKey || "local") : slot.apiKey
          });
        });
      }

      return chain;
    },

    _executeOnce: async function (prompt, options, activeProvider) {
      const { systemPrompt, maxTokens, temperature } = options;
      const adapter = global.ProviderFactory.create(
        activeProvider.provider,
        activeProvider.apiKey,
        activeProvider.model
      );

      let retries = 2;
      let delay = 1000;
      let lastError = null;

      while (retries >= 0) {
        try {
          return await adapter.call(prompt, maxTokens, systemPrompt, temperature);
        } catch (err) {
          lastError = err;
          const isTransient = err.status === 429 || (err.status >= 500 && err.status < 600);
          if (isTransient && retries > 0) {
            console.warn(`[AIEngine] Request failed with status ${err.status}. Retrying in ${delay}ms... (${retries} left)`);
            await this._sleep(delay);
            delay *= 2;
            retries--;
          } else {
            break;
          }
        }
      }

      throw lastError;
    },

    _sleep: function (ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AIEngine;
  } else {
    global.AIEngine = AIEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
