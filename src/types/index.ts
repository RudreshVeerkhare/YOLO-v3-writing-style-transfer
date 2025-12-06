// ============================================================
// Data Models for YOLO-Style Paper Rewriter
// ============================================================

/**
 * Bundle containing all extracted content from an arXiv paper's TeX source
 */
export type PaperTeXBundle = {
  arxivId: string;
  mainTexFilename: string;
  texFiles: Record<string, string>; // filename -> content
  assets: Record<string, string>;   // filename -> base64 data URL or blob URL
  metadata: {
    title: string;
    authors: string[];
    abstract: string;
    year?: number;
    primaryCategory?: string;
  };
  customMacros?: CustomMacro[]; // Extracted from preamble
};

/**
 * A custom LaTeX macro definition extracted from the preamble
 */
export type CustomMacro = {
  name: string;           // e.g., 'Inv' for \Inv
  numArgs: number;        // number of arguments (0-9)
  optionalArg?: string;   // default value for optional first arg
  replacement: string;    // the replacement text with #1, #2, etc.
};

/**
 * A figure block extracted from LaTeX source
 */
export type FigureBlock = {
  id: string; // from \label{fig:...}
  caption: string;
  rawTex: string; // the full \begin{figure}...\end{figure}
  assetFilenames: string[]; // e.g. ['fig1.png']
};

/**
 * A structured section from the paper
 */
export type StructuredSection = {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  rawTex: string;
  textBlocks: string[]; // plain-ish text
  equations: string[];  // tex math
  figures: string[];    // figure ids
};

/**
 * The complete structured representation of a paper
 */
export type StructuredPaper = {
  title: string;
  authors: string[];
  abstract: string;
  sections: StructuredSection[];
  figures: FigureBlock[];
  refsTex?: string;
};

/**
 * Semantic skeleton capturing the paper's core concepts
 */
export type SemanticSkeleton = {
  problemStatement: string;
  motivation: string;
  contributions: string[];
  methodSummary: string;
  experimentSummary: string;
  explicitLimitations: string[];
  inferredLimitations: string[];
};

/**
 * A research question identified in the paper
 */
export type ResearchQuestion = {
  id: string;
  question: string;
  whyImportant: string;
};

/**
 * Research note answering a question with sources
 */
export type ResearchNote = {
  questionId: string;
  answer: string;
  sources: ResearchSource[];
};

export type ResearchSource = {
  title: string;
  url: string;
  venue?: string;
  note?: string;
};

/**
 * External research from web search about authors, talks, related work
 */
export type ExternalResearch = {
  authorInfo: string;       // About the authors - background, other work, talks
  relatedDiscussions: string;  // Blog posts, HN threads, Twitter discussions
  practicalApplications: string; // Real-world uses, implementations, tutorials
  citations: Array<{ url: string; title: string }>;
};

/**
 * A rewritten section in HTML format
 */
export type RewrittenSection = {
  id: string; // maps to StructuredSection.id or synthetic
  title: string;
  html: string; // YOLO-style rewrite with our structure
};

/**
 * Figure placement decision
 */
export type FigurePlacement = {
  figureId: string;
  placedInSectionId: string;
  placementHint: "top" | "bottom" | "inline";
};

/**
 * A critique issue found by the Critique Agent
 */
export type CritiqueIssue = {
  severity: "minor" | "major";
  location: { sectionId: string; snippet?: string };
  kind: "factual" | "style" | "hallucination" | "missing";
  message: string;
  suggestion?: string;
};

/**
 * The final assembled document
 */
export type FinalDocument = {
  html: string;
  meta: {
    title: string;
    authors: string[];
    arxivId: string;
    generationDate: string;
  };
};

// ============================================================
// Pipeline Status Types
// ============================================================

export type PipelineStage =
  | "idle"
  | "ingestion"
  | "structure"
  | "semantics"
  | "research"
  | "rewrite"
  | "figures"
  | "critique"
  | "assembly"
  | "done"
  | "error";

export type LogEntry = {
  timestamp: string;
  stage: PipelineStage;
  message: string;
};

export type PipelineStatus = {
  currentStage: PipelineStage;
  logs: LogEntry[];
  progress: number; // 0-100
  error?: string;
  streamingContent?: string;
};

// ============================================================
// Agent Response Types (for JSON parsing)
// Note: Structure parsing is now deterministic (texParser.ts)
// ============================================================

export type SemanticMapAgentResponse = SemanticSkeleton;

export type ResearchQuestionsAgentResponse = {
  questions: ResearchQuestion[];
};

export type ResearchAnswerAgentResponse = ResearchNote;

export type YOLORewriterAgentResponse = {
  sections: RewrittenSection[];
};

export type FigureMappingAgentResponse = {
  placements: FigurePlacement[];
};

export type CritiqueAgentResponse = {
  issues: CritiqueIssue[];
};

export type PatchAgentResponse = {
  sections: RewrittenSection[];
};
