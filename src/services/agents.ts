// ============================================================
// Agent Service Functions
// Each function wraps an OpenAI call with specific prompts
// 
// MODEL SELECTION STRATEGY (GPT-5 family - better + cheaper):
// ============================================================
// Task Type              | Model         | Reasoning? | Why
// -----------------------|---------------|------------|---------------------------
// Semantic extraction    | gpt-5-mini    | No         | Needs substantial output (skeleton is large)
// Research questions     | gpt-5-nano    | No         | Structured output (4x cheaper)
// Research answers       | gpt-5-nano    | No         | Structured output (4x cheaper)
// Web Research           | gpt-5         | Yes        | Agentic search with reasoning
// YOLO Rewriting         | gpt-5-mini    | No         | Creative writing (4x cheaper than 4.1)
// Figure mapping         | gpt-5-nano    | No         | Simple matching task
// Critique               | gpt-5.1       | Yes        | Best reasoning for accuracy review
// Patch                  | gpt-5-nano    | No         | Targeted edits
// ============================================================
// 
// GPT-5 family is both smarter AND cheaper than GPT-4.1:
// - gpt-5-mini:  $2/$8 per 1M (vs gpt-4.1: $8/$32) = 4x cheaper
// - gpt-5-nano:  $0.40/$1.60 per 1M (vs gpt-4.1-mini: $1.60/$6.40) = 4x cheaper
// ============================================================

import OpenAI from 'openai';
import {
  chatCompletion,
  parseJSONResponse,
  webSearchCompletion,
} from './openaiClient';
import {
  SEMANTIC_MAP_AGENT_PROMPT,
  RESEARCH_QUESTIONS_AGENT_PROMPT,
  RESEARCH_ANSWER_AGENT_PROMPT,
  YOLO_REWRITER_AGENT_PROMPT,
  FIGURE_MAPPING_AGENT_PROMPT,
  CRITIQUE_AGENT_PROMPT,
  PATCH_AGENT_PROMPT,
} from './agentPrompts';
import type {
  StructuredPaper,
  StructuredSection,
  SemanticSkeleton,
  ResearchQuestion,
  ResearchNote,
  RewrittenSection,
  FigurePlacement,
  CritiqueIssue,
  ExternalResearch,
  SemanticMapAgentResponse,
  ResearchQuestionsAgentResponse,
  ResearchAnswerAgentResponse,
  YOLORewriterAgentResponse,
  FigureMappingAgentResponse,
  CritiqueAgentResponse,
  PatchAgentResponse,
} from '../types';

/**
 * Condense a StructuredPaper for LLM consumption
 * Only sends essential info, not full text blocks
 */
function condensePaperForLLM(paper: StructuredPaper): object {
  return {
    title: paper.title,
    authors: paper.authors,
    abstract: paper.abstract,
    sections: paper.sections.map(s => ({
      id: s.id,
      title: s.title,
      level: s.level,
      // Only first 2 text blocks per section (summary context)
      textSummary: s.textBlocks.slice(0, 2).join('\n').slice(0, 500),
      equationCount: s.equations.length,
      figureRefs: s.figures,
    })),
    figureCount: paper.figures.length,
    figures: paper.figures.map(f => ({
      id: f.id,
      caption: f.caption.slice(0, 200),
    })),
  };
}

/**
 * Semantic Map Agent - Extracts semantic skeleton
 * Model: gpt-5-mini (needs substantial output for complex papers)
 */
export async function callSemanticMapAgent(
  client: OpenAI,
  structured: StructuredPaper
): Promise<SemanticSkeleton> {
  // Send condensed version, not full paper
  const condensed = condensePaperForLLM(structured);
  
  const response = await chatCompletion(client, {
    model: 'gpt-5-mini',
    systemPrompt: SEMANTIC_MAP_AGENT_PROMPT,
    userContent: `Extract semantic skeleton from this paper:\n\n${JSON.stringify(condensed, null, 2)}`,
    maxTokens: 8000,
    temperature: 0.3,
    responseFormat: 'json',
  });
  
  return parseJSONResponse<SemanticMapAgentResponse>(response);
}

