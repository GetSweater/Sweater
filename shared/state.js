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
    // 1. Evaluate Context Quality Score (10-Section Work Handoff Heuristics)
    evaluateQuality: function (stateText) {
      if (!stateText) {
        return {
          score: 0,
          missing: ["Objective", "Problems", "Constraints", "Relevant Code/Files", "Next Action"]
        };
      }

      let score = 0;
      const missing = [];
      const lines = stateText.split("\n");

      const matchesKey = (pattern) => {
        return lines.some(line => {
          const trimmed = line.trim();
          const cleanLine = trimmed.replace(/^#+\s*/, "");
          return pattern.test(cleanLine) && (trimmed.includes(":") || trimmed.startsWith("#") || trimmed.startsWith("-") || cleanLine.toUpperCase() === cleanLine);
        });
      };

      // Objective (15%)
      if (matchesKey(/^(objective|goal|trying to|motive|aim)/i) || /objective:/i.test(stateText) || /goal:/i.test(stateText) || /^OBJECTIVE/m.test(stateText)) {
        score += 15;
      } else {
        missing.push("Objective");
      }

      // Current State (10%)
      if (matchesKey(/^(current_state|current state|stack|working state)/i) || /current_state:/i.test(stateText) || /^CURRENT STATE/m.test(stateText)) {
        score += 10;
      } else {
        missing.push("Current State");
      }

      // Problems & Errors (15%)
      if (matchesKey(/^(problems|problem|bugs|errors|stack trace|failing)/i) || /problems:/i.test(stateText) || /^PROBLEMS/m.test(stateText)) {
        score += 15;
      } else {
        missing.push("Problems & Errors");
      }

      // Decisions (10%)
      if (matchesKey(/^(decisions|decision|agreed|confirmed)/i) || /decisions:/i.test(stateText) || /^DECISIONS/m.test(stateText)) {
        score += 10;
      } else {
        missing.push("Decisions");
      }

      // Constraints (10%)
      if (matchesKey(/^(constraints|constraint|facts|requirement|limit)/i) || /constraints:/i.test(stateText) || /facts:/i.test(stateText) || /^CONSTRAINTS/m.test(stateText)) {
        score += 10;
      } else {
        missing.push("Constraints");
      }

      // Attempts (10%)
      if (matchesKey(/^(attempts|attempted|tried|results)/i) || /attempts:/i.test(stateText) || /^ATTEMPTS/m.test(stateText)) {
        score += 10;
      } else {
        missing.push("Attempts");
      }

      // Relevant Code & Files (10%)
      if (matchesKey(/^(relevant_code|relevant code|files|code|snippets|logs|functions)/i) || /relevant_code:/i.test(stateText) || /^RELEVANT CODE/m.test(stateText)) {
        score += 10;
      } else {
        missing.push("Relevant Code & Files");
      }

      // Attachments (5%)
      if (matchesKey(/^(attachments|attached|documents|pdfs|files)/i) || /attachments:/i.test(stateText) || /^ATTACHMENTS/m.test(stateText)) {
        score += 5;
      } else {
        missing.push("Attachments");
      }

      // Open Issues (5%)
      if (matchesKey(/^(open_issues|open issues|pending|todo|remaining)/i) || /open_issues:/i.test(stateText) || /pending:/i.test(stateText) || /^OPEN ISSUES/m.test(stateText)) {
        score += 5;
      } else {
        missing.push("Open Issues");
      }

      // Next Action (10%)
      if (matchesKey(/^(next_action|next action|next_task|next step)/i) || /next_action:/i.test(stateText) || /next_task:/i.test(stateText) || /^NEXT ACTION/m.test(stateText)) {
        score += 10;
      } else {
        missing.push("Next Action");
      }

      return {
        score: Math.min(100, score),
        missing
      };
    },

    // 2. Compute Completeness Percentage and Missing Items
    computeQualityScore: function (stateObj, category = "Development") {
      return this.evaluateQuality(typeof stateObj === "string" ? stateObj : JSON.stringify(stateObj));
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
          currentKey = match[1].trim().toLowerCase().replace(/\s+/g, "_");
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

    // Compiles a state block into a rich markdown transfer prompt following the 10-section handoff model
    compileStatePrompt: function (stateObj, platform, category) {
      const parts = [];
      parts.push(`# 🧶 Sweater — Context Intelligence Handoff (${category || "General"})`);
      parts.push(`Transferred from **${platform || "AI Conversation"}** · Prepared for Work Continuation\n\n---`);

      const cleanItem = item => {
        if (typeof item !== "string") return String(item || "");
        let str = item.trim();
        if (str.startsWith('"') && str.endsWith('"') && str.length > 2) {
          str = str.slice(1, -1).replace(/\\"/g, '"');
        }
        return str;
      };

      const appendSection = (title, label, value) => {
        if (!value) return;
        if (Array.isArray(value) && value.length === 0) return;
        parts.push(`### ${title}`);
        if (Array.isArray(value)) {
          parts.push(value.map(item => `- ${cleanItem(item)}`).join("\n"));
        } else if (typeof value === "string" && value.trim()) {
          parts.push(value.trim());
        }
      };

      if (stateObj.underlying_objective || stateObj.immediate_request) {
        parts.push(`### OBJECTIVE`);
        if (stateObj.underlying_objective) parts.push(`**Underlying Goal:** ${cleanItem(stateObj.underlying_objective)}`);
        if (stateObj.immediate_request) parts.push(`**Immediate Request:** ${cleanItem(stateObj.immediate_request)}`);
      } else {
        appendSection("OBJECTIVE", "Objective", stateObj.objective || stateObj.goal);
      }

      appendSection("CURRENT STATE", "Current State", stateObj.current_state || stateObj.stack);
      appendSection("PROBLEMS", "Problems & Errors", stateObj.problems);
      appendSection("DECISIONS", "Decisions Made", stateObj.decisions);
      appendSection("CONSTRAINTS", "Constraints & Instructions", stateObj.constraints || stateObj.facts);
      appendSection("ATTEMPTS", "Previous Attempts & Results", stateObj.attempts);

      // Work Assets & Work Materials
      if (Array.isArray(stateObj.work_assets) && stateObj.work_assets.length > 0) {
        parts.push(`### WORK ASSETS & MATERIALS`);
        const assetBlocks = stateObj.work_assets.map(asset => {
          const name = asset.name || "Asset";
          const type = asset.type || "file";
          const status = asset.extractionStatus || asset.status || "preserved";
          const rel = asset.relationship || "reference_for_current_task";
          const purp = asset.purpose || "source_material";
          const src = asset.source || asset.originalData || "";
          let block = `**[${type.toUpperCase()}] ${name}**\n- Relationship: ${rel}\n- Purpose: ${purp}\n- Status: ${status}`;
          if (src && typeof src === "string" && src.length > 3) {
            block += `\n- Reference/Source: ${src.slice(0, 300)}${src.length > 300 ? "..." : ""}`;
          }
          if (asset.content && typeof asset.content === "string" && asset.content.trim()) {
            block += `\n- Content/Details:\n${asset.content.slice(0, 4000)}`;
          }
          return block;
        });
        parts.push(assetBlocks.join("\n\n"));
      }

      appendSection("RELEVANT CODE / FILES", "Relevant Code & Technical Context", stateObj.relevant_code || stateObj.key_code);
      appendSection("ATTACHMENTS", "Attachments & Extracted Specs", stateObj.attachments);
      appendSection("OPEN ISSUES", "Open Issues & Pending Tasks", stateObj.open_issues || stateObj.pending);
      appendSection("NEXT ACTION", "Next AI Action", stateObj.next_action || stateObj.next_task);

      parts.push(`\n---\n\n## ▶ RECEIVING AI INSTRUCTIONS:\nYou now have the active project state context above. Resume work directly starting with **NEXT ACTION**. Do not modify database schemas, design assets, or constraints specified above.`);

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
