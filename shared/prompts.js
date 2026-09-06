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

    // 2. Smart Save Prompt — Work Context Handoff
    SMART_SAVE_PROMPT: `Analyze the AI conversation below. Understand the actual work, technical context, problems, attachments, work assets (images, documents, code, presentations, spreadsheets), decisions, and constraints. Format the active project state into this exact YAML structure. Omit empty sections if not applicable.

version: "2.0"
objective: (Main goal or motive the user is trying to accomplish)
current_state: (What is already working or established)
problems:
  - (Bugs, errors, stack traces, or unresolved issues)
decisions:
  - (Decisions, technology choices, or agreements finalized)
constraints:
  - (Hard rules, schema limits, architectural or user constraints)
attempts:
  - (Previous attempted fixes/solutions and their specific results)
relevant_code:
  - (Critical filenames, function names, code snippets, or log lines to preserve)
attachments:
  - (Relevant PDFs, documents, images, code files, or references contained in the conversation)
work_assets:
  - name: (Asset filename or title)
    type: (image | document | code | presentation | spreadsheet | archive | reference)
    purpose: (Extensible task-derived purpose, e.g. visual_reference, branding_asset, image-generation reference, source_document, implementation)
    relationship: (Extensible task relationship, e.g. visual_reference, source_document, input_to_edit, implementation_dependency)
    status: (extracted | durable_reference | session_only | preserved)
open_issues:
  - (Remaining open items or questions to solve)
next_action: (What the receiving AI must immediately continue doing)

Conversation:
{text}`,

    // 3. Category-Specific Compression Directives — Work Continuation Focus
    COMPRESSION_DIRECTIVES: {
      Development: `You are an Expert AI Systems Architect & Lead Engineer. Analyze this engineering session to enable seamless work handoff to the next AI.
Identify and preserve:
1. OBJECTIVE: Exact feature, bugfix, or architecture goal.
2. CURRENT STATE: Working code modules, setup, and established context.
3. PROBLEMS & ERRORS: Exact error logs, stack traces, failing functions/files (e.g. AuthController.java, GeminiAdapter.injectPrompt).
4. DECISIONS: Confirmed tech stack, libraries, design patterns, and agreed refactors.
5. CONSTRAINTS: DB schema restrictions, API limits, performance requirements, user instructions.
6. ATTEMPTS & RESULTS: Specific fixes tried so far and whether they passed or failed.
7. RELEVANT CODE / FILES: Exact code snippets, file paths, function signatures, and configs.
8. ATTACHMENTS: Document specs, attached file content, PDFs, images, code attachments.
9. OPEN ISSUES & NEXT ACTION: The exact next coding/debugging task for the receiving AI.
Do NOT blindly truncate code or remove technical context needed for continuation.`,

      Research: `You are a Principal Research Analyst. Analyze this research conversation for context handoff.
Identify and preserve:
1. OBJECTIVE: Core thesis, research topic, or analytical goal.
2. CURRENT STATE: Validated findings, established definitions, and scope.
3. PROBLEMS: Methodological issues, missing data, or analytical gaps.
4. DECISIONS: Methodology, sources selected, and key conclusions.
5. CONSTRAINTS: Research boundaries, source requirements, dates, or criteria.
6. ATTEMPTS: Hypotheses tested and analytical approaches evaluated.
7. RELEVANT CODE / FILES: Equations, data schemas, code scripts, URLs, citations.
8. ATTACHMENTS: Attached documents, papers, dataset files, PDFs, or charts.
9. OPEN ISSUES & NEXT ACTION: Next research question or section to compile.`,

      Writing: `You are an Executive Editor & Creative Consultant. Analyze this writing session for work continuation.
Identify and preserve:
1. OBJECTIVE: Writing project goal, audience, genre, or publication target.
2. CURRENT STATE: Sections/chapters written and current narrative state.
3. PROBLEMS: Plot holes, stylistic flaws, tone inconsistencies, or pacing issues.
4. DECISIONS: Agreed plot points, tone, style rules, and character traits.
5. CONSTRAINTS: Word counts, formatting guidelines, target audience limits.
6. ATTEMPTS: Draft variations attempted and feedback given.
7. RELEVANT CODE / FILES: Key text passages, outline docs, and key quotes.
8. ATTACHMENTS: Reference docs, style guides, images, or character notes attached.
9. OPEN ISSUES & NEXT ACTION: Next scene, chapter, or revision step.`,

      Business: `You are a Senior Product Manager & Business Strategist. Analyze this business session for execution handoff.
Identify and preserve:
1. OBJECTIVE: Strategic initiative, product feature, or business milestone.
2. CURRENT STATE: Approved plans, market positioning, current progress.
3. PROBLEMS: Operational bottlenecks, risks, budget/timeline blockers.
4. DECISIONS: Resource allocations, pricing, features approved, strategy consensus.
5. CONSTRAINTS: Compliance rules, budget, deadline, team bandwidth.
6. ATTEMPTS: Strategies or proposals considered and evaluated.
7. RELEVANT CODE / FILES: Data tables, spec documents, metrics, key formulas.
8. ATTACHMENTS: Slide decks, specs, PRDs, financial attachments.
9. OPEN ISSUES & NEXT ACTION: Immediate action items for next sprint/step.`,

      Education: `You are an Adaptive Learning Architect. Analyze this learning conversation for study continuation.
Identify and preserve:
1. OBJECTIVE: Subject, exam goal, or skill being mastered.
2. CURRENT STATE: Concepts mastered and correctly solved problems.
3. PROBLEMS: Misconceptions, failed exercises, or confused topics.
4. DECISIONS: Learning strategy and focus areas chosen.
5. CONSTRAINTS: Syllabus boundaries, time limits, format requirements.
6. ATTEMPTS: Practice problems attempted and error analysis.
7. RELEVANT CODE / FILES: Key formulas, code samples, reference cards.
8. ATTACHMENTS: Study guides, problem sets, textbook excerpts.
9. OPEN ISSUES & NEXT ACTION: Next topic, exercise, or review module.`,

      Creative: `You are a Creative Director. Analyze this design session for artistic continuation.
Identify and preserve:
1. OBJECTIVE: Visual/design project goal, brand identity, or UI design.
2. CURRENT STATE: Approved mockups, color systems, layout structures.
3. PROBLEMS: Design flaws, visual hierarchy issues, responsive bugs.
4. DECISIONS: Color palettes, typography, components, asset choices.
5. CONSTRAINTS: Brand guidelines, aspect ratios, target platform limits.
6. ATTEMPTS: Design iterations, prompt variations, and feedback.
7. RELEVANT CODE / FILES: CSS rules, UI component code, design tokens.
8. ATTACHMENTS: Mood boards, reference images, wireframes, vector assets.
9. OPEN ISSUES & NEXT ACTION: Next screen, component, or asset to generate.`,

      General: `You are an AI Continuity Specialist. Understand the conversation and extract a complete context handoff.
Identify and preserve:
1. OBJECTIVE: Primary user goal.
2. CURRENT STATE: Current progress and working state.
3. PROBLEMS: Unresolved questions or obstacles.
4. DECISIONS: Agreements and choices finalized.
5. CONSTRAINTS: Mandatory rules and boundaries.
6. ATTEMPTS: Previous attempts and results.
7. RELEVANT CODE / FILES: Key snippets, data, or file references.
8. ATTACHMENTS: Attached files, documents, or image references.
9. OPEN ISSUES & NEXT ACTION: Next action needed to continue seamlessly.`
    },

    getCompressionPrompt: function (category, chatText) {
      const directive = this.COMPRESSION_DIRECTIVES[category] || this.COMPRESSION_DIRECTIVES.General;
      return `${directive}

Produce a structured YAML work handoff state. Include these exact sections (omit only if completely empty):

version: "2.0"
objective: (What the user is trying to accomplish)
current_state: (What is currently working/established)
problems:
  - (Bugs, errors, stack traces, or broken behaviors)
decisions:
  - (Key choices or agreements made)
constraints:
  - (Hard rules, limits, DB schema rules, or constraints)
attempts:
  - (Previous attempted fixes/approaches and results)
relevant_code:
  - (Critical code snippets, filenames, functions, or logs)
attachments:
  - (Extracted specs, requirements, or data from attached files)
open_issues:
  - (Unresolved items or open questions)
next_action: (What the receiving AI must immediately continue doing)

Output ONLY the YAML structure with no commentary or preamble.

Conversation Context:
${chatText.slice(0, 16000)}`;
    }
  };

  const Prompts = {
    system: {
      default: "You are a helpful AI assistant. Be direct, concise, and accurate.",
      chat: "You are a helpful assistant. Answer questions about the AI conversation provided. Be concise and direct.",
      compressor: "You are an AI Work Handoff Specialist. Extract context, problem statements, code, constraints, attachments, and next actions in YAML format."
    },

    templates: {
      smartSave: function (rawText) {
        return `You are a Context Handoff Specialist. Analyze the AI conversation below and extract the complete project work state into a YAML handoff structure.

version: "2.0"
objective: (User's goal/motive — 1-2 clear sentences)
current_state: (Working code, setup, or narrative state)
problems:
  - (Bugs, errors, stack traces, or failing features)
decisions:
  - (Key decisions and technology choices made)
constraints:
  - (Confirmed constraints, DB schema limits, user rules)
attempts:
  - (What was tried and what happened)
relevant_code:
  - (Essential filenames, function names, snippets, or logs)
attachments:
  - (Extracted details from PDFs, images, docs, attached files)
open_issues:
  - (Unresolved problems or open questions)
next_action: (Specific task the receiving AI must execute next)

Rules:
- Output ONLY valid YAML, no explanations.
- Preserve technical context, code snippets, stack traces, and exact file names.
- Do NOT blindly shorten code or remove critical facts.

Conversation:
${rawText.slice(0, 16000)}`;
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
