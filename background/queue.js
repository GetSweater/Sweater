// Sweater v2 — Background Job Queue (Unified)
(function (global) {
  "use strict";

  const JobQueue = {
    queue: [],
    runningCount: 0,
    concurrencyLimit: 2,

    setConcurrency: function (limit) {
      if (typeof limit === "number" && limit > 0) {
        this.concurrencyLimit = limit;
        this._process();
      }
    },

    add: function (taskFn, name = "AI Task") {
      return new Promise((resolve, reject) => {
        this.queue.push({ taskFn, resolve, reject, name });
        this._process();
      });
    },

    _process: async function () {
      if (this.runningCount >= this.concurrencyLimit || this.queue.length === 0) {
        return;
      }

      const job = this.queue.shift();
      this.runningCount++;
      console.log(`[JobQueue] Running: ${job.name}. Pending in queue: ${this.queue.length}`);

      try {
        const result = await job.taskFn();
        job.resolve(result);
      } catch (err) {
        console.error(`[JobQueue] Failed: ${job.name}`, err);
        job.reject(err);
      } finally {
        this.runningCount--;
        this._process();
      }
    }
  };

  // Sync concurrency from settings
  chrome.storage.local.get("sweater_settings", (res) => {
    const settings = res.sweater_settings || {};
    if (typeof settings.queueConcurrency === "number") {
      JobQueue.setConcurrency(settings.queueConcurrency);
    }
  });

  // Expose context
  if (typeof module !== "undefined" && module.exports) {
    module.exports = JobQueue;
  } else {
    global.JobQueue = JobQueue;
    global.Queue = JobQueue;
    globalThis.JobQueue = JobQueue;
    globalThis.Queue = JobQueue;
  }
})(typeof window !== "undefined" ? window : globalThis);