/**
 * Research Questions Agent - Identifies gaps
 * Model: gpt-5-nano (structured extraction, cheapest)
 * Includes retry logic
 */
export async function callResearchQuestionsAgent(
  client: OpenAI,
  structured: StructuredPaper,
  skeleton: SemanticSkeleton
): Promise<ResearchQuestion[]> {
  // Condensed input - only what's needed
  const input = {
    paper: condensePaperForLLM(structured),
    skeleton,
  };
  
  const maxRetries = 2;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Research questions attempt ${attempt + 1}...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
      
      const response = await chatCompletion(client, {
        model: 'gpt-5-mini', // Upgraded from nano - needs more capacity for larger papers
        systemPrompt: RESEARCH_QUESTIONS_AGENT_PROMPT,
        userContent: `Identify research gaps in this paper:\n\n${JSON.stringify(input, null, 2)}`,
        maxTokens: 4000,
        responseFormat: 'json',
      });
      
      const parsed = parseJSONResponse<ResearchQuestionsAgentResponse>(response);
      return parsed.questions;
    } catch (e) {
      console.warn(`Research questions attempt ${attempt + 1} failed:`, e);
      if (attempt === maxRetries) {
        // Return default questions to allow pipeline to continue
        console.error('Research questions agent failed, using defaults');
        return [
          {
            id: 'q1',
            question: 'What are the main computational bottlenecks of this approach?',
            whyImportant: 'Understanding performance limits helps readers apply the method.',
          },
          {
            id: 'q2',
            question: 'How does this method compare to state-of-the-art alternatives?',
            whyImportant: 'Readers need context to understand the contribution.',
          },
        ];
      }
    }
  }
  
  return [];
}

/**
 * Research Answer Agent - Answers questions with sources
 * Model: gpt-5-mini (upgraded from nano due to token limits)
 * Includes retry logic for robustness
 */
export async function callResearchAnswerAgent(
  client: OpenAI,
  question: ResearchQuestion,
  paperTitle: string
): Promise<ResearchNote> {
  const maxRetries = 2;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
      
      const response = await chatCompletion(client, {
        model: 'gpt-5-mini',
        systemPrompt: RESEARCH_ANSWER_AGENT_PROMPT,
        userContent: `Paper: "${paperTitle}"\n\nQuestion to answer:\n${JSON.stringify(question, null, 2)}`,
        maxTokens: 2000,
        responseFormat: 'json',
      });
      
      return parseJSONResponse<ResearchAnswerAgentResponse>(response);
    } catch (e) {
      console.warn(`Research answer attempt ${attempt + 1} failed:`, e);
      if (attempt === maxRetries) {
        // All retries failed - return a placeholder
        return {
          questionId: question.id,
          answer: `Unable to research this question. The analysis will proceed with available context.`,
          sources: [],
        };
      }
    }
  }
  
  // Fallback (should not reach here)
  return {
    questionId: question.id,
    answer: 'Research unavailable.',
    sources: [],
  };
}

/**
 * Web Research Agent - Searches the web for external context
 * Uses agentic web search (gpt-5 with reasoning) to find:
 * - Author backgrounds and expertise
 * - Community discussions and reactions
 * - Practical implementations and applications
 * 
 * This mirrors how ChatGPT's web browsing works - the model actively
 * searches, analyzes results, and may search again if needed.
 */
