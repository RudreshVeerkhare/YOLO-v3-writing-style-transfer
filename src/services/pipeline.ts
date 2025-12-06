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
  ResearchQuestion,
  ResearchNote,
  RewrittenSection,
  FigurePlacement,
  FinalDocument,
  PipelineStage,
  LogEntry,
  ExternalResearch,
} from '../types';

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
  
  try {
    // Create OpenAI client
    client = createOpenAIClient({ apiKey });
    
    // ========================================
    // Stage 1: Ingestion
    // ========================================
    onStageChange('ingestion');
    onProgress(5);
    log('ingestion', `Fetching TeX source for arXiv:${arxivId}...`);
    
    try {
      bundle = await fetchAndExtractTeX(arxivId);
      log('ingestion', `Found ${Object.keys(bundle.texFiles).length} TeX files and ${Object.keys(bundle.assets).length} assets`);
      log('ingestion', `Main file: ${bundle.mainTexFilename}`);
      log('ingestion', `Title: ${bundle.metadata.title}`);
    } catch (e) {
      throw new Error(`Failed to fetch arXiv source: ${e}`);
    }
    
    onProgress(10);
    
    // ========================================
    // Stage 2: Structure (Deterministic Parser - no LLM)
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
    // Stage 4: Research
    // ========================================
    onStageChange('research');
    log('research', 'Identifying research gaps...');
    
    questions = await callResearchQuestionsAgent(client, structured, skeleton);
    log('research', `Generated ${questions.length} research questions`);
    for (const q of questions.slice(0, 3)) {
      log('research', `  • ${q.question.slice(0, 60)}...`);
    }
    
    onProgress(35);
    
    log('research', `Researching ${questions.length} questions in parallel...`);
    
    // Start web research in parallel with question answering (if enabled)
    let webResearchPromise: Promise<ExternalResearch | null>;
    if (options.enableWebSearch) {
      log('research', 'Web search enabled — researching authors and discussions...');
      webResearchPromise = callWebResearchAgent(
        client,
        structured.title,
        structured.authors,
        structured.abstract
      ).catch(e => {
        log('research', `Web research failed (non-critical): ${e}`);
        return null;
      });
    } else {
      log('research', 'Web search disabled — skipping external research');
      webResearchPromise = Promise.resolve(null);
    }
    
    // Process all research questions in parallel
    const researchPromises = questions.map(async (question) => {
      try {
        return await callResearchAnswerAgent(client, question, structured.title);
      } catch (e) {
        log('research', `Failed to answer question ${question.id}: ${e}`);
        return {
          questionId: question.id,
          answer: 'Could not research this question due to an error.',
          sources: [],
        };
      }
    });
    
    // Wait for both to complete
    const [researchResults, webResearchResult] = await Promise.all([
      Promise.all(researchPromises),
      webResearchPromise,
    ]);
    
    researchNotes = researchResults;
    externalResearch = webResearchResult;
    
    log('research', `Collected ${researchNotes.length} research notes`);
    if (externalResearch) {
      log('research', `Web research: Found ${externalResearch.citations.length} external sources`);
    }
    onProgress(45);
    
    // ========================================
    // Stage 5: Rewrite
    // ========================================
    onStageChange('rewrite');
    log('rewrite', 'Generating YOLO-style rewrite...');
    
    // Count top-level sections for accurate batch estimate
    const topLevelSections = structured.sections.filter(s => s.level === 1).length;
    log('rewrite', `Processing ${structured.sections.length} sections (${topLevelSections} top-level) in parallel...`);
    
    rewritten = await callYOLORewriterAgent(
      client,
      structured,
      skeleton,
      researchNotes,
      (completed, total, titles, partialSections) => {
        log('rewrite', `Batch ${completed}/${total} complete: ${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '...' : ''}`);
        // Update progress: rewrite stage goes from 45% to 60%
        const rewriteProgress = 45 + Math.floor((completed / total) * 15);
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
    // Stage 8: Assembly
    // ========================================
    onStageChange('assembly');
    log('assembly', 'Assembling final document...');
    
    const finalDocument = assembleFinalDocument(
      bundle,
      structured,
      rewritten,
      figurePlacements,
      researchNotes,
      externalResearch
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

/**
 * Prefetch paper and estimate cost WITHOUT making any LLM API calls
 * Returns the cost estimate and parsed paper data for confirmation
 */
export async function prefetchAndEstimateCost(
  arxivId: string,
  options: PipelineOptions
): Promise<{
  estimate: CostEstimate;
  bundle: PaperTeXBundle;
  structured: StructuredPaper;
}> {
  // Fetch TeX source
  const bundle = await fetchAndExtractTeX(arxivId);
  
  // Resolve includes
  const mainTex = bundle.texFiles[bundle.mainTexFilename];
  const resolvedTex = resolveTexIncludes(mainTex, bundle.texFiles);
  
  // Load custom macros before parsing
  setCustomMacros(bundle.customMacros);
  
  // Parse structure (deterministic, no LLM)
  const structured = parseLatexToStructuredPaper(resolvedTex, bundle.metadata);
  
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
    // Stage 4: Research
    // ========================================
    onStageChange('research');
    log('research', 'Identifying research gaps...');
    
    questions = await callResearchQuestionsAgent(client, structured, skeleton);
    log('research', `Generated ${questions.length} research questions`);
    for (const q of questions.slice(0, 3)) {
      log('research', `  • ${q.question.slice(0, 60)}...`);
    }
    
    onProgress(35);
    
    log('research', `Researching ${questions.length} questions in parallel...`);
    
    // Start web research in parallel with question answering (if enabled)
    let webResearchPromise: Promise<ExternalResearch | null>;
    if (options.enableWebSearch) {
      log('research', 'Web search enabled — researching authors and discussions...');
      webResearchPromise = callWebResearchAgent(
        client,
        structured.title,
        structured.authors,
        structured.abstract
      ).catch(e => {
        log('research', `Web research failed (non-critical): ${e}`);
        return null;
      });
    } else {
      log('research', 'Web search disabled — skipping external research');
      webResearchPromise = Promise.resolve(null);
    }
    
    // Process all research questions in parallel
    const researchPromises = questions.map(async (question) => {
      try {
        return await callResearchAnswerAgent(client, question, structured.title);
      } catch (e) {
        log('research', `Failed to answer question ${question.id}: ${e}`);
        return {
          questionId: question.id,
          answer: 'Could not research this question due to an error.',
          sources: [],
        };
      }
    });
    
    // Wait for both to complete
    const [researchResults, webResearchResult] = await Promise.all([
      Promise.all(researchPromises),
      webResearchPromise,
    ]);
    
    researchNotes = researchResults;
    externalResearch = webResearchResult;
    
    log('research', `Collected ${researchNotes.length} research notes`);
    if (externalResearch) {
      log('research', `Web research: Found ${externalResearch.citations.length} external sources`);
    }
    onProgress(45);
    
    // ========================================
    // Stage 5: Rewrite
    // ========================================
    onStageChange('rewrite');
    log('rewrite', 'Generating YOLO-style rewrite...');
    
    const topLevelSections = structured.sections.filter(s => s.level === 1).length;
    log('rewrite', `Processing ${structured.sections.length} sections (${topLevelSections} top-level) in parallel...`);
    
    rewritten = await callYOLORewriterAgent(
      client,
      structured,
      skeleton,
      researchNotes,
      (completed, total, titles, partialSections) => {
        log('rewrite', `Batch ${completed}/${total} complete: ${titles.slice(0, 2).join(', ')}${titles.length > 2 ? '...' : ''}`);
        const rewriteProgress = 45 + Math.floor((completed / total) * 15);
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
    onProgress(60);
    
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
    
    const finalDocument = assembleFinalDocument(
      bundle,
      structured,
      rewritten,
      figurePlacements,
      researchNotes,
      externalResearch
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
