// ============================================================
// Deterministic LaTeX Parser
// Converts LaTeX source to structured JSON without LLM
// ============================================================

import type { StructuredPaper, StructuredSection, FigureBlock, CustomMacro } from '../types';

// Module-level storage for custom macros (set before parsing)
let activeCustomMacros: CustomMacro[] = [];

/**
 * Set custom macros to be used during parsing
 * Call this before parseLatexToStructuredPaper
 */
export function setCustomMacros(macros: CustomMacro[] | undefined): void {
  activeCustomMacros = macros || [];
  if (activeCustomMacros.length > 0) {
    console.log(`[TexParser] Loaded ${activeCustomMacros.length} custom macros for expansion`);
  }
}

/**
 * Parse LaTeX source into structured paper representation
 * This is deterministic - no LLM needed
 */
export function parseLatexToStructuredPaper(
  tex: string,
  metadata: { title: string; authors: string[]; abstract: string }
): StructuredPaper {
  // Extract abstract if not provided
  const abstract = metadata.abstract || extractAbstract(tex);
  
  // Extract all sections hierarchically
  const sections = extractSections(tex);
  
  // Extract all figures
  const figures = extractFigures(tex);
  
  // Extract references section if present
  const refsTex = extractReferences(tex);
  
  return {
    title: metadata.title,
    authors: metadata.authors,
    abstract,
    sections,
    figures,
    refsTex,
  };
}

/**
 * Extract abstract from LaTeX
 */
function extractAbstract(tex: string): string {
  const match = tex.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
  if (match) {
    return cleanTextContent(match[1]);
  }
  return '';
}

/**
 * Extract all sections hierarchically
 */
function extractSections(tex: string): StructuredSection[] {
  const sections: StructuredSection[] = [];
  
  // Find document body
  const docMatch = tex.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  const docBody = docMatch ? docMatch[1] : tex;
  
  // Pattern to match section commands
  const sectionPattern = /\\(section|subsection|subsubsection)\*?\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  
  // Find all section markers with their positions
  const sectionMarkers: Array<{
    level: 1 | 2 | 3;
    title: string;
    position: number;
  }> = [];
  
  let match;
  while ((match = sectionPattern.exec(docBody)) !== null) {
    const levelMap: Record<string, 1 | 2 | 3> = {
      'section': 1,
      'subsection': 2,
      'subsubsection': 3,
    };
    
    sectionMarkers.push({
      level: levelMap[match[1]],
      title: cleanTextContent(match[2]),
      position: match.index + match[0].length,
    });
  }
  
  // If no sections found, treat entire document as one section
  if (sectionMarkers.length === 0) {
    const content = removeEnvironments(docBody, ['abstract', 'figure', 'table']);
    return [{
      id: 'sec-main',
      title: 'Main Content',
      level: 1,
      rawTex: docBody,
      textBlocks: extractTextBlocks(content),
      equations: extractEquations(docBody),
      figures: extractFigureRefs(docBody),
    }];
  }
  
  // Extract content for each section
  for (let i = 0; i < sectionMarkers.length; i++) {
    const marker = sectionMarkers[i];
    const nextMarker = sectionMarkers[i + 1];
    
    const startPos = marker.position;
    const endPos = nextMarker ? nextMarker.position - getMatchLength(docBody, nextMarker.position) : docBody.length;
    
    const rawTex = docBody.slice(startPos, endPos);
    const contentTex = removeEnvironments(rawTex, ['figure', 'table']);
    
    const sectionId = generateSectionId(marker.title, i);
    
    sections.push({
      id: sectionId,
      title: marker.title,
      level: marker.level,
      rawTex,
      textBlocks: extractTextBlocks(contentTex),
      equations: extractEquations(rawTex),
      figures: extractFigureRefs(rawTex),
    });
  }
  
  return sections;
}

/**
 * Get the length of the section command that ends at this position
 */
function getMatchLength(tex: string, endPosition: number): number {
  // Look backwards from endPosition to find the start of \section etc
  const before = tex.slice(Math.max(0, endPosition - 200), endPosition);
  const match = before.match(/\\(?:section|subsection|subsubsection)\*?\{[^}]*\}$/);
  return match ? match[0].length : 0;
}

