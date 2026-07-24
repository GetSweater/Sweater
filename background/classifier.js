// Sweater v2 — Hybrid Conversation Classifier
(function (global) {
  "use strict";

  const HEURISTIC_KEYWORDS = {
    Development: [
      /\b(react|vue|angular|svelte|next\.js|node|python|django|flask|golang|rust|typescript|javascript)\b/gi,
      /\b(npm|yarn|pip|cargo|git|docker|kubernetes|webpack|vite|prisma|database|sql|postgres|mongodb)\b/gi,
      /\b(error|bug|exception|stack trace|nullpointer|undefined|api|endpoint|json|rest api|graphql)\b/gi,
      /\b(class|function|const|let|import|export|return|compile|deploy|host|server|port)\b/gi,
      /\b(css|html|flexbox|grid|tailwind|styled-components|selector|div|span|button|input)\b/gi
    ],
    Research: [
      /\b(hypothesis|hypotheses|thesis|dissertation|paper|journal|publication|citation|references)\b/gi,
      /\b(experiment|empirical|qualitative|quantitative|variables|methodology|dataset|findings)\b/gi,
      /\b(statistics|regression|p-value|correlation|data analysis|survey|interview|literature review)\b/gi,
      /\b(study|research question|evidence|scientific|clinical trial|academic)\b/gi
    ],
    Writing: [
      /\b(draft|novel|chapter|storyline|plot|character|narrative|manuscript|protagonist)\b/gi,
      /\b(essay|article|blog post|copywriting|seo copy|newsletter|paragraph|outline)\b/gi,
      /\b(grammar|tone|metaphor|rhyme|poetry|verse|prose|phrasing|rephrase|rewrite)\b/gi,
      /\b(publish|editor|readability|proofread|formatting|style guide)\b/gi
    ],
    Business: [
      /\b(roadmap|product manager|agile|scrum|sprint|milestone|deliverables|stakeholder)\b/gi,
      /\b(marketing|seo campaign|conversion|analytics|roi|customer persona|value prop)\b/gi,
      /\b(pitch deck|business plan|startup|venture|funding|equity|revenue|financials|budget)\b/gi,
      /\b(competitor|market analysis|strategy|ops|sales funnel|b2b|b2c|saas)\b/gi
    ],
    Education: [
      /\b(learn|explain concept|tutorial|tutor|lesson|curriculum|syllabus|study guide)\b/gi,
      /\b(flashcards|quiz|test prep|exam|homework|vocabulary|definitions|explain like)\b/gi,
      /\b(translate|foreign language|conjugation|pronunciation|grammar exercise|linguistics)\b/gi,
      /\b(formula|derivation|theorem|proof|physics|chemistry|biology|history lesson)\b/gi
    ],
    Creative: [
      /\b(color palette|spacing|margin|padding|fonts|typography|ui|ux|figma|canvas|mockup)\b/gi,
      /\b(aspect ratio|midjourney|dall-e|stable diffusion|camera settings|lighting|artistic)\b/gi,
      /\b(moodboard|inspiration|sketch|illustration|render|wireframe|branding|logo|theme)\b/gi
    ]
  };

  const Classifier = {
    classify: async function (chatText) {
      if (!chatText || chatText.trim().length < 50) {
        return "General";
      }

      // 1. Run Local Heuristics
      const scores = {
        Development: 0,
        Research: 0,
        Writing: 0,
        Business: 0,
        Education: 0,
        Creative: 0
      };

      let totalScore = 0;
      Object.entries(HEURISTIC_KEYWORDS).forEach(([category, patterns]) => {
        patterns.forEach((pattern) => {
          const matches = chatText.match(pattern);
          if (matches) {
            scores[category] += matches.length;
            totalScore += matches.length;
          }
        });
      });

      // Find the highest score
      let highestCategory = "General";
      let highestScore = 0;
      Object.entries(scores).forEach(([category, score]) => {
        if (score > highestScore) {
          highestScore = score;
          highestCategory = category;
        }
      });

      // Calculate confidence (percentage of matches that point to the dominant category)
      const confidence = totalScore > 0 ? (highestScore / totalScore) : 0;
      console.log(`[Classifier] Local scores:`, scores, `Dominant: ${highestCategory} (Conf: ${(confidence*100).toFixed(0)}%)`);

      // If confidence > 80% and we have at least 3 keyword occurrences, resolve locally
      if (confidence >= 0.8 && highestScore >= 3) {
        console.log(`[Classifier] High confidence local match. Category: ${highestCategory}`);
        return highestCategory;
      }

      // 2. Call AI Fallback
      try {
        console.log(`[Classifier] Low confidence. Querying AI classifier...`);
        const aiResult = await global.AIEngine.execute(
          `${global.PromptRegistry.CLASSIFY_PROMPT}\n\nChat sample:\n${chatText.slice(0, 4000)}`,
          {
            maxTokens: 10,
            temperature: 0.1,
            systemPrompt: "You are a concise classifier. Answer with EXACTLY one word from the list provided."
          }
        );

        const cleanedResult = aiResult.trim().replace(/[^a-zA-Z]/g, "");
        const validCategories = ["Development", "Research", "Writing", "Business", "Education", "Creative", "General"];
        
        if (validCategories.includes(cleanedResult)) {
          console.log(`[Classifier] AI Classify success: ${cleanedResult}`);
          return cleanedResult;
        }

        // Check substring matches
        for (const cat of validCategories) {
          if (cleanedResult.toLowerCase().includes(cat.toLowerCase())) {
            console.log(`[Classifier] AI Classify substring match: ${cat}`);
            return cat;
          }
        }

        console.warn(`[Classifier] AI returned invalid category: ${cleanedResult}. Defaulting to General.`);
        return "General";
      } catch (err) {
        console.warn(`[Classifier] AI classifier query failed. Falling back to local highest score or General.`, err);
        return highestScore > 0 ? highestCategory : "General";
      }
    }
  };

  // Expose context
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Classifier;
  } else {
    global.Classifier = Classifier;
  }
})(typeof window !== "undefined" ? window : globalThis);
