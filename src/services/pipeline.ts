// ============================================================
// Pipeline Orchestrator
// Coordinates all agents and manages the rewriting pipeline
// ============================================================

import OpenAI from 'openai';
import { createOpenAIClient } from './openaiClient';
import { fetchAndExtractTeX, resolveTexIncludes } from './texFetcher';
import { parseLatexToStructuredPaper, getParseStats, setCustomMacros } from './texParser';
import { estimatePipelineCost, type CostEstimate } from './costEstimator';
import {
  callSemanticMapAgent,
  callStyleBlueprintAgent,
  callResearchQuestionsAgent,
  callResearchAnswerAgent,
  callWebResearchAgent,
  callYOLORewriterAgent,
  callFigureMappingAgent,
  callCritiqueAgent,
  callPatchAgent,
} from './agents';
import { assembleFinalDocument, assemblePartialDocument } from './assembler';
import type {
  PaperTeXBundle,
  StructuredPaper,
  SemanticSkeleton,
  StyleBlueprint,
  ResearchQuestion,
  ResearchNote,
  RewrittenSection,
  FigurePlacement,
  FinalDocument,
  PipelineStage,
  LogEntry,
  ExternalResearch,
  GenerationConfig,
} from '../types';
import { globalUsageTracker } from './usageTracker';

export interface PipelineCallbacks {
  onStageChange: (stage: PipelineStage) => void;
  onLog: (entry: LogEntry) => void;
  onProgress: (progress: number) => void;
  onPartialDocument?: (document: FinalDocument, completedSections: number, totalSections: number) => void;
  onError: (error: string) => void;
  onComplete: (document: FinalDocument) => void;
}

export interface PipelineOptions {
  critiqueIterations: number;
  enableWebSearch: boolean;
}

/**
 * Main pipeline orchestrator
 */
