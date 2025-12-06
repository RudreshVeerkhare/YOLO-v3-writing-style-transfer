// ============================================================
// Cost Estimator - Estimates pipeline cost before execution
// ============================================================
//
// DISCLAIMER: Cost estimates are approximations only. Actual costs may vary
// significantly based on:
//   - Actual tokenization (varies by content, language, special characters)
//   - Model response lengths (can vary based on content complexity)
//   - Number of critique iterations needed (may exit early if no issues found)
//   - API pricing changes (prices may change without notice)
//   - Prompt caching effectiveness (cached tokens are discounted 50%)
//
// Estimates are provided as a rough guide to help users make informed decisions.
// Always monitor your actual API usage in the OpenAI dashboard.
//
// ============================================================
// ESTIMATION METHODOLOGY
// ============================================================
//
// 1. TOKEN ESTIMATION
//    - Characters are converted to tokens using a ratio of ~0.3 tokens/char
//    - This is a rough average for English text with LaTeX markup
//    - Actual BPE tokenization can vary significantly (0.2-0.5 tokens/char)
//
// 2. STAGE-BY-STAGE CALCULATION
//    Each pipeline stage is estimated separately:
//
//    a) Semantic Analysis (gpt-5-mini)
//       - Input: system prompt (~800 tokens) + full paper content
//       - Output: ~30% of input (structured skeleton)
//
//    b) Research Questions (gpt-5-nano)  
//       - Input: system prompt (~400 tokens) + 50% of paper
//       - Output: ~20% of input (5-8 questions)
//
//    c) Research Answers (gpt-5-nano)
//       - Per question: ~300 token prompt + 200 token context
//       - Output: ~50% of input per question
//       - Number of questions: min(8, max(5, sections/2))
//
//    d) Web Search (gpt-5) - if enabled
//       - Input: ~1000 tokens
//       - Output: ~400 tokens
//       - Plus: $0.01 per web search call (typically 2-3 calls)
//
//    e) YOLO Rewrite (gpt-5-mini)
//       - Batched: ~3 sections per batch
//       - Each batch: system prompt (1200 tokens) + context (30% of paper) + sections
//       - Output: ~120% of section content (rewrites tend to be longer)
//
//    f) Figure Placement (gpt-5-nano) - if figures exist
//       - Input: ~400 tokens + 100 per figure + 50 per section
//       - Output: ~50 tokens per figure
//
//    g) Critique Loop (gpt-5.1 + gpt-5-mini)
//       - Per iteration:
//         * Critique: prompt + full rewritten content → ~15% output
//         * Patch: fixes for ~30% of sections (halving each iteration)
//       - May exit early if no major issues found
//
// 3. COST CALCULATION
//    - Uses pricing from MODEL_PRICING in usageTracker.ts
//    - Formula: (input_tokens / 1M) * input_price + (output_tokens / 1M) * output_price
//    - Does NOT account for prompt caching (actual cost may be lower)
//
// 4. VARIANCE BUFFER
//    - Final estimate shown as a range: estimate ± 20%
//    - Actual costs typically fall within this range
//
// ============================================================

import { MODEL_PRICING, WEB_SEARCH_COST_PER_CALL } from './usageTracker';
import type { StructuredPaper } from '../types';

/**
 * Estimated tokens per character (average for English text with LaTeX)
 * 
 * Derivation: GPT tokenizers typically produce:
 * - ~0.25 tokens/char for plain English prose
 * - ~0.35 tokens/char for technical text with symbols
 * - ~0.4+ tokens/char for heavily marked-up LaTeX
 * 
 * We use 0.3 as a balanced estimate for academic papers.
 */
const TOKENS_PER_CHAR = 0.3;

/**
 * Model assignments for each pipeline stage
 * These should match the actual models used in agents.ts
 */
const PIPELINE_MODELS = {
  semanticMap: 'gpt-5-mini',      // Needs good reasoning for structure
  researchQuestions: 'gpt-5-mini', // Upgraded from nano - needs capacity for large papers
  researchAnswers: 'gpt-5-mini',   // Upgraded from nano - needs capacity for detailed answers
  webSearch: 'gpt-5',              // Web search requires specific model
  rewrite: 'gpt-5-mini',           // Main rewriting - needs quality
  figurePlacement: 'gpt-5-nano',   // Simple mapping task
  critique: 'gpt-5.1',             // Needs strong reasoning for accuracy
  patch: 'gpt-5-mini',             // Needs quality for fixes
};

/**
 * Base prompt sizes (estimated tokens for system prompts)
 * These are rough estimates of the system prompt token counts
 */
const BASE_PROMPT_TOKENS = {
  semanticMap: 800,        // Semantic skeleton extraction prompt
  researchQuestions: 400,  // Question generation prompt
  researchAnswers: 300,    // Answer generation prompt
  webSearch: 500,          // Web search coordination prompt
  rewrite: 1200,           // Full YOLO style guide (~1100 tokens)
  figurePlacement: 400,    // Figure mapping prompt
  critique: 600,           // Accuracy review prompt
  patch: 500,              // Section patching prompt
};