/**
 * Generate a clean section ID
 */
function generateSectionId(title: string, index: number): string {
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  
  return `sec-${cleanTitle || index}`;
}

/**
 * Extract text blocks from content (paragraphs)
 */
function extractTextBlocks(tex: string): string[] {
  const blocks: string[] = [];
  
  // Remove comments
  let content = tex.replace(/%[^\n]*/g, '');
  
  // Remove equation environments but keep inline math
  content = content.replace(/\\begin\{(?:equation|align|gather|multline)\*?\}[\s\S]*?\\end\{(?:equation|align|gather|multline)\*?\}/g, '');
  content = content.replace(/\\\[[\s\S]*?\\\]/g, '');
  
  // Split into paragraphs (double newlines)
  const paragraphs = content.split(/\n\s*\n/);
  
  for (const para of paragraphs) {
    const cleaned = cleanTextContent(para);
    if (cleaned.length > 20) { // Skip very short fragments
      blocks.push(cleaned);
    }
  }
  
  return blocks;
}

/**
 * Clean math content to remove LaTeX-only commands that KaTeX doesn't support
 * This makes equations renderable in the browser
 */
export function cleanMathContent(math: string): string {
  let cleaned = math;
  
  // First, expand custom macros from the paper's preamble
  cleaned = expandCustomMacros(cleaned);
  
  // ============================================================
  // Expand common math macros that KaTeX might not understand
  // ============================================================
  
  // Common calligraphic/script letters
  cleaned = cleaned.replace(/\\Inv(?![a-zA-Z])/g, '\\mathcal{I}');
  cleaned = cleaned.replace(/\\Trans(?![a-zA-Z])/g, '\\mathcal{T}');
  cleaned = cleaned.replace(/\\Aut(?![a-zA-Z])/g, '\\mathrm{Aut}');
  cleaned = cleaned.replace(/\\Hom(?![a-zA-Z])/g, '\\mathrm{Hom}');
  cleaned = cleaned.replace(/\\End(?![a-zA-Z])/g, '\\mathrm{End}');
  cleaned = cleaned.replace(/\\Ker(?![a-zA-Z])/g, '\\mathrm{Ker}');
  cleaned = cleaned.replace(/\\Im(?![a-zA-Z])/g, '\\mathrm{Im}');
  cleaned = cleaned.replace(/\\Span(?![a-zA-Z])/g, '\\mathrm{Span}');
  cleaned = cleaned.replace(/\\rank(?![a-zA-Z])/g, '\\mathrm{rank}');
  cleaned = cleaned.replace(/\\tr(?![a-zA-Z])/g, '\\mathrm{tr}');
  cleaned = cleaned.replace(/\\diag(?![a-zA-Z])/g, '\\mathrm{diag}');
  cleaned = cleaned.replace(/\\sign(?![a-zA-Z])/g, '\\mathrm{sign}');
  cleaned = cleaned.replace(/\\supp(?![a-zA-Z])/g, '\\mathrm{supp}');
  
  // Tilde and hat variants (common shortcuts) - KaTeX uses \tilde not \Tilde
  cleaned = cleaned.replace(/\\Tilde\{([^}]*)\}/g, '\\tilde{$1}');
  cleaned = cleaned.replace(/\\Hat\{([^}]*)\}/g, '\\hat{$1}');
  cleaned = cleaned.replace(/\\Bar\{([^}]*)\}/g, '\\bar{$1}');
  cleaned = cleaned.replace(/\\Vec\{([^}]*)\}/g, '\\vec{$1}');
  cleaned = cleaned.replace(/\\Dot\{([^}]*)\}/g, '\\dot{$1}');
  cleaned = cleaned.replace(/\\Ddot\{([^}]*)\}/g, '\\ddot{$1}');
  cleaned = cleaned.replace(/\\wimark\{([^}]*)\}/g, '\\widetilde{$1}');
  
  // Bold math
  cleaned = cleaned.replace(/\\bm\{([^}]*)\}/g, '\\mathbf{$1}');
  cleaned = cleaned.replace(/\\boldsymbol\{([^}]*)\}/g, '\\boldsymbol{$1}');
  
  // Number sets
  cleaned = cleaned.replace(/\\R(?![a-zA-Z])/g, '\\mathbb{R}');
  cleaned = cleaned.replace(/\\N(?![a-zA-Z])/g, '\\mathbb{N}');
  cleaned = cleaned.replace(/\\Z(?![a-zA-Z])/g, '\\mathbb{Z}');
  cleaned = cleaned.replace(/\\C(?![a-zA-Z])/g, '\\mathbb{C}');
  cleaned = cleaned.replace(/\\Q(?![a-zA-Z])/g, '\\mathbb{Q}');
  cleaned = cleaned.replace(/\\F(?![a-zA-Z])/g, '\\mathbb{F}');
  
  // Common operators
  cleaned = cleaned.replace(/\\E(?![a-zA-Z])/g, '\\mathbb{E}');
  cleaned = cleaned.replace(/\\Var(?![a-zA-Z])/g, '\\mathrm{Var}');
  cleaned = cleaned.replace(/\\Cov(?![a-zA-Z])/g, '\\mathrm{Cov}');
  cleaned = cleaned.replace(/\\Prob(?![a-zA-Z])/g, '\\mathbb{P}');
  cleaned = cleaned.replace(/\\argmin(?![a-zA-Z])/g, '\\mathop{\\arg\\min}');
  cleaned = cleaned.replace(/\\argmax(?![a-zA-Z])/g, '\\mathop{\\arg\\max}');
  
  // Norms and absolute values
  cleaned = cleaned.replace(/\\norm\{([^}]*)\}/g, '\\|$1\\|');
  cleaned = cleaned.replace(/\\abs\{([^}]*)\}/g, '|$1|');
  cleaned = cleaned.replace(/\\inner\{([^}]*)\}\{([^}]*)\}/g, '\\langle $1, $2 \\rangle');
  cleaned = cleaned.replace(/\\ip\{([^}]*)\}\{([^}]*)\}/g, '\\langle $1, $2 \\rangle');
  cleaned = cleaned.replace(/\\floor\{([^}]*)\}/g, '\\lfloor $1 \\rfloor');
  cleaned = cleaned.replace(/\\ceil\{([^}]*)\}/g, '\\lceil $1 \\rceil');
  
  // Greek shortcuts
  cleaned = cleaned.replace(/\\eps(?![a-zA-Z])/g, '\\varepsilon');
  cleaned = cleaned.replace(/\\vphi(?![a-zA-Z])/g, '\\varphi');
  
  // Definition symbols
  cleaned = cleaned.replace(/\\coloneqq/g, ':=');
  cleaned = cleaned.replace(/\\defeq/g, ':=');
  cleaned = cleaned.replace(/\\eqdef/g, ':=');
  
  // Fractions
  cleaned = cleaned.replace(/\\nicefrac\{([^}]*)\}\{([^}]*)\}/g, '{$1}/{$2}');
  cleaned = cleaned.replace(/\\sfrac\{([^}]*)\}\{([^}]*)\}/g, '{$1}/{$2}');
  
  // ============================================================
  // Remove LaTeX-only commands that KaTeX doesn't support
  // ============================================================
  
  // Remove \label{...} commands (cross-referencing)
  cleaned = cleaned.replace(/\\label\{[^}]*\}/g, '');
  
  // Remove \tag{...} commands (custom equation numbering)
  cleaned = cleaned.replace(/\\tag\{[^}]*\}/g, '');
  
  // Remove \nonumber and \notag commands
  cleaned = cleaned.replace(/\\nonumber/g, '');
  cleaned = cleaned.replace(/\\notag/g, '');
  
  // Remove \allowbreak and other formatting hints
  cleaned = cleaned.replace(/\\allowbreak/g, '');
  cleaned = cleaned.replace(/\\displaybreak(?:\[[^\]]*\])?/g, '');
  
  // Remove \intertext{...} (text between align rows)
  cleaned = cleaned.replace(/\\intertext\{[^}]*\}/g, '');
  
  // Remove \qedhere (QED symbol placement)
  cleaned = cleaned.replace(/\\qedhere/g, '');
  
  // Remove spacing commands that might cause issues
  cleaned = cleaned.replace(/\\(?:medskip|bigskip|smallskip)/g, '');
  
  // Clean up multiple whitespace/newlines
  cleaned = cleaned.replace(/\n\s*\n/g, '\n');
  
  return cleaned.trim();
}