export async function runPipeline(
  arxivId: string,
  apiKey: string,
  options: PipelineOptions,
  callbacks: PipelineCallbacks
): Promise<void> {
  const { onStageChange, onLog, onProgress, onPartialDocument, onError, onComplete } = callbacks;
  
  const log = (stage: PipelineStage, message: string) => {
    onLog({
      timestamp: new Date().toISOString(),
      stage,
      message,
    });
  };
  
  let client: OpenAI;
  let bundle: PaperTeXBundle;
  let structured: StructuredPaper;
  let skeleton: SemanticSkeleton;
  let questions: ResearchQuestion[];
  let researchNotes: ResearchNote[];
  let externalResearch: ExternalResearch | null = null;
  let rewritten: RewrittenSection[];
  let figurePlacements: FigurePlacement[];
  
  // Track generation timing
  const startTime = Date.now();
  
  try {
    // Create OpenAI client
    client = createOpenAIClient({ apiKey });
    
    // ========================================
    // Stage 1: Fetch Paper from arXiv
    // ========================================
    onStageChange('fetch');
    onProgress(1);
    log('fetch', `Starting download for arXiv:${arxivId}...`);
    
    try {
      bundle = await fetchAndExtractTeX(arxivId, (msg) => log('fetch', msg));
    } catch (e) {
      throw new Error(`Failed to fetch arXiv source: ${e}`);
    }
    
    onProgress(5);
    
    // ========================================
    // Stage 2: Ingestion - Process the downloaded content
    // ========================================
    onStageChange('ingestion');
    log('ingestion', `Processing ${Object.keys(bundle.texFiles).length} TeX files and ${Object.keys(bundle.assets).length} assets`);
    log('ingestion', `Main file: ${bundle.mainTexFilename}`);
    log('ingestion', `Title: ${bundle.metadata.title}`);
    
    onProgress(10);
    
    // ========================================
    // Stage 3: Structure (Deterministic Parser - no LLM)
    // ========================================
    onStageChange('structure');
    log('structure', 'Parsing LaTeX with deterministic parser...');
    
    // Resolve includes first
    const mainTex = bundle.texFiles[bundle.mainTexFilename];
    const resolvedTex = resolveTexIncludes(mainTex, bundle.texFiles);
    
    // Load custom macros from the paper's preamble before parsing
    setCustomMacros(bundle.customMacros);
    if (bundle.customMacros && bundle.customMacros.length > 0) {
      log('structure', `Found ${bundle.customMacros.length} custom macros in preamble`);
    }
    
    // Use deterministic parser - no LLM needed for this!
    structured = parseLatexToStructuredPaper(resolvedTex, bundle.metadata);
    
    const parseStats = getParseStats(structured);
    log('structure', `Parsed ${parseStats.sectionCount} sections, ${parseStats.figureCount} figures, ${parseStats.equationCount} equations`);
    log('structure', `Extracted ${parseStats.textBlockCount} text blocks (${Math.round(parseStats.totalTextLength / 1000)}k chars)`);
    onProgress(20);
    
    // ========================================
    // Stage 4: Semantics
    // ========================================
    onStageChange('semantics');
    log('semantics', 'Building semantic skeleton...');
    
    skeleton = await callSemanticMapAgent(client, structured);
    
    log('semantics', `Problem: ${skeleton.problemStatement.slice(0, 80)}...`);
    log('semantics', `Identified ${skeleton.contributions.length} contributions`);
    log('semantics', `Found ${skeleton.explicitLimitations.length} explicit + ${skeleton.inferredLimitations.length} inferred limitations`);
    onProgress(30);
    
    // ========================================
    // Stage 5: Research & Answer
    // ========================================
    onStageChange('research');
    
    // 5a: Generate research questions
    log('research', 'Identifying research gaps...');
    questions = await callResearchQuestionsAgent(client, structured, skeleton);
    log('research', `Generated ${questions.length} research questions`);
    for (const q of questions.slice(0, 2)) {
      log('research', `  • ${q.question.slice(0, 50)}...`);
    }
    onProgress(32);
    
    // 5b: Answer research questions with progress tracking
    log('research', `Answering ${questions.length} questions...`);
    let answeredCount = 0;
    const researchPromises = questions.map(async (question) => {
      try {
        const result = await callResearchAnswerAgent(client, question, structured.title);
        answeredCount++;
        // Update progress: 32% to 38% during answers
        const answerProgress = 32 + Math.floor((answeredCount / questions.length) * 6);
        onProgress(answerProgress);
        log('research', `  ✓ Answered: ${question.question.slice(0, 40)}...`);
        return result;
      } catch (e) {
        answeredCount++;
        log('research', `  ✗ Failed: ${question.id}`);
        return {
          questionId: question.id,
          answer: 'Could not research this question due to an error.',
          sources: [],
        };
      }
    });
    
    // Wait for research answers
    researchNotes = await Promise.all(researchPromises);
    log('research', `Completed ${researchNotes.length} research answers`);
    onProgress(38);
    
    // ========================================
    // Stage 6: Web Search (optional)
    // ========================================
    onStageChange('websearch');
    
    if (options.enableWebSearch) {
      log('websearch', 'Searching for author info & community discussions...');
      try {
        externalResearch = await callWebResearchAgent(
          client,
          structured.title,
          structured.authors,
          structured.abstract
        );
        if (externalResearch) {
          log('websearch', `Found ${externalResearch.citations.length} sources`);
          if (externalResearch.authorInfo) {
            log('websearch', `Author info: ${externalResearch.authorInfo.slice(0, 60)}...`);
          }
        }
      } catch (e) {
        log('websearch', `Web search failed (non-critical): ${e}`);
        externalResearch = null;
      }
    }
    // If web search is disabled, stage will show as "skipped" (no logs)
    onProgress(42);
    
    // ========================================
    // Stage 7: Rewrite (includes style planning)
    // ========================================
    onStageChange('rewrite');
    log('rewrite', 'Planning creative style direction...');
    
    let styleBlueprint: StyleBlueprint | null = null;
    try {
      styleBlueprint = await callStyleBlueprintAgent(
        client,
        structured,
        skeleton,
        researchNotes
      );
      log('rewrite', `Style blueprint created: "${styleBlueprint.narrativeArc?.slice(0, 60)}..."`);
      log('rewrite', `Planned ${styleBlueprint.sectionPlans?.length || 0} section rewrites`);
    } catch (e) {
      log('rewrite', `Style planning failed (non-critical, will use default style): ${e}`);
      styleBlueprint = null;
    }
    onProgress(48);
    
    log('rewrite', 'Generating YOLO-style rewrite...');
    
    // Count top-level sections for accurate batch estimate
    const topLevelSections = structured.sections.filter(s => s.level === 1).length;
    log('rewrite', `Processing ${structured.sections.length} sections (${topLevelSections} top-level) in parallel...`);
    if (styleBlueprint) {
      log('rewrite', `Using style blueprint for consistent creative direction`);
    }
    
    rewritten = await callYOLORewriterAgent(
      client,
      structured,
      skeleton,
      researchNotes,
      styleBlueprint,
      (completed, total, titles, partialSections) => {
        log('rewrite', `Batch ${completed}/${total} complete: ${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '...' : ''}`);
        // Update progress: rewrite stage goes from 48% to 62%
        const rewriteProgress = 48 + Math.floor((completed / total) * 14);
        onProgress(rewriteProgress);
        
        // Stream partial document to preview
        if (onPartialDocument && partialSections && partialSections.length > 0) {
          const partialDoc = assemblePartialDocument(
            bundle,
            structured,
            partialSections,
            structured.sections.length
          );
          onPartialDocument(partialDoc, partialSections.length, structured.sections.length);
        }
      }
    );
    
    log('rewrite', `Generated ${rewritten.length} rewritten sections`);
    onProgress(60);
    
    // ========================================
    // Stage 7: Figures
    // ========================================
    onStageChange('figures');
    log('figures', 'Mapping figures to sections...');
    
    if (structured.figures.length > 0) {
      figurePlacements = await callFigureMappingAgent(client, structured, rewritten);
      log('figures', `Placed ${figurePlacements.length} figures`);
    } else {
      figurePlacements = [];
      log('figures', 'No figures to place');
    }
    
    onProgress(65);
    
    // ========================================
    // Stage 8: Critique Loop
    // ========================================
    onStageChange('critique');
    const maxIterations = options.critiqueIterations;
    
    if (maxIterations === 0) {
      log('critique', 'Critique disabled — skipping accuracy review');
    } else {
      log('critique', `Running ${maxIterations} critique iteration${maxIterations !== 1 ? 's' : ''}...`);
    }
    
    for (let iter = 0; iter < maxIterations; iter++) {
      log('critique', `Critique iteration ${iter + 1}/${maxIterations}...`);
      
      const issues = await callCritiqueAgent(
        client,
        structured,
        rewritten,
        researchNotes
      );
      
      const majorIssues = issues.filter(i => i.severity === 'major');
      const minorIssues = issues.filter(i => i.severity === 'minor');
      
      log('critique', `Found ${majorIssues.length} major and ${minorIssues.length} minor issues`);
      
      if (majorIssues.length === 0) {
        log('critique', 'No major issues found, finishing critique loop');
        break;
      }
      
      // Identify sections that need patching
      const sectionsToFix = new Set<string>();
      for (const issue of issues) {
        sectionsToFix.add(issue.location.sectionId);
      }
      
      const sectionsNeedingPatch = rewritten.filter(s => sectionsToFix.has(s.id));
      
      log('critique', `Patching ${sectionsNeedingPatch.length} sections...`);
      
      const patchedSections = await callPatchAgent(
        client,
        sectionsNeedingPatch,
        issues,
        structured,
        researchNotes
      );
      
      // Merge patched sections back
      for (const patched of patchedSections) {
        const index = rewritten.findIndex(s => s.id === patched.id);
        if (index >= 0) {
          rewritten[index] = patched;
        }
      }
      
      log('critique', `Iteration ${iter + 1} complete`);
      onProgress(65 + Math.floor((iter + 1) / maxIterations * 20));
    }
    
    onProgress(85);
    
    // ========================================
    // Stage 9: Assembly
    // ========================================
    onStageChange('assembly');
    log('assembly', 'Assembling final document...');
    
    // Build generation config from tracked usage
    const usageStats = globalUsageTracker.getStats();
    const generationConfig: GenerationConfig = {
      model: 'gpt-5.1',
      critiqueIterations: options.critiqueIterations,
      webSearchEnabled: options.enableWebSearch,
      estimatedCost: usageStats.estimatedCost,
      actualCost: usageStats.estimatedCost,
      totalTokens: usageStats.totalInputTokens + usageStats.totalOutputTokens,
      generationTimeMs: Date.now() - startTime,
    };
    
    const finalDocument = assembleFinalDocument(
      bundle,
      structured,
      rewritten,
      figurePlacements,
      researchNotes,
      externalResearch,
      generationConfig
    );
    
    log('assembly', 'Document assembly complete!');
    onProgress(100);
    
    // ========================================
    // Done!
    // ========================================
    onStageChange('done');
    log('done', `Successfully generated YOLO-style rewrite of "${bundle.metadata.title}"`);
    
    onComplete(finalDocument);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    onStageChange('error');
    onError(errorMessage);
    log('error', `Pipeline failed: ${errorMessage}`);
  }
}

