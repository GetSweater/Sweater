// Sweater v14 — Telemetry Service (Local-only)
(function () {
  "use strict";

  const Telemetry = {
    /**
     * Record an autofill event.
     * @param {boolean} success
     */
    recordAutofill: async function (success) {
      try {
        const settings = await globalThis.SettingsService.loadSettings();
        if (!settings.telemetry) settings.telemetry = {};
        if (success) {
          settings.telemetry.autofillSuccessCount = (settings.telemetry.autofillSuccessCount || 0) + 1;
        } else {
          settings.telemetry.autofillFailureCount = (settings.telemetry.autofillFailureCount || 0) + 1;
        }
        await globalThis.SettingsService.saveSettings(settings);
      } catch (e) {
        console.error("[Telemetry] Failed to record autofill:", e);
      }
    },

    /**
     * Record API request latency.
     * @param {string} provider
     * @param {number} ms
     */
    recordLatency: async function (provider, ms) {
      try {
        const settings = await globalThis.SettingsService.loadSettings();
        if (!settings.telemetry) settings.telemetry = {};
        if (!Array.isArray(settings.telemetry.latencies)) settings.telemetry.latencies = [];
        
        settings.telemetry.latencies.push({
          provider,
          ms,
          timestamp: Date.now()
        });

        // Cap size to avoid storage bloat
        if (settings.telemetry.latencies.length > 50) {
          settings.telemetry.latencies.shift();
        }
        await globalThis.SettingsService.saveSettings(settings);
      } catch (e) {
        console.error("[Telemetry] Failed to record latency:", e);
      }
    },

    /**
     * Record context compression stats.
     * @param {string} format
     * @param {number} durationMs
     * @param {number} originalLen
     * @param {number} compressedLen
     */
    recordCompression: async function (format, durationMs, originalLen, compressedLen) {
      try {
        const settings = await globalThis.SettingsService.loadSettings();
        if (!settings.telemetry) settings.telemetry = {};
        if (!Array.isArray(settings.telemetry.compressionDurations)) settings.telemetry.compressionDurations = [];
        
        settings.telemetry.compressionDurations.push({
          format,
          durationMs,
          originalLen,
          compressedLen,
          timestamp: Date.now()
        });

        if (settings.telemetry.compressionDurations.length > 50) {
          settings.telemetry.compressionDurations.shift();
        }
        await globalThis.SettingsService.saveSettings(settings);
      } catch (e) {
        console.error("[Telemetry] Failed to record compression:", e);
      }
    }
  };

  globalThis.Telemetry = Telemetry;
})();