/**
 * Extract equations from content
 */
function extractEquations(tex: string): string[] {
  const equations: string[] = [];
  
  // Display equations: \begin{equation}...\end{equation}, \[...\], etc.
  const displayPatterns = [
    /\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g,
    /\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g,
    /\\begin\{gather\*?\}([\s\S]*?)\\end\{gather\*?\}/g,
    /\\\[([\s\S]*?)\\\]/g,
  ];
  
  for (const pattern of displayPatterns) {
    let match;
    while ((match = pattern.exec(tex)) !== null) {
      // Clean the math content to remove LaTeX-only commands
      equations.push(cleanMathContent(match[1]));
    }
  }
  
  return equations;
}

/**
 * Extract figure references from content
 */
function extractFigureRefs(tex: string): string[] {
  const refs: string[] = [];
  const pattern = /\\(?:ref|autoref|cref)\{(fig:[^}]+)\}/g;
  
  let match;
  while ((match = pattern.exec(tex)) !== null) {
    if (!refs.includes(match[1])) {
      refs.push(match[1]);
    }
  }
  
  return refs;
}

/**
 * Extract all figures from the document
 */
function extractFigures(tex: string): FigureBlock[] {
  const figures: FigureBlock[] = [];
  
  // Match figure environments
  const figurePattern = /\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g;
  
  let match;
  let figIndex = 0;
  while ((match = figurePattern.exec(tex)) !== null) {
    figIndex++;
    const rawTex = match[0];
    const content = match[1];
    
    // Extract label
    const labelMatch = content.match(/\\label\{([^}]+)\}/);
    const id = labelMatch ? labelMatch[1] : `fig:fig${figIndex}`;
    
    // Extract caption
    const captionMatch = content.match(/\\caption\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
    const caption = captionMatch ? cleanTextContent(captionMatch[1]) : '';
    
    // Extract included graphics
    const assetFilenames: string[] = [];
    const graphicsPattern = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
    let graphicsMatch;
    while ((graphicsMatch = graphicsPattern.exec(content)) !== null) {
      assetFilenames.push(graphicsMatch[1]);
    }
    
    figures.push({
      id,
      caption,
      rawTex,
      assetFilenames,
    });
  }
  
  return figures;
}