/**
 * Validate arXiv ID format
 */
export function validateArxivId(id: string): boolean {
  // Old format: hep-th/9901001
  // New format: 1234.56789 or 1234.56789v1
  const oldFormat = /^[a-z-]+\/\d{7}$/;
  const newFormat = /^\d{4}\.\d{4,5}(v\d+)?$/;
  
  return oldFormat.test(id) || newFormat.test(id);
}

/**
 * Clean and normalize arXiv ID
 */
export function normalizeArxivId(input: string): string {
  // Remove common prefixes
  let id = input
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, '')
    .replace(/^arxiv:/i, '')
    .replace(/\.pdf$/, '');
  
  return id;
}

// Re-export CostEstimate type for use in components
export type { CostEstimate } from './costEstimator';

export interface EstimateProgressCallbacks {
  onStageChange: (stage: 'fetch' | 'ingestion' | 'structure') => void;
  onLog: (stage: 'fetch' | 'ingestion' | 'structure', message: string) => void;
  onProgress: (progress: number) => void;
  onEstimateComplete: () => void;
}

/**
 * Prefetch paper and estimate cost WITHOUT making any LLM API calls
 * Returns the cost estimate and parsed paper data for confirmation
 */
export async function prefetchAndEstimateCost(
  arxivId: string,
  options: PipelineOptions,
  callbacks?: EstimateProgressCallbacks
): Promise<{
  estimate: CostEstimate;
  bundle: PaperTeXBundle;
  structured: StructuredPaper;
}> {
  const log = (stage: 'fetch' | 'ingestion' | 'structure', message: string) => {
    callbacks?.onLog(stage, message);
  };
  
  // Stage 1: Fetch
  callbacks?.onStageChange('fetch');
  callbacks?.onProgress(1);
  log('fetch', `Starting download for arXiv:${arxivId}...`);
  
  const bundle = await fetchAndExtractTeX(arxivId, (msg) => log('fetch', msg));
  callbacks?.onProgress(5);
  
  // Stage 2: Ingestion
  callbacks?.onStageChange('ingestion');
  log('ingestion', `Processing ${Object.keys(bundle.texFiles).length} TeX files and ${Object.keys(bundle.assets).length} assets`);
  log('ingestion', `Main file: ${bundle.mainTexFilename}`);
  log('ingestion', `Title: ${bundle.metadata.title}`);
  
  // Resolve includes
  const mainTex = bundle.texFiles[bundle.mainTexFilename];
  const resolvedTex = resolveTexIncludes(mainTex, bundle.texFiles);
  
  // Load custom macros before parsing
  setCustomMacros(bundle.customMacros);
  if (bundle.customMacros && bundle.customMacros.length > 0) {
    log('ingestion', `Found ${bundle.customMacros.length} custom macros in preamble`);
  }
  callbacks?.onProgress(10);
  
  // Stage 3: Structure
  callbacks?.onStageChange('structure');
  log('structure', 'Parsing LaTeX with deterministic parser...');
  
  const structured = parseLatexToStructuredPaper(resolvedTex, bundle.metadata);
  
  const parseStats = getParseStats(structured);
  log('structure', `Parsed ${parseStats.sectionCount} sections, ${parseStats.figureCount} figures, ${parseStats.equationCount} equations`);
  log('structure', `Extracted ${parseStats.textBlockCount} text blocks (${Math.round(parseStats.totalTextLength / 1000)}k chars)`);
  callbacks?.onProgress(20);
  
  // Estimate cost
  const estimate = estimatePipelineCost(structured, options);
  
  return { estimate, bundle, structured };
}

