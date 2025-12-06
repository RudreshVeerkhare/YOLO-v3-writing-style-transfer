// ============================================================
// Agent Service Functions
// Each function wraps an OpenAI call with specific prompts
// 
// MODEL SELECTION STRATEGY (GPT-5 family - better + cheaper):
// ============================================================
// Task Type              | Model         | Reasoning? | Why
// -----------------------|---------------|------------|---------------------------
// Semantic extraction    | gpt-5.1       | No         | Best reasoning for accurate paper understanding
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
  STYLE_BLUEPRINT_AGENT_PROMPT,
  YOLO_REWRITER_AGENT_PROMPT,
  FIGURE_MAPPING_AGENT_PROMPT,
  CRITIQUE_AGENT_PROMPT,
  PATCH_AGENT_PROMPT,
} from './agentPrompts';
import type {
  StructuredPaper,
  StructuredSection,
  SemanticSkeleton,
  StyleBlueprint,
  SectionStylePlan,
  ResearchQuestion,
  ResearchNote,
  RewrittenSection,
  FigurePlacement,
  CritiqueIssue,
  ExternalResearch,
  SemanticMapAgentResponse,
  StyleBlueprintAgentResponse,
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
 * Model: gpt-5.1 (best reasoning for accurate understanding - foundation for everything)
 */
export async function callSemanticMapAgent(
  client: OpenAI,
  structured: StructuredPaper
): Promise<SemanticSkeleton> {
  // Send condensed version, not full paper
  const condensed = condensePaperForLLM(structured);
  
  const response = await chatCompletion(client, {
    model: 'gpt-5.1',
    systemPrompt: SEMANTIC_MAP_AGENT_PROMPT,
    userContent: `Extract semantic skeleton from this paper:\n\n${JSON.stringify(condensed, null, 2)}`,
    maxTokens: 16000,
    temperature: 0.3,
    responseFormat: 'json',
  });
  
  return parseJSONResponse<SemanticMapAgentResponse>(response);
}

/**
 * Style Blueprint Agent - Plans the creative direction BEFORE rewriting
 * Creates a cohesive vision for the entire paper rewrite
 * Model: gpt-5-mini (creative planning needs good reasoning)
 */
export async function callStyleBlueprintAgent(
  client: OpenAI,
  structured: StructuredPaper,
  skeleton: SemanticSkeleton,
  researchNotes: ResearchNote[]
): Promise<StyleBlueprint> {
  console.log(`[StyleBlueprint] Planning creative direction for ${structured.sections.length} sections...`);
  
  // Prepare condensed research insights
  const researchInsights = researchNotes.slice(0, 5).map(n => ({
    question: n.questionId,
    answer: n.answer.slice(0, 200),
  }));
  
  // Prepare section list with context
  const sectionList = structured.sections.map(s => ({
    id: s.id,
    title: s.title,
    level: s.level,
    preview: s.textBlocks[0]?.slice(0, 200) || '',
  }));
  
  const input = {
    paper: {
      title: structured.title,
      authors: structured.authors,
      abstract: structured.abstract,
    },
    skeleton: {
      problemStatement: skeleton.problemStatement,
      motivation: skeleton.motivation,
      contributions: skeleton.contributions,
      methodSummary: skeleton.methodSummary,
      explicitLimitations: skeleton.explicitLimitations,
      inferredLimitations: skeleton.inferredLimitations,
    },
    researchInsights,
    sections: sectionList,
  };
  
  const response = await chatCompletion(client, {
    model: 'gpt-5-mini',
    systemPrompt: STYLE_BLUEPRINT_AGENT_PROMPT,
    userContent: `Create a style blueprint for this paper:\n\n${JSON.stringify(input, null, 2)}`,
    maxTokens: 8000,
    temperature: 0.8, // Higher temp for creative planning
    responseFormat: 'json',
  });
  
  const blueprint = parseJSONResponse<StyleBlueprintAgentResponse>(response);
  
  console.log(`[StyleBlueprint] Created blueprint with ${blueprint.sectionPlans?.length || 0} section plans`);
  console.log(`[StyleBlueprint] Narrative: ${blueprint.narrativeArc?.slice(0, 80)}...`);
  console.log(`[StyleBlueprint] Running jokes: ${blueprint.runningJokes?.length || 0}`);
  
  return blueprint;
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
        maxTokens: 8000,
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
        maxTokens: 4000,
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
  console.log(`[WebResearch] Authors: ${authors.join(', ')}`);
  
  // Extract key terms from abstract for better search
  const keyTerms = abstract.split(' ')
    .filter(word => word.length > 6 && !word.match(/^(which|where|their|there|these|those|through|without|within|between|during|before|after|above|below)$/i))
    .slice(0, 10)
    .join(' ');
  
  // Clean up author names for better searching
  const cleanAuthors = authors
    .filter(a => a && a.trim().length > 2)
    .map(a => a.trim().replace(/\s+/g, ' '))
    .slice(0, 4);
    
  const hasAuthors = cleanAuthors.length > 0;
  const authorSearchStr = cleanAuthors.join(', ');
  
  console.log(`[WebResearch] Clean authors for search: ${authorSearchStr}`);
  console.log(`[WebResearch] Key terms: ${keyTerms}`);
  
  // Build more specific search queries based on available data
  const authorQuery = hasAuthors 
    ? `Search for information about these researchers: ${authorSearchStr}

These researchers wrote the paper "${paperTitle}".

I need SPECIFIC information about each author:
1. Their current affiliation (university, company, research lab)
2. Their research focus and expertise areas
3. Their notable papers or contributions (with publication years if possible)
4. Their academic background (PhD from where, previous positions)
5. Any awards, fellowships, or recognition
6. Links to their personal website, Google Scholar, or Twitter/X profiles

Search strategies to try:
- Search each author name individually if needed
- Try "author name" + "researcher" or "professor" or "scientist"
- Look for their Google Scholar or DBLP profiles
- Search "author name" + research area from the paper

Do NOT return generic statements. I need specific, verifiable facts with sources.`
    : `Search for information about the authors of "${paperTitle}".

Try to identify who wrote this paper and find information about them.`;

  // Run searches in parallel for speed
  const searchPromises = [
    // Search for author information with specific instructions
    webSearchCompletion(client, authorQuery, hasAuthors ? `Paper abstract: ${abstract.slice(0, 300)}` : undefined),
    
    // Search for discussions about the paper/topic
    webSearchCompletion(
      client,
      `Find discussions, reviews, or commentary about the paper "${paperTitle}".

Search strategies:
1. Search the exact paper title in quotes
2. Search key phrases from the paper: ${keyTerms}
3. Look on academic discussion sites, blogs, and social media

Look for:
- Blog posts analyzing or explaining this paper
- Twitter/X discussions by researchers about this work
- Reddit r/MachineLearning, r/compsci, or r/science threads
- HackerNews discussions
- YouTube videos or podcasts discussing the paper
- Academic blog posts (e.g., The Gradient, Distill, etc.)
- News articles or press releases about the research
- Critiques, rebuttals, or follow-up work

Provide specific quotes and links. Tell me what people are actually saying about this work.`,
      hasAuthors ? `Authors: ${authorSearchStr}` : undefined
    ),
    
    // Search for practical applications
    webSearchCompletion(
      client,
      `Find practical implementations, code, or applications related to "${paperTitle}".

Search strategies:
1. Search the paper title + "github"
2. Search the paper title + "implementation"  
3. Search key techniques: ${keyTerms}

Look for:
- GitHub repositories implementing this paper (paperswithcode.com is great for this)
- Hugging Face models, spaces, or demos
- PyTorch/TensorFlow implementations
- Tutorials, guides, or notebooks using these techniques
- Companies or products using this technology
- Benchmarks or comparisons with other methods
- Real-world deployments or case studies

Provide specific links to code repos, demos, and implementations. Include star counts for GitHub repos if available.`
    ),
  ];
  
  const [authorResult, discussionResult, applicationResult] = await Promise.all(searchPromises);
  
  // Log individual search results for debugging
  console.log(`[WebResearch] Author search: ${authorResult.content.length} chars, ${authorResult.citations.length} citations`);
  console.log(`[WebResearch] Discussion search: ${discussionResult.content.length} chars, ${discussionResult.citations.length} citations`);
  console.log(`[WebResearch] Application search: ${applicationResult.content.length} chars, ${applicationResult.citations.length} citations`);
  
  // Check if search actually found useful content (not just empty or very short responses)
  const hasAuthorInfo = authorResult.content.length > 50;
  const hasDiscussions = discussionResult.content.length > 50;
  const hasApplications = applicationResult.content.length > 50;
  
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
  
  // Provide more helpful fallback messages
  const authorFallback = hasAuthors 
    ? `Could not find detailed information about ${authorSearchStr}. They may be newer researchers or their work may not be well-documented online yet.`
    : 'Author names were not available for this paper.';
    
  const discussionFallback = `No major discussions or reviews found for "${paperTitle}". This may be a newer paper or a niche topic.`;
  
  const applicationFallback = `No implementations or code repositories found for "${paperTitle}" yet. The paper may be too recent or theoretical.`;
  
  return {
    authorInfo: hasAuthorInfo ? authorResult.content : authorFallback,
    relatedDiscussions: hasDiscussions ? discussionResult.content : discussionFallback,
    practicalApplications: hasApplications ? applicationResult.content : applicationFallback,
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
      console.warn(`[Rewriter] Request timed out after ${ms/1000}s, using fallback`);
      resolve(fallback);
    }, ms))
  ]);
}