export async function callWebResearchAgent(
  client: OpenAI,
  paperTitle: string,
  authors: string[],
  abstract: string
): Promise<ExternalResearch> {
  console.log(`[WebResearch] Agentic search for: ${paperTitle}`);
  
  // Extract key terms from abstract for better search
  const keyTerms = abstract.split(' ')
    .filter(word => word.length > 6)
    .slice(0, 8)
    .join(' ');
  
  // Run searches in parallel for speed
  const [authorResult, discussionResult, applicationResult] = await Promise.all([
    // Search for author information with specific instructions
    webSearchCompletion(
      client, 
      `Find information about these researchers: ${authors.slice(0, 3).join(', ')}

I need SPECIFIC information:
- Their affiliations (university, company, lab)
- Their notable previous work or papers
- Any talks, interviews, or blog posts by them
- Their expertise areas and research focus
- Awards or recognition they've received

Do NOT give generic statements. Find concrete facts with sources.`,
      `Context: These authors wrote the paper "${paperTitle}"`
    ),
    
    // Search for discussions about the paper/topic
    webSearchCompletion(
      client,
      `Find discussions, reviews, or commentary about the paper "${paperTitle}" or its key concepts.

Look for:
- Blog posts analyzing this paper
- Twitter/X discussions by researchers
- Reddit or HackerNews threads
- YouTube videos explaining the paper
- News articles about the research
- Critiques or alternative viewpoints

Key concepts to search: ${keyTerms}

Provide specific quotes and links. Tell me what people are saying about this work.`,
      `Authors: ${authors.slice(0, 2).join(', ')}`
    ),
    
    // Search for practical applications
    webSearchCompletion(
      client,
      `Find practical implementations, code, or applications related to "${paperTitle}".

Look for:
- GitHub repositories implementing this paper
- Hugging Face models or demos
- Tutorials or guides using these techniques
- Companies or products using this technology
- Benchmarks or comparisons with other methods
- Real-world deployments

Key techniques: ${keyTerms}

Provide specific links to code repos, demos, and implementations.`
    ),
  ]);
  
  // Collect all citations
  const allCitations = [
    ...authorResult.citations,
    ...discussionResult.citations,
    ...applicationResult.citations,
  ];
  
  // Dedupe citations by URL
  const uniqueCitations = Array.from(
    new Map(allCitations.map(c => [c.url, c])).values()
  );
  
  console.log(`[WebResearch] Found ${uniqueCitations.length} unique sources`);
  
  return {
    authorInfo: authorResult.content || 'No additional author information found.',
    relatedDiscussions: discussionResult.content || 'No related discussions found.',
    practicalApplications: applicationResult.content || 'No practical applications found.',
    citations: uniqueCitations.slice(0, 15), // Allow more citations
  };
}

/**
 * Group sections by top-level parent
 * Combines subsections with their parent section for more efficient processing
 */
function groupSectionsByParent(sections: StructuredSection[]): StructuredSection[][] {
  const groups: StructuredSection[][] = [];
  let currentGroup: StructuredSection[] = [];
  
  for (const section of sections) {
    if (section.level === 1) {
      // Start a new group for level-1 sections
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [section];
    } else {
      // Add subsections to current group
      currentGroup.push(section);
    }
  }
  
  // Don't forget the last group
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  
  return groups;
}

/**
 * Add timeout to a promise
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => {
      console.warn(`[Rewriter] Request timed out after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms))
  ]);
}

/**
 * YOLO-Style Rewriter Agent - Main rewriting
 * Processes each top-level section group independently for speed
 * Model: gpt-5-mini (smarter than 4.1, 4x cheaper, good at creative writing)
 * Uses parallel requests with timeout protection
 */