/**
 * Run the pipeline with pre-fetched data (skips fetch/parse stages)
 */
export async function runPipelineWithPrefetchedData(
  bundle: PaperTeXBundle,
  structured: StructuredPaper,
  apiKey: string,
  options: PipelineOptions,
  callbacks: PipelineCallbacks
): Promise<void> {
  const { onStageChange, onLog, onProgress, onPartialDocument, onError, onComplete } = callbacks;
  
  const log = (stage: PipelineStage, message: string) => {
    onLog({
      timestamp: new Date().toISOString(),
      stage,
      message,
    });
  };
  
  let client: OpenAI;
  let skeleton: SemanticSkeleton;
  let questions: ResearchQuestion[];
  let researchNotes: ResearchNote[];
  let externalResearch: ExternalResearch | null = null;
  let rewritten: RewrittenSection[];
  let figurePlacements: FigurePlacement[];
  
  // Track generation timing
  const startTime = Date.now();
  
  try {
    // Create OpenAI client
    client = createOpenAIClient({ apiKey });
    
    // Skip ingestion and structure - already done
    onStageChange('ingestion');
    onProgress(10);
    log('ingestion', `Using pre-fetched data for arXiv paper`);
    log('ingestion', `Title: ${bundle.metadata.title}`);
    
    onStageChange('structure');
    onProgress(20);
    log('structure', `Pre-parsed: ${structured.sections.length} sections, ${structured.figures.length} figures`);
    
    // Continue with semantics stage...
    // (Rest of pipeline continues from here - same as runPipeline)
    
    // ========================================
    // Stage 3: Semantics
    // ========================================
    onStageChange('semantics');
    log('semantics', 'Building semantic skeleton...');
    
    skeleton = await callSemanticMapAgent(client, structured);
    
    log('semantics', `Problem: ${skeleton.problemStatement.slice(0, 80)}...`);
    log('semantics', `Identified ${skeleton.contributions.length} contributions`);
    log('semantics', `Found ${skeleton.explicitLimitations.length} explicit + ${skeleton.inferredLimitations.length} inferred limitations`);
    onProgress(30);
    
    // ========================================
    // Stage 4: Research & Answer
    // ========================================
    onStageChange('research');
    
    // 4a: Generate research questions
    log('research', 'Identifying research gaps...');
    questions = await callResearchQuestionsAgent(client, structured, skeleton);
    log('research', `Generated ${questions.length} research questions`);
    for (const q of questions.slice(0, 2)) {
      log('research', `  • ${q.question.slice(0, 50)}...`);
    }
    onProgress(32);
    
    // 4b: Answer research questions with progress tracking
    log('research', `Answering ${questions.length} questions...`);
    let answeredCount = 0;
    const researchPromises = questions.map(async (question) => {
      try {
        const result = await callResearchAnswerAgent(client, question, structured.title);
        answeredCount++;
        // Update progress: 32% to 38% during answers
        const answerProgress = 32 + Math.floor((answeredCount / questions.length) * 6);
        onProgress(answerProgress);
        log('research', `  ✓ Answered: ${question.question.slice(0, 40)}...`);
        return result;
      } catch (e) {
        answeredCount++;
        log('research', `  ✗ Failed: ${question.id}`);
        return {
          questionId: question.id,
          answer: 'Could not research this question due to an error.',
          sources: [],
        };
      }
    });
    
    // Wait for research answers
    researchNotes = await Promise.all(researchPromises);
    log('research', `Completed ${researchNotes.length} research answers`);
    onProgress(38);
    
    // ========================================
    // Stage 5: Web Search (optional)
    // ========================================
    onStageChange('websearch');
    
    if (options.enableWebSearch) {
      log('websearch', 'Searching for author info & community discussions...');
      try {
        externalResearch = await callWebResearchAgent(
          client,
          structured.title,
          structured.authors,
          structured.abstract
        );
        if (externalResearch) {
          log('websearch', `Found ${externalResearch.citations.length} sources`);
          if (externalResearch.authorInfo) {
            log('websearch', `Author info: ${externalResearch.authorInfo.slice(0, 60)}...`);
          }
        }
      } catch (e) {
        log('websearch', `Web search failed (non-critical): ${e}`);
        externalResearch = null;
      }
    }
    // If web search is disabled, stage will show as "skipped" (no logs)
    onProgress(42);
    
    // ========================================
    // Stage 6: Rewrite (includes style planning)
    // ========================================
    onStageChange('rewrite');
    log('rewrite', 'Planning creative style direction...');
    
    let styleBlueprint: StyleBlueprint | null = null;
    try {
      styleBlueprint = await callStyleBlueprintAgent(
        client,
        structured,
        skeleton,
        researchNotes
      );
      log('rewrite', `Style blueprint created: "${styleBlueprint.narrativeArc?.slice(0, 60)}..."`);
      log('rewrite', `Planned ${styleBlueprint.sectionPlans?.length || 0} section rewrites`);
    } catch (e) {
      log('rewrite', `Style planning failed (non-critical, will use default style): ${e}`);
      styleBlueprint = null;
    }
    onProgress(48);
    
    log('rewrite', 'Generating YOLO-style rewrite...');
    
    const topLevelSections = structured.sections.filter(s => s.level === 1).length;
    log('rewrite', `Processing ${structured.sections.length} sections (${topLevelSections} top-level) in parallel...`);
    if (styleBlueprint) {
      log('rewrite', `Using style blueprint for consistent creative direction`);
    }
    
    rewritten = await callYOLORewriterAgent(
      client,
      structured,
      skeleton,
      researchNotes,
      styleBlueprint,
      (completed, total, titles, partialSections) => {
        log('rewrite', `Batch ${completed}/${total} complete: ${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '...' : ''}`);
        const rewriteProgress = 48 + Math.floor((completed / total) * 14);
        onProgress(rewriteProgress);
        
        if (onPartialDocument && partialSections && partialSections.length > 0) {
          const partialDoc = assemblePartialDocument(
            bundle,
            structured,
            partialSections,
            structured.sections.length
          );
          onPartialDocument(partialDoc, partialSections.length, structured.sections.length);
        }
      }
    );
    
    log('rewrite', `Generated ${rewritten.length} rewritten sections`);
    onProgress(62);
    
    // ========================================
    // Stage 6: Figures
    // ========================================
    onStageChange('figures');
    log('figures', 'Mapping figures to sections...');
    
    if (structured.figures.length > 0) {
      figurePlacements = await callFigureMappingAgent(client, structured, rewritten);
      log('figures', `Placed ${figurePlacements.length} figures`);
    } else {
      figurePlacements = [];
      log('figures', 'No figures to place');
    }
    
    onProgress(65);
    
    // ========================================
    // Stage 7: Critique Loop
    // ========================================
    onStageChange('critique');
    const maxIterations = options.critiqueIterations;
    
    if (maxIterations === 0) {
      log('critique', 'Critique disabled — skipping accuracy review');
    } else {
      log('critique', `Running ${maxIterations} critique iteration${maxIterations !== 1 ? 's' : ''}...`);
    }
    
    for (let iter = 0; iter < maxIterations; iter++) {
      log('critique', `Critique iteration ${iter + 1}/${maxIterations}...`);
      
      const issues = await callCritiqueAgent(
        client,
        structured,
        rewritten,
        researchNotes
      );
      
      const majorIssues = issues.filter(i => i.severity === 'major');
      const minorIssues = issues.filter(i => i.severity === 'minor');
      
      log('critique', `Found ${majorIssues.length} major and ${minorIssues.length} minor issues`);
      
      if (majorIssues.length === 0) {
        log('critique', 'No major issues found, finishing critique loop');
        break;
      }
      
      const sectionsToFix = new Set<string>();
      for (const issue of issues) {
        sectionsToFix.add(issue.location.sectionId);
      }
      
      const sectionsNeedingPatch = rewritten.filter(s => sectionsToFix.has(s.id));
      
      log('critique', `Patching ${sectionsNeedingPatch.length} sections...`);
      
      const patchedSections = await callPatchAgent(
        client,
        sectionsNeedingPatch,
        issues,
        structured,
        researchNotes
      );
      
      for (const patched of patchedSections) {
        const index = rewritten.findIndex(s => s.id === patched.id);
        if (index >= 0) {
          rewritten[index] = patched;
        }
      }
      
      log('critique', `Iteration ${iter + 1} complete`);
      onProgress(65 + Math.floor((iter + 1) / maxIterations * 20));
    }
    
    onProgress(85);
    
    // ========================================
    // Stage 8: Assembly
    // ========================================
    onStageChange('assembly');
    log('assembly', 'Assembling final document...');
    
    // Build generation config from tracked usage
    const usageStats = globalUsageTracker.getStats();
    const generationConfig: GenerationConfig = {
      model: 'gpt-5.1',
      critiqueIterations: options.critiqueIterations,
      webSearchEnabled: options.enableWebSearch,
      estimatedCost: usageStats.estimatedCost,
      actualCost: usageStats.estimatedCost,
      totalTokens: usageStats.totalInputTokens + usageStats.totalOutputTokens,
      generationTimeMs: Date.now() - startTime,
    };
    
    const finalDocument = assembleFinalDocument(
      bundle,
      structured,
      rewritten,
      figurePlacements,
      researchNotes,
      externalResearch,
      generationConfig
    );
    
    log('assembly', 'Document assembly complete!');
    onProgress(100);
    
    // ========================================
    // Done!
    // ========================================
    onStageChange('done');
    log('done', `Successfully generated YOLO-style rewrite of "${bundle.metadata.title}"`);
    
    onComplete(finalDocument);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    onStageChange('error');
    onError(errorMessage);
    log('error', `Pipeline failed: ${errorMessage}`);
  }
}