/**
 * Estimated output multipliers (output tokens as ratio of input context)
 * 
 * These ratios represent typical output length relative to the
 * variable input content (not including system prompts).
 */
const OUTPUT_MULTIPLIERS = {
  semanticMap: 0.3,       // Skeleton is ~30% of paper length
  researchQuestions: 0.2, // Questions are compact
  researchAnswers: 0.5,   // Answers are moderately detailed
  webSearch: 0.4,         // Summaries of findings
  rewrite: 1.2,           // Rewrites tend to be longer (more explanation)
  figurePlacement: 0.1,   // Just figure IDs and positions
  critique: 0.15,         // Issue list is compact
  patch: 0.8,             // Patches are similar length to originals
};

export interface CostEstimate {
  // Breakdown by stage
  stages: {
    name: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    requests: number;
    cost: number;
  }[];
  
  // Totals
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  totalCost: number;
  
  // Paper stats
  paperStats: {
    title: string;
    sections: number;
    figures: number;
    totalChars: number;
    estimatedTokens: number;
  };
  
  // Time estimate (rough)
  estimatedMinutes: number;
}

/**
 * Calculate cost for a stage
 */
function calculateStageCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    console.warn(`Unknown model: ${model}, using gpt-4.1 rates`);
    return (inputTokens / 1_000_000) * 8 + (outputTokens / 1_000_000) * 32;
  }
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Estimate the total cost of processing a paper
 */