/**
 * YOLO-Style Rewriter Agent - Main rewriting
 * Processes each top-level section group independently for speed
 * Model: gpt-5-mini (smarter than 4.1, 4x cheaper, good at creative writing)
 * Uses parallel requests with timeout protection
 * 
 * Now uses StyleBlueprint for consistent creative direction across batches!
 */
export async function callYOLORewriterAgent(
  client: OpenAI,
  structured: StructuredPaper,
  _skeleton: SemanticSkeleton, // Kept for API compatibility, blueprint contains the relevant info
  researchNotes: ResearchNote[],
  blueprint: StyleBlueprint | null,
  onBatchComplete?: (completed: number, total: number, sectionTitles: string[], allCompletedSections?: RewrittenSection[]) => void
): Promise<RewrittenSection[]> {
  // Group sections by top-level parent
  const sectionGroups = groupSectionsByParent(structured.sections);
  
  // Each group is its own batch (1 top-level section + its subsections)
  const totalBatches = sectionGroups.length;
  console.log(`[Rewriter] Processing ${structured.sections.length} sections in ${totalBatches} parallel batches`);
  if (blueprint) {
    console.log(`[Rewriter] Using style blueprint with ${blueprint.sectionPlans?.length || 0} section plans`);
  }
  
  // Prepare condensed research context (shared across all batches)
  const researchContext = researchNotes.length > 0 
    ? researchNotes.slice(0, 5).map(n => ({
        question: n.questionId,
        answer: n.answer.slice(0, 300),
        hasSource: n.sources.length > 0,
      }))
    : [];
  
  // Prepare blueprint context (shared across all batches)
  const blueprintContext = blueprint ? {
    narrativeArc: blueprint.narrativeArc,
    overallTone: blueprint.overallTone,
    runningJokes: blueprint.runningJokes?.slice(0, 3) || [],
    honestAdmissions: blueprint.honestAdmissions?.slice(0, 3) || [],
    strengthsToHighlight: blueprint.strengthsToHighlight?.slice(0, 3) || [],
    weaknessesToAcknowledge: blueprint.weaknessesToAcknowledge?.slice(0, 3) || [],
  } : null;
  
  // Create a map of section plans for quick lookup
  const sectionPlanMap = new Map<string, SectionStylePlan>();
  if (blueprint?.sectionPlans) {
    for (const plan of blueprint.sectionPlans) {
      sectionPlanMap.set(plan.sectionId, plan);
    }
  }
  
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
    
    // Get section-specific plans from blueprint
    const sectionPlans = sectionBatch.map(s => {
      const plan = sectionPlanMap.get(s.id);
      return plan ? {
        sectionId: s.id,
        yoloTitle: plan.yoloTitle,
        openingHook: plan.openingHook,
        toneNotes: plan.toneNotes,
        keyPoints: plan.keyPoints?.slice(0, 3) || [],
        humorOpportunity: plan.humorOpportunity,
        honestMoment: plan.honestMoment,
      } : null;
    }).filter(Boolean);
    
    // Build comprehensive input with blueprint guidance
    const input = {
      paperContext: {
        title: structured.title,
        abstract: structured.abstract.slice(0, 600),
      },
      // Blueprint guidance for consistent style
      styleGuidance: blueprintContext ? {
        ...blueprintContext,
        sectionPlans, // Only plans for THIS batch
      } : null,
      // Research insights - can be woven into the rewrite
      researchInsights: researchContext,
      // The sections to actually rewrite (reduced payload for speed)
      sectionsToRewrite: sectionBatch.map(s => ({
        id: s.id,
        title: s.title,
        level: s.level,
        textBlocks: s.textBlocks.slice(0, 3).map(t => t.slice(0, 600)), // Reduced from 4x800 to 3x600
        equations: s.equations.slice(0, 1), // Just 1 equation for context
      })),
    };
    
    // Build the user prompt based on whether we have a blueprint
    const userPrompt = blueprint 
      ? `⚠️ FOLLOW THE STYLE BLUEPRINT PROVIDED!

You have been given a style blueprint created specifically for this paper. USE IT:
- Use the provided "yoloTitle" for section titles
- Start with the provided "openingHook" 
- Follow the "toneNotes" for each section
- Hit the "keyPoints" but make them casual
- Use the "humorOpportunity" and "honestMoment" if provided
- Weave in the "runningJokes" where natural
- Acknowledge "weaknessesToAcknowledge" with humor

The blueprint ensures consistency across the paper. Trust it!

Input:\n\n${JSON.stringify(input, null, 2)}`
      : `⚠️ IMPORTANT: DO NOT write boring academic prose! Write like a tired grad student who is brilliant but casual.

Rewrite these sections in YOLO style. Remember:
- Start with casual hooks like "Okay so here's the thing..." or "Look, we get it..."
- Use contractions (don't, we're, it's)
- Include at least one honest admission per section
- Include at least one self-deprecating joke
- Transform boring titles into fun ones

Input:\n\n${JSON.stringify(input, null, 2)}`;

    const doRequest = async (): Promise<RewrittenSection[]> => {
      const response = await chatCompletion(client, {
        model: 'gpt-5-mini',
        systemPrompt: YOLO_REWRITER_AGENT_PROMPT,
        userContent: userPrompt,
        maxTokens: 8000,
        temperature: 0.85, // Higher temperature for more creative/casual output
        responseFormat: 'json',
      });
      
      const parsed = parseJSONResponse<YOLORewriterAgentResponse>(response);
      return parsed.sections;
    };
    
    try {
      // 180 second timeout per batch (large sections need more time)
      const result = await withTimeout(doRequest(), 180000, placeholders);
      
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
 * 
 * STRATEGY: Use ORIGINAL figure references from the paper's LaTeX!
 * Each section has a `figures` array containing the figure IDs that were 
 * \ref'd in that section. This gives us the CORRECT placement.
 * 
 * Only use LLM as fallback for figures not referenced anywhere.
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
  
  const placements: FigurePlacement[] = [];
  const placedFigureIds = new Set<string>();
  
  // Create a mapping from original section IDs to rewritten section IDs
  // (they should match, but let's be safe)
  const rewrittenSectionIds = new Set(rewrittenSections.map(s => s.id));
  
  // STEP 1: Use original figure references from LaTeX
  // Each structured section has a `figures` array of figure IDs referenced in it
  for (const section of structured.sections) {
    if (!section.figures || section.figures.length === 0) continue;
    
    // Check if this section exists in the rewritten output
    const targetSectionId = rewrittenSectionIds.has(section.id) 
      ? section.id 
      : rewrittenSections[0]?.id; // fallback to first section
    
    if (!targetSectionId) continue;
    
    for (const figureId of section.figures) {
      if (placedFigureIds.has(figureId)) continue; // Already placed (first reference wins)
      
      // Verify this figure actually exists
      const figureExists = structured.figures.some(f => f.id === figureId);
      if (!figureExists) continue;
      
      placements.push({
        figureId,
        placedInSectionId: targetSectionId,
        placementHint: 'inline', // Referenced figures should be inline with text
      });
      placedFigureIds.add(figureId);
      
      console.log(`[FigureMapping] Placed ${figureId} in ${targetSectionId} (from original ref)`);
    }
  }
  
  // STEP 2: Handle figures that weren't referenced anywhere
  const unreferencedFigures = structured.figures.filter(f => !placedFigureIds.has(f.id));
  
  if (unreferencedFigures.length > 0) {
    console.log(`[FigureMapping] ${unreferencedFigures.length} figures not referenced, using LLM placement...`);
    
    // Use LLM only for unreferenced figures
    const input = {
      figures: unreferencedFigures.map(f => ({
        id: f.id,
        caption: f.caption.slice(0, 200),
      })),
      sections: rewrittenSections.map(s => ({
        id: s.id,
        title: s.title,
      })),
    };
    
    try {
      const response = await chatCompletion(client, {
        model: 'gpt-5-nano',
        systemPrompt: FIGURE_MAPPING_AGENT_PROMPT,
        userContent: `Map these unreferenced figures to the most relevant sections:\n\n${JSON.stringify(input, null, 2)}`,
        maxTokens: 4000,
        responseFormat: 'json',
      });
      
      const parsed = parseJSONResponse<FigureMappingAgentResponse>(response);
      for (const p of parsed.placements) {
        if (!placedFigureIds.has(p.figureId)) {
          placements.push(p);
          placedFigureIds.add(p.figureId);
          console.log(`[FigureMapping] Placed ${p.figureId} in ${p.placedInSectionId} (LLM guess)`);
        }
      }
    } catch (e) {
      console.warn('LLM figure placement failed, using fallback:', e);
      
      // Simple fallback: put unreferenced figures in the first section
      for (const f of unreferencedFigures) {
        if (!placedFigureIds.has(f.id)) {
          placements.push({
            figureId: f.id,
            placedInSectionId: rewrittenSections[0]?.id || 'sec-intro',
            placementHint: 'bottom',
          });
        }
      }
    }
  }
  
  console.log(`[FigureMapping] Total: ${placements.length} figures placed`);
  return placements;
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
        maxTokens: 16000,  // More tokens for reasoning
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
 * Model: gpt-5-mini (upgraded from nano - needs more capacity for HTML output)
 * Processes sections in small batches (2-3 at a time) to balance speed vs token limits
 */
export async function callPatchAgent(
  client: OpenAI,
  sectionsToFix: RewrittenSection[],
  issues: CritiqueIssue[],
  structured: StructuredPaper,
  _researchNotes: ResearchNote[] // Kept for API compatibility
): Promise<RewrittenSection[]> {
  // Group sections into small batches (2 sections per batch to avoid token limits)
  const BATCH_SIZE = 2;
  const batches: RewrittenSection[][] = [];
  for (let i = 0; i < sectionsToFix.length; i += BATCH_SIZE) {
    batches.push(sectionsToFix.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`[Patch] Processing ${sectionsToFix.length} sections in ${batches.length} batches`);
  
  // Process batches in parallel
  const batchResults = await Promise.all(batches.map(async (batch, batchIndex) => {
    // Get issues for sections in this batch
    const batchSectionIds = new Set(batch.map(s => s.id));
    const batchIssues = issues.filter(i => batchSectionIds.has(i.location.sectionId));
    
    if (batchIssues.length === 0) {
      // No issues for this batch, return as-is
      return batch;
    }
    
    // Get relevant original sections
    const originalSections = structured.sections
      .filter(s => batchSectionIds.has(s.id))
      .map(s => ({
        id: s.id,
        title: s.title,
        textBlocks: s.textBlocks.slice(0, 2).map(t => t.slice(0, 300)),
      }));
    
    const input = {
      sectionsToFix: batch.map(s => ({
        id: s.id,
        title: s.title,
        html: s.html.slice(0, 2500), // Limit per section
      })),
      issues: batchIssues.map(i => ({
        sectionId: i.location.sectionId,
        severity: i.severity,
        kind: i.kind,
        message: i.message,
        suggestion: i.suggestion,
      })),
      originalContent: originalSections,
    };
    
    const maxRetries = 2;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        
        const response = await chatCompletion(client, {
          model: 'gpt-5-mini',
          systemPrompt: PATCH_AGENT_PROMPT,
          userContent: `Fix these issues in the sections:\n\n${JSON.stringify(input, null, 2)}`,
          maxTokens: 8000,
          responseFormat: 'json',
        });
        
        const parsed = parseJSONResponse<PatchAgentResponse>(response);
        if (parsed.sections && parsed.sections.length > 0) {
          console.log(`[Patch] Batch ${batchIndex + 1}/${batches.length} complete: ${parsed.sections.length} sections`);
          return parsed.sections;
        }
      } catch (e) {
        console.warn(`[Patch] Batch ${batchIndex + 1} attempt ${attempt + 1} failed:`, e);
      }
    }
    
    // Return original sections if patching failed
    console.warn(`[Patch] Batch ${batchIndex + 1} failed, keeping original sections`);
    return batch;
  }));
  
  // Flatten batch results
  return batchResults.flat();
}