/**
 * Extract references/bibliography section
 */
function extractReferences(tex: string): string | undefined {
  // Match bibliography or thebibliography
  const bibMatch = tex.match(/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/);
  if (bibMatch) {
    return bibMatch[0];
  }
  
  // Or bibliography command
  const biblioMatch = tex.match(/\\bibliography\{[^}]+\}/);
  if (biblioMatch) {
    return biblioMatch[0];
  }
  
  return undefined;
}

/**
 * Remove specific environments from content
 */
function removeEnvironments(tex: string, envNames: string[]): string {
  let result = tex;
  
  for (const envName of envNames) {
    const pattern = new RegExp(
      `\\\\begin\\{${envName}\\*?\\}[\\s\\S]*?\\\\end\\{${envName}\\*?\\}`,
      'g'
    );
    result = result.replace(pattern, '');
  }
  
  return result;
}

/**
 * Expand custom macros extracted from the paper's preamble
 * Handles macros with 0-9 arguments
 */
function expandCustomMacros(text: string): string {
  if (activeCustomMacros.length === 0) {
    return text;
  }
  
  let result = text;
  let iterations = 0;
  const maxIterations = 10; // Prevent infinite loops from recursive macros
  
  // Keep expanding until no more changes (handles nested macros)
  let changed = true;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    
    for (const macro of activeCustomMacros) {
      const before = result;
      
      if (macro.numArgs === 0) {
        // Simple macro with no arguments: \macroname -> replacement
        // Use word boundary to avoid partial matches
        const pattern = new RegExp(`\\\\${escapeRegex(macro.name)}(?![a-zA-Z@])`, 'g');
        result = result.replace(pattern, macro.replacement);
      } else {
        // Macro with arguments: \macroname{arg1}{arg2}...
        result = expandMacroWithArgs(result, macro);
      }
      
      if (result !== before) {
        changed = true;
      }
    }
  }
  
  if (iterations >= maxIterations) {
    console.warn('[TexParser] Max macro expansion iterations reached, possible recursive macro');
  }
  
  return result;
}