export async function callYOLORewriterAgent(
  client: OpenAI,
  structured: StructuredPaper,
  skeleton: SemanticSkeleton,
  _researchNotes: ResearchNote[], // Kept for API compatibility but not used for speed
  onBatchComplete?: (completed: number, total: number, sectionTitles: string[], allCompletedSections?: RewrittenSection[]) => void
): Promise<RewrittenSection[]> {
  // Group sections by top-level parent
  const sectionGroups = groupSectionsByParent(structured.sections);
  
  // Each group is its own batch (1 top-level section + its subsections)
  const totalBatches = sectionGroups.length;
  console.log(`[Rewriter] Processing ${structured.sections.length} sections in ${totalBatches} parallel batches`);
  
  // Track completed batches for progress reporting
  let completedCount = 0;
  
  // Collect all completed sections for streaming preview
  const allCompletedSections: RewrittenSection[] = [];
  
  // Process a single section group
  const processBatch = async (sectionBatch: StructuredSection[], batchNum: number): Promise<RewrittenSection[]> => {
    // Create fallback placeholders
    const placeholders: RewrittenSection[] = sectionBatch.map(s => ({
      id: s.id,
      title: s.title,
      html: `<section><h${s.level + 1}>${s.title}</h${s.level + 1}><p>${s.textBlocks.slice(0, 2).join('</p><p>')}</p></section>`,
    }));
    
    // Aggressively limit content to keep payloads small
    const input = {
      paperContext: {
        title: structured.title,
        abstract: structured.abstract.slice(0, 500),
      },
      skeleton: {
        problemStatement: skeleton.problemStatement.slice(0, 300),
      },
      sectionsToRewrite: sectionBatch.map(s => ({
        id: s.id,
        title: s.title,
        level: s.level,
        textBlocks: s.textBlocks.slice(0, 2).map(t => t.slice(0, 500)), // Max 500 chars per block
        equations: s.equations.slice(0, 1),
      })),
    };
    
    const doRequest = async (): Promise<RewrittenSection[]> => {
      const response = await chatCompletion(client, {
        model: 'gpt-5-mini',
        systemPrompt: YOLO_REWRITER_AGENT_PROMPT,
        userContent: `Rewrite these sections in YOLO style:\n\n${JSON.stringify(input, null, 2)}`,
        maxTokens: 4000, // Reduced for faster response
        temperature: 0.7,
        responseFormat: 'json',
      });
      
      const parsed = parseJSONResponse<YOLORewriterAgentResponse>(response);
      return parsed.sections;
    };
    
    try {
      // 60 second timeout per batch
      const result = await withTimeout(doRequest(), 60000, placeholders);
      
      // Add to all completed sections for streaming preview
      allCompletedSections.push(...result);
      
      completedCount++;
      if (onBatchComplete) {
        const titles = result.map(s => s.title);
        const isTimeout = result === placeholders && result.length > 0;
        onBatchComplete(
          completedCount, 
          totalBatches, 
          isTimeout ? titles.map(t => `[timeout] ${t}`) : titles,
          [...allCompletedSections] // Pass copy of all completed sections so far
        );
      }
      
      return result;
    } catch (e) {
      console.error(`Failed to rewrite batch ${batchNum}:`, e);
      
      // Still add placeholders to completed sections for preview
      allCompletedSections.push(...placeholders);
      
      completedCount++;
      if (onBatchComplete) {
        onBatchComplete(
          completedCount, 
          totalBatches, 
          placeholders.map(s => `[failed] ${s.title}`),
          [...allCompletedSections]
        );
      }
      
      return placeholders;
    }
  };
  
  // Run all batches in parallel (each is 1 top-level section group)
  const batchPromises = sectionGroups.map((group, idx) => processBatch(group, idx + 1));
  const results = await Promise.all(batchPromises);
  
  // Flatten results while preserving order
  return results.flat();
}

/**
 * Figure Mapping Agent - Places figures in sections
 * Model: gpt-5-nano (simple matching, cheapest model)
 * Includes retry logic
 */
export async function callFigureMappingAgent(
  client: OpenAI,
  structured: StructuredPaper,
  rewrittenSections: RewrittenSection[]
): Promise<FigurePlacement[]> {
  // If no figures, return empty
  if (structured.figures.length === 0) {
    return [];
  }
  
  const input = {
    figures: structured.figures.map(f => ({
      id: f.id,
      caption: f.caption.slice(0, 200),
    })),
    sectionTitles: rewrittenSections.map(s => ({
      id: s.id,
      title: s.title,
    })),
  };
  
  const maxRetries = 2;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Add delay if retrying to handle rate limits
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
      
      const response = await chatCompletion(client, {
        model: 'gpt-5-nano',
        systemPrompt: FIGURE_MAPPING_AGENT_PROMPT,
        userContent: `Map these figures to sections:\n\n${JSON.stringify(input, null, 2)}`,
        maxTokens: 2000,
        responseFormat: 'json',
      });
      
      const parsed = parseJSONResponse<FigureMappingAgentResponse>(response);
      return parsed.placements;
    } catch (e) {
      console.warn(`Figure mapping attempt ${attempt + 1} failed:`, e);
    }
  }
  
  // Fallback: create default placements
  console.error('Figure mapping failed, using default placements');
  return structured.figures.map((f, i) => ({
    figureId: f.id,
    placedInSectionId: rewrittenSections[Math.min(i, rewrittenSections.length - 1)]?.id || 'sec-intro',
    placementHint: 'bottom' as const,
  }));
}

