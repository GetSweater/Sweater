// Sweater v2 — Unified Prompt Registry
(function (global) {
  "use strict";

  const PromptRegistry = {
    // 1. Classification Prompt
    CLASSIFY_PROMPT: `Analyze the following AI chat messages and classify the conversation into one of the major categories below.
Select ONLY the single most accurate category name from this list:
- Development
- Research
- Writing
- Business
- Education
- Creative
- General

Output ONLY the category name itself (exactly as written above), with no preamble, no markdown, and no extra characters.`,

    // 2. Smart Save Prompt
    SMART_SAVE_PROMPT: `Analyze the AI conversation below and extract the active project state. Format it exactly in this YAML structure. Omit any empty sections.

goal: (What the user is building or trying to achieve - max 2 sentences)
stack:
  - (Technologies, packages, models, or design languages used)
facts:
  - (Important constraints, user preferences, API keys, file names, or environment setup)
completed:
  - (Done items, code changes made, decisions resolved, bugs fixed)
pending:
  - (Open questions, current issues, next steps, planned refactors)
context: (Brief context recap - max 1 sentence)
next_task: (The single next specific task or code block to write)

Conversation:
{text}`,

    // 3. Category-Specific Compression Directives
    COMPRESSION_DIRECTIVES: {
      Development: `You are a Senior Software Architect. Extract the active technical state of this conversation. Preserve:
1. Target architecture, libraries, framework versions, and code structure.
2. Complete file names, directories, and code references.
3. Specific bugs, stack traces, and errors encountered.
4. Active TODOs, pending features, and the next step.
Omit conversational filler, thank-yous, and duplicate iterations of the same code block.`,

      Research: `You are a Research Assistant. Extract the academic and factual state of this conversation. Preserve:
1. Main hypotheses, research questions, and theoretical assumptions.
2. Citations, references, URLs, data sources, and literature.
3. Core findings, arguments, statistics, and unresolved contradictions.
4. Active questions remaining.
Omit conversational filler, repeating definitions, and generic introductions.`,

      Writing: `You are a Professional Editor. Extract the narrative and stylistic state of this conversation. Preserve:
1. Core characters, setting, world-building rules, and plot timeline.
2. Theme, target tone, writing style guidelines, and stylistic instructions.
3. Summary of chapters written, revisions agreed upon, and next section to write.
Omit early rough drafts and conversational pleasantries.`,

      Business: `You are a Senior Product Manager. Extract the business planning state of this conversation. Preserve:
1. Business goals, customer personas, value propositions, and metrics.
2. Strategic decisions, project timeline, roadmaps, and milestones.
3. Resource constraints, budget parameters, risks, and assumptions.
4. Action items, assigned topics, and next sprint goals.
Omit generic brainstorming notes and conversational text.`,

      Education: `You are a Tutor. Extract the learning state of this conversation. Preserve:
1. Key concepts explained, formulas, definitions, and rules.
2. Mistakes made by the learner and key corrections.
3. Flashcards, summary bullet points, and self-test questions.
4. Upcoming topics and modules to study.
Omit casual chat, greetings, and lengthy explanations.`,

      Creative: `You are a Creative Director. Extract the design state of this conversation. Preserve:
1. Visual concepts, color palettes, spacing rules, font scales, and inspirations.
2. Image prompts, style references, camera settings, aspect ratios, and artistic direction.
3. Layout drafts, component blueprints, and design-language constraints.
Omit generic brainstorming chatter and filler.`,

      General: `You are a Productivity Assistant. Extract the general state of this conversation. Preserve:
1. Current objective and context.
2. Decisions made and agreements finalized.
3. Unfinished tasks and upcoming goals.
Omit generic greetings, pleasantries, and duplicate sentences.`
    },

    getCompressionPrompt: function (category, chatText) {
      const directive = this.COMPRESSION_DIRECTIVES[category] || this.COMPRESSION_DIRECTIVES.General;
      return `${directive}\n\nProduce a compact YAML-style project memory containing the extracted state. Output ONLY the YAML structure, no explanation.\n\nConversation:\n${chatText.slice(0, 12000)}`;
    }
  };

  const Prompts = {
    system: {
      default: "You are a helpful AI assistant. Be direct, concise, and accurate.",
      chat: "You are a helpful assistant. Answer questions about the AI conversation provided. Be concise and direct.",
      compressor: "You are a Smart Memory extractor. Extract project context in YAML format."
    },

    templates: {
      smartSave: function (rawText) {
        return `You are a Smart Memory extractor. Given the AI conversation below, produce a compact YAML-style project memory. Use ONLY these sections (omit empty ones):

version: "1.0"
goal: (what the user is building/solving — 1-2 sentences)
stack:
  - (tech/tools/services)
facts:
  - (any confirmed facts, preferences, constraints, user context)
completed:
  - (done items, implemented features, resolved issues)
pending:
  - (open tasks, unresolved questions, next steps)
decisions:
  - (key choices made)
constraints:
  - (hard requirements or limits)
context: (any other must-know info — 1-2 sentences max)

Rules:
- Output ONLY the YAML structure, no preamble or explanation
- Include ALL facts and decisions — do not truncate
- Maximum compression while preserving every data point

Conversation:
${rawText.slice(0, 12000)}`;
      },

      smartTitle: function (messageText) {
        return `Generate a concise, descriptive title (max 8 words) for this conversation. Return ONLY the title, nothing else.\n\nFirst message: "${messageText.slice(0, 300)}"`;
      },

      summary: function (context) {
        return `Summarize this AI conversation concisely in 3-5 bullet points. Focus on key topics, decisions, and outcomes.\n\nConversation:\n${context}`;
      },

      insights: function (context) {
        return `Analyze this AI conversation and extract:\n1. Key insights (2-3)\n2. Action items or next steps (if any)\n3. Main topics covered\n\nBe concise.\n\nConversation:\n${context}`;
      },

      translate: function (lang, context) {
        return `Translate this AI conversation to ${lang}. Preserve speaker labels (User/AI). Keep meaning accurate.\n\n${context}`;
      },

      classify: function (context) {
        return `Analyze the following conversation sample and classify it into exactly one of these primary categories: Development, Writing, Research, Business, Education, Creative, General.\n\nReturn ONLY the category name, nothing else.\n\nConversation:\n${context.slice(0, 3000)}`;
      }
    }
  };

  // Expose context
  global.PromptRegistry = PromptRegistry;
  global.Prompts = Prompts;
  globalThis.PromptRegistry = PromptRegistry;
  globalThis.Prompts = Prompts;
})(typeof window !== "undefined" ? window : globalThis);
