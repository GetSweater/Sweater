// Sweater v2 — Action Plugins Registry
(function (global) {
  "use strict";

  const MiniSweaterPlugins = [
    // ── CORE ACTIONS ──────────────────────────────────────────────────────────
    {
      id: "explain",
      name: "Explain",
      group: "Core",
      icon: "❓",
      prompt: "Provide a clear, detailed explanation of the text below, breaking down complex terminology or code logic:\n\n{text}"
    },
    {
      id: "summarize",
      name: "Summarize",
      group: "Core",
      icon: "📝",
      prompt: "Summarize this text in 3-5 concise bullet points. Emphasize the core takeaways:\n\n{text}"
    },
    {
      id: "smart-compress",
      name: "Smart Compress",
      group: "Core",
      icon: "⟁",
      prompt: "Act as a high-density information compressor. Extract all actionable items, key facts, decisions, and goals from this context. Output in a dense markdown summary:\n\n{text}"
    },

    // ── WRITING ───────────────────────────────────────────────────────────────
    {
      id: "rewrite",
      name: "Rewrite",
      group: "Writing",
      icon: "✏️",
      prompt: "Rewrite the following text to improve clarity, flow, and elegance while preserving the original meaning:\n\n{text}"
    },
    {
      id: "grammar",
      name: "Fix Grammar",
      group: "Writing",
      icon: "🛡️",
      prompt: "Correct all spelling, grammar, punctuation, and structural issues in the text below. Return ONLY the corrected text, highlighting corrections if needed:\n\n{text}"
    },
    {
      id: "professional",
      name: "Professional Tone",
      group: "Writing",
      icon: "💼",
      prompt: "Rephrase this text to have a highly professional, polite, and executive business tone:\n\n{text}"
    },
    {
      id: "friendly",
      name: "Friendly Tone",
      group: "Writing",
      icon: "🤝",
      prompt: "Rephrase this text to have a warm, friendly, casual, and engaging tone:\n\n{text}"
    },
    {
      id: "expand",
      name: "Expand",
      group: "Writing",
      icon: "➕",
      prompt: "Elaborate on the topics in the text below. Add descriptive detail, explanations, and supporting context:\n\n{text}"
    },
    {
      id: "shorten",
      name: "Shorten",
      group: "Writing",
      icon: "➖",
      prompt: "Condense this text down to its bare essentials. Remove all fluff while retaining key messages:\n\n{text}"
    },
    {
      id: "continue-writing",
      name: "Continue Writing",
      group: "Writing",
      icon: "✍️",
      prompt: "Analyze the tone, style, and topic of this text, and write the next logical paragraph or section to continue the text seamlessly:\n\n{text}"
    },

    // ── CODE ──────────────────────────────────────────────────────────────────
    {
      id: "review-code",
      name: "Review Code",
      group: "Code",
      icon: "🔬",
      prompt: "Analyze this code block and perform a comprehensive review. Highlight performance considerations, code quality issues, and security vulnerabilities:\n\n{text}"
    },
    {
      id: "find-bugs",
      name: "Find Bugs",
      group: "Code",
      icon: "🐛",
      prompt: "Inspect this code for logical bugs, syntax errors, potential edge-case crashes, or memory leaks. Show corrected code blocks:\n\n{text}"
    },
    {
      id: "generate-code",
      name: "Generate Code",
      group: "Code",
      icon: "💻",
      prompt: "Generate clean, documented, and production-ready code based on this instruction/context:\n\n{text}"
    },
    {
      id: "simplify-code",
      name: "Simplify",
      group: "Code",
      icon: "🍃",
      prompt: "Refactor this code to make it more simple, readable, and elegant. Minimize nesting and redundant logic:\n\n{text}"
    },
    {
      id: "explain-like-i-am-5",
      name: "ELI5",
      group: "General",
      icon: "👶",
      prompt: "Explain this concept or code block in extremely simple terms, as if explaining to a 5-year-old child. Use analogies:\n\n{text}"
    },

    // ── STRUCTURE & CONVERSION ────────────────────────────────────────────────
    {
      id: "to-markdown",
      name: "Convert to MD",
      group: "Structure",
      icon: "Ⓜ️",
      prompt: "Convert this plain text or unstructured notes into beautiful, semantically correct GitHub-Flavored Markdown:\n\n{text}"
    },
    {
      id: "to-json",
      name: "Convert to JSON",
      group: "Structure",
      icon: "🖧",
      prompt: "Parse the data, variables, or list items below and format them as valid, structured JSON. Output ONLY valid JSON code:\n\n{text}"
    },
    {
      id: "create-table",
      name: "Create Table",
      group: "Structure",
      icon: "📊",
      prompt: "Organize the data in this text into a clean Markdown table structure:\n\n{text}"
    },
    {
      id: "diagram-desc",
      name: "Diagram Desc",
      group: "Structure",
      icon: "🎨",
      prompt: "Generate a detailed Mermaid.js flowchart or diagram code description representing the flow, architecture, or sequence described below:\n\n{text}"
    },

    // ── IDEAS & RESEARCH ──────────────────────────────────────────────────────
    {
      id: "brainstorm",
      name: "Brainstorm",
      group: "Ideas & Research",
      icon: "💡",
      prompt: "Generate 10 creative, diverse, and out-of-the-box ideas or suggestions based on this prompt:\n\n{text}"
    },
    {
      id: "deep-research",
      name: "Deep Research",
      group: "Ideas & Research",
      icon: "🔍",
      prompt: "Conduct a deep analysis of this topic. List key variables, historical background, competing viewpoints, and unanswered research questions:\n\n{text}"
    },
    {
      id: "action-items",
      name: "Action Items",
      group: "Ideas & Research",
      icon: "🎯",
      prompt: "Extract all specific action items, checklists, and tasks from this context:\n\n{text}"
    },
    {
      id: "fact-check",
      name: "Fact Check",
      group: "Ideas & Research",
      icon: "⚖️",
      prompt: "Evaluate the factual claims in this text. Identify potential inaccuracies, biases, assumptions, or logical fallacies:\n\n{text}"
    },
    {
      id: "critique",
      name: "Critique",
      group: "Ideas & Research",
      icon: "📢",
      prompt: "Provide an objective, constructive critique of this argument, essay, or concept. Highlight weak points and suggest improvements:\n\n{text}"
    },

    // ── COMMERCE & TEMPLATES ──────────────────────────────────────────────────
    {
      id: "email",
      name: "Generate Email",
      group: "Templates",
      icon: "✉️",
      prompt: "Draft a clean, professional, and well-structured email based on this outline/intent:\n\n{text}"
    },
    {
      id: "reply",
      name: "Generate Reply",
      group: "Templates",
      icon: "📬",
      prompt: "Draft a polite and helpful response to this message/email context:\n\n{text}"
    },
    {
      id: "presentation",
      name: "Slide Outline",
      group: "Templates",
      icon: "🖼️",
      prompt: "Generate a detailed, slide-by-slide presentation outline (slide title, key points, visual ideas) based on this content:\n\n{text}"
    },
    {
      id: "meeting-notes",
      name: "Meeting Notes",
      group: "Templates",
      icon: "🗒️",
      prompt: "Organize this unstructured transcript or notes into professional meeting notes (Attendees, Discussion Summary, Decisions, Action Items):\n\n{text}"
    },
    {
      id: "flashcards",
      name: "Generate Cards",
      group: "Templates",
      icon: "🎴",
      prompt: "Extract the core facts from this text and format them as Q&A flashcards for learning:\n\n{text}"
    }
  ];

  // Expose context
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MiniSweaterPlugins;
  } else {
    global.MiniSweaterPlugins = MiniSweaterPlugins;
  }
})(typeof window !== "undefined" ? window : globalThis);
