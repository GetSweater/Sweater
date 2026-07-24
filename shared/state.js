// Sweater v2 — Unified State Engine & Quality Score
(function (global) {
  "use strict";

  const WEIGHTS = {
    Development: { Goal: 30, Stack: 20, Completed: 15, Pending: 15, Constraints: 10, NextTask: 10 },
    Writing: { Goal: 30, Plot: 30, Facts: 20, Completed: 10, Pending: 10 },
    Creative: { Goal: 30, Plot: 30, Facts: 20, Completed: 10, Pending: 10 },
    Research: { Goal: 30, Findings: 30, Constraints: 20, Pending: 20 },
    Education: { Goal: 30, Findings: 30, Constraints: 20, Pending: 20 },
    Legal: { Goal: 30, Facts: 40, Pending: 30 },
    Business: { Goal: 30, Facts: 40, Pending: 30 },
    General: { Goal: 40, Facts: 30, Pending: 30 }
  };

  const StateEngine = {
    // 1. Evaluate Context Quality Score (Workspace V2 Heuristics)
    evaluateQuality: function (stateText) {
      if (!stateText) {
        return {
          score: 0,
          missing: ["Goal", "Stack/Tools", "Constraints/Facts", "Completed Items", "Pending Items", "Next Task"]
        };
      }

      let score = 0;
      const missing = [];
      const lines = stateText.split("\n");

      // Match headings/YAML keys
      const matchesKey = (pattern) => {
        return lines.some(line => {
          const trimmed = line.trim();
          return pattern.test(trimmed) && (trimmed.includes(":") || trimmed.startsWith("##") || trimmed.startsWith("-"));
        });
      };

      // Goal: +30%
      if (matchesKey(/^(goal|objective|trying to|aim)/i) || /goal:/i.test(stateText)) {
        score += 30;
      } else {
        missing.push("Goal");
      }

      // Stack: +20%
      if (matchesKey(/^(stack|tech|framework|libraries)/i) || /stack:/i.test(stateText)) {
        score += 20;
      } else {
        missing.push("Stack/Tools");
      }

      // Facts/Constraints: +15%
      if (matchesKey(/^(facts|constraint|preference|requirement)/i) || /facts:/i.test(stateText) || /constraints:/i.test(stateText)) {
        score += 15;
      } else {
        missing.push("Constraints/Facts");
      }

      // Completed: +15%
      if (matchesKey(/^(completed|done|finished|implemented|resolved)/i) || /completed:/i.test(stateText)) {
        score += 15;
      } else {
        missing.push("Completed Items");
      }

      // Pending: +10%
      if (matchesKey(/^(pending|todo|to-do|remaining|open)/i) || /pending:/i.test(stateText)) {
        score += 10;
      } else {
        missing.push("Pending Items");
      }

      // Next Task: +10%
      if (matchesKey(/^(next_task|next task|next step)/i) || /next_task:/i.test(stateText) || /next task:/i.test(stateText)) {
        score += 10;
      } else {
        missing.push("Next Task");
      }

      return {
        score: score,
        missing: missing
      };
    },

    // 2. Compute Completeness Percentage and Missing Items (Reference V14 Category-Weighted)
    computeQualityScore: function (stateObj, category = "Development") {
      const parsed = typeof stateObj === "string" ? this.parseState(stateObj) : stateObj;
      const catWeights = WEIGHTS[category] || WEIGHTS.Development;
      
      let score = 0;
      const missing = [];

      for (const [field, weight] of Object.entries(catWeights)) {
        const key = field.toLowerCase();
        if (parsed[key] && parsed[key].length > 0) {
          score += weight;
        } else {
          missing.push(field);
        }
      }

      return {
        score: Math.min(100, score),
        missing
      };
    },

    // 3. Simple Regex-based YAML Parsers
    parseState: function (yamlText) {
      if (!yamlText) return {};
      const state = {};
      const lines = yamlText.split("\n");
      let currentKey = null;
      let currentValue = [];

      lines.forEach(line => {
        const match = line.match(/^([A-Za-z0-9_\-\s]+):\s*(.*)$/);
        if (match) {
          if (currentKey) {
            state[currentKey] = currentValue.join("\n").trim();
          }
          currentKey = match[1].trim().toLowerCase();
          const val = match[2].trim();
          currentValue = val ? [val] : [];
        } else if (line.startsWith("  - ") || line.startsWith("    - ")) {
          currentValue.push(line.replace(/^\s*-\s*/, ""));
        } else if (line.startsWith("  ") && currentKey) {
          currentValue.push(line.trim());
        }
      });
      if (currentKey) {
        state[currentKey] = currentValue.join("\n").trim();
      }
      return state;
    },

    parseYamlState: function (yamlText) {
      if (!yamlText) return {};
      const result = {};
      let currentKey = null;
      const lines = yamlText.split("\n");

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;

        // Check if top-level YAML key
        const keyMatch = line.match(/^([a-zA-Z_]+)\s*:/);
        if (keyMatch) {
          currentKey = keyMatch[1].toLowerCase();
          const restOfLine = line.slice(keyMatch[0].length).trim();
          if (restOfLine) {
            result[currentKey] = restOfLine;
          } else {
            result[currentKey] = [];
          }
        } else if (trimmed.startsWith("-") && currentKey && Array.isArray(result[currentKey])) {
          const itemVal = trimmed.slice(1).trim();
          if (itemVal) result[currentKey].push(itemVal);
        } else if (currentKey && !Array.isArray(result[currentKey])) {
          result[currentKey] += " " + trimmed;
        }
      });

      return result;
    },

    // Compiles a state block into a rich markdown transfer prompt (Workspace V2)
    compileStatePrompt: function (stateObj, platform, category) {
      const parts = [];
      parts.push(`# 🧶 Sweater — Transferred Context (${category || "General"})`);
      parts.push(`This project checkpoint was transferred from **${platform}**.\n\n---\n\n## Project State:`);

      const appendSection = (label, value) => {
        if (!value) return;
        if (Array.isArray(value) && value.length > 0) {
          parts.push(`### ${label}:\n` + value.map(item => `- ${item}`).join("\n"));
        } else if (typeof value === "string" && value.trim()) {
          parts.push(`### ${label}:\n${value.trim()}`);
        }
      };

      appendSection("Goal", stateObj.goal);
      appendSection("Stack & Technologies", stateObj.stack);
      appendSection("Facts & Constraints", stateObj.facts);
      appendSection("Completed Milestones", stateObj.completed);
      appendSection("Pending TODOs", stateObj.pending);
      appendSection("Recent Outputs", stateObj.outputs || stateObj.context);
      appendSection("Next Task", stateObj.next_task);

      parts.push(`\n---\n\n## Instructions:\nYou now have the complete project context state. Please:\n1. Acknowledge receipt of the context details.\n2. Resume work exactly from: "${stateObj.next_task || 'the next pending items'}"`);

      return parts.join("\n\n");
    },

    // 4. Manage Capsule Versioning (Unified Interface)
    addVersion: function (existingCapsule, arg2, stateText, format) {
      if (!existingCapsule) {
        return typeof arg2 === "object" ? arg2 : null;
      }

      let continuePrompt, state, compressFormat, newTitle, newMsgCount, newTags, isCompressed, newSummary;
      
      if (typeof arg2 === "object" && arg2 !== null) {
        // Reference signature: addVersion(existingCapsule, newCapsuleData)
        const newCapsuleData = arg2;
        continuePrompt = newCapsuleData.continuePrompt;
        state = newCapsuleData.state || null;
        compressFormat = newCapsuleData.compressFormat;
        newTitle = newCapsuleData.title;
        newMsgCount = newCapsuleData.messageCount;
        newTags = newCapsuleData.tags;
        isCompressed = newCapsuleData.compressed;
        newSummary = newCapsuleData.summary;
      } else {
        // Workspace signature: addVersion(existingCapsule, continuePrompt, stateText, format)
        continuePrompt = arg2;
        state = stateText || null;
        compressFormat = format || null;
        newTitle = existingCapsule.title;
        newMsgCount = existingCapsule.messageCount;
        newTags = existingCapsule.tags;
        isCompressed = existingCapsule.compressed;
        newSummary = existingCapsule.summary;
      }

      // Initialize versions array if it doesn't exist
      if (!Array.isArray(existingCapsule.versions)) {
        existingCapsule.versions = [
          {
            version: 1,
            timestamp: existingCapsule.createdAt || new Date().toISOString(),
            continuePrompt: existingCapsule.continuePrompt,
            state: existingCapsule.state || null,
            title: existingCapsule.title,
            compressFormat: existingCapsule.compressFormat || null,
            messageCount: existingCapsule.messageCount
          }
        ];
      }

      const nextVerNum = existingCapsule.versions.length + 1;
      const newVer = {
        version: nextVerNum,
        timestamp: new Date().toISOString(),
        continuePrompt: continuePrompt,
        state: state,
        title: newTitle,
        compressFormat: compressFormat,
        messageCount: newMsgCount
      };

      existingCapsule.versions.push(newVer);

      // Keep only last 10 versions to restrict local storage size
      if (existingCapsule.versions.length > 10) {
        existingCapsule.versions.shift();
      }

      // Update current main state
      existingCapsule.title = newTitle;
      existingCapsule.continuePrompt = continuePrompt;
      existingCapsule.state = state;
      existingCapsule.messageCount = newMsgCount;
      existingCapsule.contextLength = continuePrompt.length;
      if (newTags) existingCapsule.tags = newTags;
      if (isCompressed !== undefined) existingCapsule.compressed = isCompressed;
      if (compressFormat) existingCapsule.compressFormat = compressFormat;
      if (newSummary) existingCapsule.summary = newSummary;
      existingCapsule.updatedAt = new Date().toISOString();

      return existingCapsule;
    },

    // Get specific capsule version (Workspace V2)
    getVersion: function (capsule, versionNumber) {
      if (!capsule || !capsule.versions) return null;
      return capsule.versions.find(v => v.version === parseInt(versionNumber, 10)) || null;
    },

    // Restores main capsule properties to a specific historic version (Reference V14)
    restoreVersion: function (capsule, versionNum) {
      if (!capsule || !Array.isArray(capsule.versions)) return capsule;
      const match = capsule.versions.find(v => v.version === parseInt(versionNum, 10));
      if (!match) return capsule;

      capsule.continuePrompt = match.continuePrompt;
      capsule.state = match.state;
      capsule.title = match.title;
      capsule.messageCount = match.messageCount;
      capsule.contextLength = match.continuePrompt.length;
      return capsule;
    }
  };

  // Expose context
  if (typeof module !== "undefined" && module.exports) {
    module.exports = StateEngine;
  } else {
    global.StateEngine = StateEngine;
    globalThis.StateEngine = StateEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