/**
 * Critique Agent - Reviews for accuracy and style
 * Model: gpt-5.1 (best reasoning model for detecting hallucinations/inaccuracies)
 * Includes retry logic
 */
export async function callCritiqueAgent(
  client: OpenAI,
  structured: StructuredPaper,
  rewrittenSections: RewrittenSection[],
  researchNotes: ResearchNote[]
): Promise<CritiqueIssue[]> {
  // Condensed original for comparison - limit to first 20 sections
  const input = {
    original: condensePaperForLLM(structured),
    rewritten: rewrittenSections.slice(0, 20).map(s => ({
      id: s.id,
      title: s.title,
      htmlPreview: s.html.slice(0, 500), // Reduced preview size
    })),
    researchNotes: researchNotes.slice(0, 3),
  };
  
  const maxRetries = 2;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
      
      const response = await chatCompletion(client, {
        model: 'gpt-5.1',  // Best reasoning model for critical review
        systemPrompt: CRITIQUE_AGENT_PROMPT,
        userContent: `Review this rewritten paper:\n\n${JSON.stringify(input, null, 2)}`,
        maxTokens: 8000,  // More tokens for reasoning
        responseFormat: 'json',
      });
      
      const parsed = parseJSONResponse<CritiqueAgentResponse>(response);
      return parsed.issues;
    } catch (e) {
      console.warn(`Critique attempt ${attempt + 1} failed:`, e);
      if (attempt === maxRetries) {
        // Return empty issues to allow pipeline to continue
        console.error('Critique agent failed, skipping critique');
        return [];
      }
    }
  }
  
  return [];
}

/**
 * Patch Agent - Makes targeted fixes
 * Model: gpt-5-nano (structured edits, cheapest)
 * Includes retry logic
 */
export async function callPatchAgent(
  client: OpenAI,
  sectionsToFix: RewrittenSection[],
  issues: CritiqueIssue[],
  structured: StructuredPaper,
  researchNotes: ResearchNote[]
): Promise<RewrittenSection[]> {
  // Get relevant original sections
  const relevantOriginal = structured.sections
    .filter(s => sectionsToFix.some(sf => sf.id === s.id))
    .map(s => ({
      id: s.id,
      title: s.title,
      textBlocks: s.textBlocks.slice(0, 3), // Reduced limit
    }));
  
  const input = {
    sectionsToFix: sectionsToFix.map(s => ({
      id: s.id,
      title: s.title,
      html: s.html.slice(0, 2000), // Limit HTML size
    })),
    issues,
    originalContent: relevantOriginal,
    researchNotes: researchNotes.slice(0, 2),
  };
  
  const maxRetries = 2;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
      
      const response = await chatCompletion(client, {
        model: 'gpt-5-nano',
        systemPrompt: PATCH_AGENT_PROMPT,
        userContent: `Fix these issues in the sections:\n\n${JSON.stringify(input, null, 2)}`,
        maxTokens: 8000,
        responseFormat: 'json',
      });
      
      const parsed = parseJSONResponse<PatchAgentResponse>(response);
      return parsed.sections;
    } catch (e) {
      console.warn(`Patch attempt ${attempt + 1} failed:`, e);
      if (attempt === maxRetries) {
        // Return original sections unchanged
        console.error('Patch agent failed, keeping original sections');
        return sectionsToFix;
      }
    }
  }
  
  return sectionsToFix;
}