/**
 * Expand a single macro that has arguments
 */
function expandMacroWithArgs(text: string, macro: CustomMacro): string {
  // Build pattern: \macroname followed by {arg1}{arg2}... 
  // Each argument can contain nested braces
  const argPattern = '\\{((?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*)\\}';
  
  // Handle optional first argument if present
  let pattern: string;
  if (macro.optionalArg !== undefined) {
    // Optional arg: \macro[opt]{arg1}...
    const optArgPattern = '(?:\\[([^\\]]*)\\])?';
    const requiredArgs = Array(macro.numArgs - 1).fill(argPattern).join('\\s*');
    pattern = `\\\\${escapeRegex(macro.name)}${optArgPattern}\\s*${requiredArgs || ''}`;
  } else {
    // All required args: \macro{arg1}{arg2}...
    const argsPatterns = Array(macro.numArgs).fill(argPattern).join('\\s*');
    pattern = `\\\\${escapeRegex(macro.name)}\\s*${argsPatterns}`;
  }
  
  const regex = new RegExp(pattern, 'g');
  
  return text.replace(regex, (...matches) => {
    let replacement = macro.replacement;
    
    // matches: [fullMatch, arg1, arg2, ..., offset, string]
    // For optional args: [fullMatch, optArg, arg1, arg2, ...]
    const hasOptional = macro.optionalArg !== undefined;
    
    if (hasOptional) {
      // Handle optional argument
      const optValue = matches[1] ?? macro.optionalArg;
      replacement = replacement.replace(/#1/g, optValue);
      
      // Handle remaining arguments (#2, #3, etc -> become #1, #2 in replacement context)
      for (let i = 2; i <= macro.numArgs; i++) {
        const argValue = matches[i] || '';
        replacement = replacement.replace(new RegExp(`#${i}`, 'g'), argValue);
      }
    } else {
      // Handle required arguments
      for (let i = 1; i <= macro.numArgs; i++) {
        const argValue = matches[i] || '';
        replacement = replacement.replace(new RegExp(`#${i}`, 'g'), argValue);
      }
    }
    
    return replacement;
  });
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Clean LaTeX content to readable text
 */
function cleanTextContent(tex: string): string {
  let text = tex;
  
  // Remove comments
  text = text.replace(/%[^\n]*/g, '');
  
  // ============================================================
  // EXPAND CUSTOM MACROS FROM PREAMBLE (highest priority)
  // These are paper-specific definitions
  // ============================================================
  text = expandCustomMacros(text);
  
  // ============================================================
  // EXPAND COMMON LATEX MACROS (before general cleaning)
  // These are frequently used in math/CS papers
  // ============================================================
  
  // Common calligraphic/script letters (often custom-defined)
  text = text.replace(/\\Inv(?![a-zA-Z])/g, '\\mathcal{I}');
  text = text.replace(/\\Trans(?![a-zA-Z])/g, '\\mathcal{T}');
  text = text.replace(/\\Aut(?![a-zA-Z])/g, '\\text{Aut}');
  text = text.replace(/\\Hom(?![a-zA-Z])/g, '\\text{Hom}');
  text = text.replace(/\\End(?![a-zA-Z])/g, '\\text{End}');
  text = text.replace(/\\Ker(?![a-zA-Z])/g, '\\text{Ker}');
  text = text.replace(/\\Im(?![a-zA-Z])/g, '\\text{Im}');
  text = text.replace(/\\Span(?![a-zA-Z])/g, '\\text{Span}');
  text = text.replace(/\\rank(?![a-zA-Z])/g, '\\text{rank}');
  text = text.replace(/\\tr(?![a-zA-Z])/g, '\\text{tr}');
  text = text.replace(/\\diag(?![a-zA-Z])/g, '\\text{diag}');
  text = text.replace(/\\sign(?![a-zA-Z])/g, '\\text{sign}');
  text = text.replace(/\\supp(?![a-zA-Z])/g, '\\text{supp}');
  
  // Tilde and hat variants (common shortcuts)
  text = text.replace(/\\Tilde\{([^}]*)\}/g, '\\tilde{$1}');
  text = text.replace(/\\Hat\{([^}]*)\}/g, '\\hat{$1}');
  text = text.replace(/\\Bar\{([^}]*)\}/g, '\\bar{$1}');
  text = text.replace(/\\Vec\{([^}]*)\}/g, '\\vec{$1}');
  text = text.replace(/\\Dot\{([^}]*)\}/g, '\\dot{$1}');
  text = text.replace(/\\Ddot\{([^}]*)\}/g, '\\ddot{$1}');
  // Also handle without braces (single char)
  text = text.replace(/\\Tilde(?![a-zA-Z{])/g, '\\tilde');
  text = text.replace(/\\Hat(?![a-zA-Z{])/g, '\\hat');
  text = text.replace(/\\Bar(?![a-zA-Z{])/g, '\\bar');
  
  // Bold math variants
  text = text.replace(/\\bm\{([^}]*)\}/g, '\\mathbf{$1}');
  text = text.replace(/\\boldsymbol\{([^}]*)\}/g, '\\mathbf{$1}');
  
  // Domain/set notation (common in math papers)
  text = text.replace(/\\domain/g, '\\Omega');
  text = text.replace(/\\genset/g, 'A');
  text = text.replace(/\\gensetalt/g, 'B');
  text = text.replace(/\\ball/g, 'B');
  text = text.replace(/\\ssd/g, 'S');
  text = text.replace(/\\ssdboundary/g, '\\partial S');
  
  // Number sets
  text = text.replace(/\\R(?![a-zA-Z])/g, '\\mathbb{R}');
  text = text.replace(/\\N(?![a-zA-Z])/g, '\\mathbb{N}');
  text = text.replace(/\\Z(?![a-zA-Z])/g, '\\mathbb{Z}');
  text = text.replace(/\\C(?![a-zA-Z])/g, '\\mathbb{C}');
  text = text.replace(/\\Q(?![a-zA-Z])/g, '\\mathbb{Q}');
  text = text.replace(/\\F(?![a-zA-Z])/g, '\\mathbb{F}');
  text = text.replace(/\\reals(?![a-zA-Z])/g, '\\mathbb{R}');
  text = text.replace(/\\naturals(?![a-zA-Z])/g, '\\mathbb{N}');
  text = text.replace(/\\integers(?![a-zA-Z])/g, '\\mathbb{Z}');
  text = text.replace(/\\complex(?![a-zA-Z])/g, '\\mathbb{C}');
  
  // Common math operators
  text = text.replace(/\\coloneqq/g, ':=');
  text = text.replace(/\\defeq/g, ':=');
  text = text.replace(/\\eqdef/g, ':=');
  text = text.replace(/\\triangleq/g, '\\triangleq');
  text = text.replace(/\\norm\{([^}]*)\}/g, '\\|$1\\|');
  text = text.replace(/\\abs\{([^}]*)\}/g, '|$1|');
  text = text.replace(/\\inner\{([^}]*)\}\{([^}]*)\}/g, '\\langle $1, $2 \\rangle');
  text = text.replace(/\\ip\{([^}]*)\}\{([^}]*)\}/g, '\\langle $1, $2 \\rangle');
  text = text.replace(/\\floor\{([^}]*)\}/g, '\\lfloor $1 \\rfloor');
  text = text.replace(/\\ceil\{([^}]*)\}/g, '\\lceil $1 \\rceil');
  text = text.replace(/\\set\{([^}]*)\}/g, '\\{$1\\}');
  text = text.replace(/\\card\{([^}]*)\}/g, '|$1|');
  
  // Probability and statistics
  text = text.replace(/\\E(?![a-zA-Z])/g, '\\mathbb{E}');
  text = text.replace(/\\Var(?![a-zA-Z])/g, '\\text{Var}');
  text = text.replace(/\\Cov(?![a-zA-Z])/g, '\\text{Cov}');
  text = text.replace(/\\Prob(?![a-zA-Z])/g, '\\mathbb{P}');
  text = text.replace(/\\expectation\{([^}]*)\}/g, '\\mathbb{E}[$1]');
  text = text.replace(/\\Var\[([^\]]*)\]/g, '\\text{Var}[$1]');
  text = text.replace(/\\iid(?![a-zA-Z])/g, '\\text{i.i.d.}');
  text = text.replace(/\\KL(?![a-zA-Z])/g, 'D_{\\text{KL}}');
  
  // Function/operator shortcuts
  text = text.replace(/\\closest\{([^}]*)\}/g, 'closest($1)');
  text = text.replace(/\\argmin(?![a-zA-Z])/g, '\\arg\\min');
  text = text.replace(/\\argmax(?![a-zA-Z])/g, '\\arg\\max');
  text = text.replace(/\\softmax(?![a-zA-Z])/g, '\\text{softmax}');
  text = text.replace(/\\relu(?![a-zA-Z])/g, '\\text{ReLU}');
  text = text.replace(/\\sgn(?![a-zA-Z])/g, '\\text{sgn}');
  
  // Greek letters that might be custom-defined
  text = text.replace(/\\eps(?![a-zA-Z])/g, '\\varepsilon');
  text = text.replace(/\\vphi(?![a-zA-Z])/g, '\\varphi');
  
  // PDE-specific (from Walk on Stars paper)
  text = text.replace(/\\green/g, 'G');
  text = text.replace(/\\poisson/g, 'P');
  text = text.replace(/\\direction/g, 'v');
  text = text.replace(/\\lapl(?![a-zA-Z])/g, '\\Delta');
  text = text.replace(/\\grad(?![a-zA-Z])/g, '\\nabla');
  text = text.replace(/\\curl(?![a-zA-Z])/g, '\\nabla \\times');
  text = text.replace(/\\divg(?![a-zA-Z])/g, '\\nabla \\cdot');
  
  // Algorithm/procedure notation (common in ML papers)
  text = text.replace(/\\Proc(?![a-zA-Z])/g, 'Procedure');
  text = text.replace(/\\proc(?![a-zA-Z])/g, 'procedure');
  text = text.replace(/\\Alg(?![a-zA-Z])/g, 'Algorithm');
  text = text.replace(/\\alg(?![a-zA-Z])/g, 'algorithm');
  
  // Nicefrac for proper fractions
  text = text.replace(/\\nicefrac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
  text = text.replace(/\\sfrac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
  text = text.replace(/\\tfrac\{([^}]*)\}\{([^}]*)\}/g, '\\frac{$1}{$2}');
  text = text.replace(/\\dfrac\{([^}]*)\}\{([^}]*)\}/g, '\\frac{$1}{$2}');
  
  // ============================================================
  // Handle common text formatting commands
  // ============================================================
  text = text.replace(/\\textbf\{([^}]*)\}/g, '$1');
  text = text.replace(/\\textit\{([^}]*)\}/g, '$1');
  text = text.replace(/\\emph\{([^}]*)\}/g, '$1');
  text = text.replace(/\\texttt\{([^}]*)\}/g, '$1');
  text = text.replace(/\\textrm\{([^}]*)\}/g, '$1');
  text = text.replace(/\\textsf\{([^}]*)\}/g, '$1');
  text = text.replace(/\\underline\{([^}]*)\}/g, '$1');
  
  // Handle citations - keep them as [citation]
  text = text.replace(/\\cite\{([^}]*)\}/g, '[$1]');
  text = text.replace(/\\citep?\{([^}]*)\}/g, '[$1]');
  text = text.replace(/\\citet?\{([^}]*)\}/g, '[$1]');
  
  // Handle references
  text = text.replace(/\\ref\{([^}]*)\}/g, '[$1]');
  text = text.replace(/\\autoref\{([^}]*)\}/g, '[$1]');
  text = text.replace(/\\cref\{([^}]*)\}/g, '[$1]');
  
  // Handle footnotes - inline them
  text = text.replace(/\\footnote\{([^}]*)\}/g, ' ($1)');
  
  // Remove label commands
  text = text.replace(/\\label\{[^}]*\}/g, '');
  
  // ============================================================
  // Remove common LaTeX environments that shouldn't appear in output
  // ============================================================
  text = text.replace(/\\begin\{(?:itemize|enumerate|description)\}/g, '');
  text = text.replace(/\\end\{(?:itemize|enumerate|description)\}/g, '');
  text = text.replace(/\\item(?:\[[^\]]*\])?/g, '• ');
  
  // Remove wrapfigure and other float environments
  text = text.replace(/\\begin\{wrapfigure\}[^\n]*\n?/g, '');
  text = text.replace(/\\end\{wrapfigure\}/g, '');
  text = text.replace(/\\begin\{(?:center|flushleft|flushright)\}/g, '');
  text = text.replace(/\\end\{(?:center|flushleft|flushright)\}/g, '');
  
  // Remove algorithmic/algorithm environments (keep content visible)
  text = text.replace(/\\begin\{algorithm\}[^\n]*/g, '');
  text = text.replace(/\\end\{algorithm\}/g, '');
  text = text.replace(/\\begin\{algorithmic\}[^\n]*/g, '');
  text = text.replace(/\\end\{algorithmic\}/g, '');
  
  // Remove myTitledBox and similar custom environments
  text = text.replace(/\\(?:my)?[Tt]itled[Bb]ox[^{]*\{[^}]*\}/g, '');
  text = text.replace(/\\begin\{(?:tcolorbox|mdframed|framed)\}[^\n]*/g, '');
  text = text.replace(/\\end\{(?:tcolorbox|mdframed|framed)\}/g, '');
  
  // Handle special characters
  text = text.replace(/\\&/g, '&');
  text = text.replace(/\\%/g, '%');
  text = text.replace(/\\\$/g, '$');
  text = text.replace(/\\#/g, '#');
  text = text.replace(/\\_/g, '_');
  text = text.replace(/\\{/g, '{');
  text = text.replace(/\\}/g, '}');
  text = text.replace(/~|\\,|\\;|\\:|\\!/g, ' ');
  text = text.replace(/``|''/g, '"');
  text = text.replace(/`|'/g, "'");
  text = text.replace(/---/g, '—');
  text = text.replace(/--/g, '–');
  
  // Keep inline math intact but clean LaTeX-only commands from it
  // First, protect inline math by replacing with placeholders
  const mathPlaceholders: string[] = [];
  text = text.replace(/\$([^$]+)\$/g, (_, inner) => {
    // Clean the math content before storing
    const cleaned = '$' + cleanMathContent(inner) + '$';
    mathPlaceholders.push(cleaned);
    return `__MATH_${mathPlaceholders.length - 1}__`;
  });
  
  // Also handle display math $$...$$ and \[...\]
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => {
    const cleaned = '$$' + cleanMathContent(inner) + '$$';
    mathPlaceholders.push(cleaned);
    return `__MATH_${mathPlaceholders.length - 1}__`;
  });
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => {
    const cleaned = '\\[' + cleanMathContent(inner) + '\\]';
    mathPlaceholders.push(cleaned);
    return `__MATH_${mathPlaceholders.length - 1}__`;
  });
  
  // Remove remaining LaTeX commands (but not their content) - OUTSIDE of math
  text = text.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1');
  text = text.replace(/\\[a-zA-Z]+\[[^\]]*\]/g, '');
  text = text.replace(/\\[a-zA-Z]+/g, '');
  
  // Remove braces (outside math)
  text = text.replace(/[{}]/g, '');
  
  // Restore math
  text = text.replace(/__MATH_(\d+)__/g, (_, idx) => mathPlaceholders[parseInt(idx)]);
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Get a summary of the parsed structure (for logging)
 */
export function getParseStats(paper: StructuredPaper): {
  sectionCount: number;
  figureCount: number;
  equationCount: number;
  textBlockCount: number;
  totalTextLength: number;
} {
  let equationCount = 0;
  let textBlockCount = 0;
  let totalTextLength = 0;
  
  for (const section of paper.sections) {
    equationCount += section.equations.length;
    textBlockCount += section.textBlocks.length;
    totalTextLength += section.textBlocks.reduce((sum, b) => sum + b.length, 0);
  }
  
  return {
    sectionCount: paper.sections.length,
    figureCount: paper.figures.length,
    equationCount,
    textBlockCount,
    totalTextLength,
  };
}