export function estimatePipelineCost(
  paper: StructuredPaper,
  options: {
    critiqueIterations: number;
    enableWebSearch: boolean;
  }
): CostEstimate {
  const stages: CostEstimate['stages'] = [];
  
  // Calculate paper size
  let totalChars = paper.abstract.length;
  for (const section of paper.sections) {
    // Sum up text blocks
    for (const textBlock of section.textBlocks) {
      totalChars += textBlock.length;
    }
    // Also count equations
    for (const equation of section.equations) {
      totalChars += equation.length;
    }
  }
  
  const paperTokens = Math.ceil(totalChars * TOKENS_PER_CHAR);
  const sectionCount = paper.sections.length;
  const figureCount = paper.figures.length;
  
  // 1. Semantic Map (one call with full paper context)
  {
    const inputTokens = BASE_PROMPT_TOKENS.semanticMap + paperTokens;
    const outputTokens = Math.ceil(inputTokens * OUTPUT_MULTIPLIERS.semanticMap);
    const cost = calculateStageCost(PIPELINE_MODELS.semanticMap, inputTokens, outputTokens);
    stages.push({
      name: 'Semantic Analysis',
      model: PIPELINE_MODELS.semanticMap,
      inputTokens,
      outputTokens,
      requests: 1,
      cost,
    });
  }
  
  // 2. Research Questions (one call)
  {
    const inputTokens = BASE_PROMPT_TOKENS.researchQuestions + Math.ceil(paperTokens * 0.5);
    const outputTokens = Math.ceil(inputTokens * OUTPUT_MULTIPLIERS.researchQuestions);
    const cost = calculateStageCost(PIPELINE_MODELS.researchQuestions, inputTokens, outputTokens);
    stages.push({
      name: 'Research Questions',
      model: PIPELINE_MODELS.researchQuestions,
      inputTokens,
      outputTokens,
      requests: 1,
      cost,
    });
  }
  
  // 3. Research Answers (estimated 5-8 questions)
  {
    const questionCount = Math.min(8, Math.max(5, Math.ceil(sectionCount / 2)));
    const inputPerQuestion = BASE_PROMPT_TOKENS.researchAnswers + 200;
    const outputPerQuestion = Math.ceil(inputPerQuestion * OUTPUT_MULTIPLIERS.researchAnswers);
    const inputTokens = inputPerQuestion * questionCount;
    const outputTokens = outputPerQuestion * questionCount;
    const cost = calculateStageCost(PIPELINE_MODELS.researchAnswers, inputTokens, outputTokens);
    stages.push({
      name: 'Research Answers',
      model: PIPELINE_MODELS.researchAnswers,
      inputTokens,
      outputTokens,
      requests: questionCount,
      cost,
    });
  }
  
  // 4. Web Search (if enabled)
  if (options.enableWebSearch) {
    const inputTokens = BASE_PROMPT_TOKENS.webSearch + 500;
    const outputTokens = Math.ceil(inputTokens * OUTPUT_MULTIPLIERS.webSearch);
    const webSearchCost = WEB_SEARCH_COST_PER_CALL * 3; // Usually 2-3 searches
    const llmCost = calculateStageCost(PIPELINE_MODELS.webSearch, inputTokens, outputTokens);
    stages.push({
      name: 'Web Research',
      model: PIPELINE_MODELS.webSearch,
      inputTokens,
      outputTokens,
      requests: 1,
      cost: llmCost + webSearchCost,
    });
  }
  
  // 5. YOLO Rewrite (batched, ~3-4 sections per batch)
  {
    const batchSize = 3;
    const batchCount = Math.ceil(sectionCount / batchSize);
    const tokensPerSection = Math.ceil(paperTokens / sectionCount);
    const contextTokens = Math.ceil(paperTokens * 0.3); // Skeleton + paper context
    
    let totalInput = 0;
    let totalOutput = 0;
    
    for (let i = 0; i < batchCount; i++) {
      const sectionsInBatch = Math.min(batchSize, sectionCount - i * batchSize);
      const batchInput = BASE_PROMPT_TOKENS.rewrite + contextTokens + (tokensPerSection * sectionsInBatch);
      const batchOutput = Math.ceil(tokensPerSection * sectionsInBatch * OUTPUT_MULTIPLIERS.rewrite);
      totalInput += batchInput;
      totalOutput += batchOutput;
    }
    
    const cost = calculateStageCost(PIPELINE_MODELS.rewrite, totalInput, totalOutput);
    stages.push({
      name: 'YOLO Rewrite',
      model: PIPELINE_MODELS.rewrite,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      requests: batchCount,
      cost,
    });
  }
  
  // 6. Figure Placement (if figures exist)
  if (figureCount > 0) {
    const inputTokens = BASE_PROMPT_TOKENS.figurePlacement + (figureCount * 100) + (sectionCount * 50);
    const outputTokens = Math.ceil(figureCount * 50);
    const cost = calculateStageCost(PIPELINE_MODELS.figurePlacement, inputTokens, outputTokens);
    stages.push({
      name: 'Figure Placement',
      model: PIPELINE_MODELS.figurePlacement,
      inputTokens,
      outputTokens,
      requests: 1,
      cost,
    });
  }
  
  // 7. Critique iterations
  if (options.critiqueIterations > 0) {
    const rewrittenTokens = Math.ceil(paperTokens * 1.2);
    
    for (let iter = 0; iter < options.critiqueIterations; iter++) {
      // Critique call
      const critiqueInput = BASE_PROMPT_TOKENS.critique + rewrittenTokens;
      const critiqueOutput = Math.ceil(critiqueInput * OUTPUT_MULTIPLIERS.critique);
      const critiqueCost = calculateStageCost(PIPELINE_MODELS.critique, critiqueInput, critiqueOutput);
      
      // Patch call (estimate 30% of sections need patching, decreasing each iteration)
      const patchRatio = 0.3 * Math.pow(0.5, iter);
      const sectionsToPath = Math.max(1, Math.ceil(sectionCount * patchRatio));
      const patchInput = BASE_PROMPT_TOKENS.patch + (Math.ceil(rewrittenTokens / sectionCount) * sectionsToPath);
      const patchOutput = Math.ceil(patchInput * OUTPUT_MULTIPLIERS.patch);
      const patchCost = calculateStageCost(PIPELINE_MODELS.patch, patchInput, patchOutput);
      
      stages.push({
        name: `Critique #${iter + 1}`,
        model: PIPELINE_MODELS.critique,
        inputTokens: critiqueInput,
        outputTokens: critiqueOutput,
        requests: 1,
        cost: critiqueCost,
      });
      
      stages.push({
        name: `Patch #${iter + 1}`,
        model: PIPELINE_MODELS.patch,
        inputTokens: patchInput,
        outputTokens: patchOutput,
        requests: 1,
        cost: patchCost,
      });
    }
  }
  
  // Calculate totals
  const totalInputTokens = stages.reduce((sum, s) => sum + s.inputTokens, 0);
  const totalOutputTokens = stages.reduce((sum, s) => sum + s.outputTokens, 0);
  const totalRequests = stages.reduce((sum, s) => sum + s.requests, 0);
  const totalCost = stages.reduce((sum, s) => sum + s.cost, 0);
  
  // Estimate time (rough: ~2-3 seconds per request on average)
  const estimatedMinutes = Math.ceil((totalRequests * 2.5) / 60);
  
  return {
    stages,
    totalInputTokens,
    totalOutputTokens,
    totalRequests,
    totalCost,
    paperStats: {
      title: paper.title,
      sections: sectionCount,
      figures: figureCount,
      totalChars,
      estimatedTokens: paperTokens,
    },
    estimatedMinutes,
  };
}

/**
 * Format cost estimate for display
 */
export function formatCostRange(estimate: CostEstimate): string {
  // Add 20% buffer for variance
  const low = estimate.totalCost * 0.8;
  const high = estimate.totalCost * 1.2;
  
  if (high < 0.10) {
    return `$${low.toFixed(3)} - $${high.toFixed(3)}`;
  }
  return `$${low.toFixed(2)} - $${high.toFixed(2)}`;
}
