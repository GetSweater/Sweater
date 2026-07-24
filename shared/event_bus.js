// Sweater v2 — Event Bus (with Compatibility Aliases)
(function (global) {
  "use strict";

  const EventBus = {
    _listeners: {},

    publish: function (event, data) {
      const message = { isEventBus: true, event: event, data: data };

      // 1. Broadcast inside runtime (popup, background scripts)
      chrome.runtime.sendMessage(message, () => {
        // Suppress "Unchecked runtime.lastError" in case there are no popup listeners
        const err = chrome.runtime.lastError;
      });

      // 2. Broadcast to tabs (content scripts)
      if (chrome.tabs) {
        chrome.tabs.query({}, (tabs) => {
          if (!tabs) return;
          tabs.forEach((tab) => {
            try {
              chrome.tabs.sendMessage(tab.id, message, () => {
                const err = chrome.runtime.lastError;
              });
            } catch (e) {
              // Ignore messaging errors for unsupported tabs
            }
          });
        });
      }

      // 3. Trigger local listeners in current process
      this._trigger(event, data);
    },

    subscribe: function (event, callback) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(callback);

      // Return unsubscribe handle
      return () => this.unsubscribe(event, callback);
    },

    unsubscribe: function (event, callback) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
    },

    _trigger: function (event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach((cb) => {
          try {
            cb(data);
          } catch (e) {
            console.error(`[EventBus] Callback error for event "${event}":`, e);
          }
        });
      }
    },

    _init: function () {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.isEventBus) {
          this._trigger(msg.event, msg.data);
        }
      });
    },

    // ── V14 COMPATIBILITY WRAPPERS ───────────────────────────────────────────
    on: function (channel, callback) {
      this.subscribe(channel, callback);
    },

    off: function (channel, callback) {
      this.unsubscribe(channel, callback);
    },

    emit: function (channel, data, broadcast = true) {
      // In this EventBus implementation, publish always broadcasts,
      // which is exactly what we want for cross-context events.
      this.publish(channel, data);
    }
  };

  EventBus._init();

  // Expose context
  if (typeof module !== "undefined" && module.exports) {
    module.exports = EventBus;
  } else {
    global.EventBus = EventBus;
  }
})(typeof window !== "undefined" ? window : globalThis);
