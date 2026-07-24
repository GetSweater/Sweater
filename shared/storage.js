// Sweater v14 — Storage Service
(function () {
  "use strict";

  const StorageService = {
    /**
     * Retrieve keys from storage.
     * @param {string|string[]|object} keys
     * @returns {Promise<object>}
     */
    get: function (keys) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, (res) => {
          resolve(res || {});
        });
      });
    },

    /**
     * Store values in storage.
     * @param {object} items
     * @returns {Promise<void>}
     */
    set: function (items) {
      return new Promise((resolve) => {
        chrome.storage.local.set(items, () => {
          resolve();
        });
      });
    },

    /**
     * Remove keys from storage.
     * @param {string|string[]} keys
     * @returns {Promise<void>}
     */
    remove: function (keys) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(keys, () => {
          resolve();
        });
      });
    },

    /**
     * Clear all storage values.
     * @returns {Promise<void>}
     */
    clear: function () {
      return new Promise((resolve) => {
        chrome.storage.local.clear(() => {
          resolve();
        });
      });
    }
  };

  globalThis.StorageService = StorageService;
})();
