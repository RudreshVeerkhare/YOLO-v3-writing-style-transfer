// ============================================================
// Final Document Assembler
// Combines all pieces into arXiv-style HTML
// ============================================================

import type {
  PaperTeXBundle,
  StructuredPaper,
  RewrittenSection,
  FigurePlacement,
  ResearchNote,
  FinalDocument,
  ExternalResearch,
} from '../types';
import { cleanMathContent } from './texParser';

/**
 * Clean math content in HTML string (for KaTeX compatibility)
 */
function cleanMathInHTML(html: string): string {
  // Clean inline math $...$
  html = html.replace(/\$([^$]+)\$/g, (_, inner) => {
    return '$' + cleanMathContent(inner) + '$';
  });
  
  // Clean display math $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => {
    return '$$' + cleanMathContent(inner) + '$$';
  });
  
  // Clean \[...\] display math
  html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => {
    return '\\[' + cleanMathContent(inner) + '\\]';
  });
  
  // Clean \(...\) inline math
  html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => {
    return '\\(' + cleanMathContent(inner) + '\\)';
  });
  
  return html;
}

/**
 * Assembles the final HTML document from all components
 */
export function assembleFinalDocument(
  bundle: PaperTeXBundle,
  structured: StructuredPaper,
  rewrittenSections: RewrittenSection[],
  figurePlacements: FigurePlacement[],
  researchNotes: ResearchNote[],
  externalResearch?: ExternalResearch | null
): FinalDocument {
  const html = buildHTML(
    bundle,
    structured,
    rewrittenSections,
    figurePlacements,
    researchNotes,
    externalResearch
  );
  
  return {
    html,
    meta: {
      title: bundle.metadata.title,
      authors: bundle.metadata.authors,
      arxivId: bundle.arxivId,
      generationDate: new Date().toISOString(),
    },
  };
}

/**
 * Assembles a partial HTML document for work-in-progress preview
 * Shows completed sections with a "loading more..." indicator
 */
export function assemblePartialDocument(
  bundle: PaperTeXBundle,
  structured: StructuredPaper,
  completedSections: RewrittenSection[],
  totalSections: number
): FinalDocument {
  const html = buildPartialHTML(
    bundle,
    structured,
    completedSections,
    totalSections
  );
  
  return {
    html,
    meta: {
      title: bundle.metadata.title,
      authors: bundle.metadata.authors,
      arxivId: bundle.arxivId,
      generationDate: new Date().toISOString(),
    },
  };
}

/**
 * Build a partial HTML document for work-in-progress preview
 * Now includes figures for better preview experience
 */
function buildPartialHTML(
  bundle: PaperTeXBundle,
  structured: StructuredPaper,
  completedSections: RewrittenSection[],
  totalSections: number
): string {
  const remainingSections = totalSections - completedSections.length;
  const progressPercent = Math.round((completedSections.length / totalSections) * 100);
  
  // Create figure lookup for inline figure replacement
  const figureLookup = new Map(
    structured.figures.map(f => [f.id, f])
  );
  
  // Build sections HTML WITH figures
  const sectionsHTML = completedSections.map(section => {
    // Clean any math in the HTML to remove LaTeX-only commands
    let html = cleanMathInHTML(section.html);
    
    // Replace inline figure placeholders with actual figures
    html = html.replace(/<figure\s+data-figure-id="([^"]+)"[^>]*>(?:<\/figure>)?/g, (_match, figId) => {
      const figure = figureLookup.get(figId);
      if (figure) {
        return buildFigureHTML(figure, bundle.assets);
      }
      return `<span class="figure-ref">[Figure: ${figId}]</span>`;
    });
    
    return `
      <section id="${section.id}">
        ${html}
      </section>
    `;
  }).join('\n');
  
  // Loading indicator for remaining sections
  const loadingIndicator = remainingSections > 0 ? `
    <div class="loading-more">
      <div class="loading-spinner"></div>
      <p>Rewriting ${remainingSections} more section${remainingSections !== 1 ? 's' : ''}...</p>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progressPercent}%"></div>
      </div>
      <p class="progress-text">${progressPercent}% complete</p>
    </div>
  ` : '';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(bundle.metadata.title)} (Work in Progress)</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
  <style>
    ${getArxivStyleCSS()}
    
    .wip-banner {
      background: linear-gradient(135deg, #fff3cd 0%, #ffeeba 100%);
      border: 1px solid #ffc107;
      border-radius: 8px;
      padding: 1em;
      margin-bottom: 2em;
      display: flex;
      align-items: center;
      gap: 1em;
    }
    
    .wip-banner .icon {
      font-size: 2em;
    }
    
    .loading-more {
      text-align: center;
      padding: 3em;
      color: #666;
      border-top: 2px dashed #ddd;
      margin-top: 2em;
    }
    
    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #f3f3f3;
      border-top: 4px solid #e63946;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1em;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .progress-bar {
      width: 200px;
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      margin: 1em auto;
      overflow: hidden;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #e63946, #f77f00);
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    
    .progress-text {
      font-size: 0.9em;
      color: #888;
    }
  </style>
</head>
<body>
  <article class="arxiv-article">
    <header class="article-header">
      <h1 class="article-title">${escapeHTML(bundle.metadata.title)}</h1>
      <p class="article-subtitle">YOLO-Style Rewrite</p>
      <div class="article-authors">
        ${bundle.metadata.authors.map(a => `<span class="author">${escapeHTML(a)}</span>`).join(', ')}
      </div>
      <div class="article-meta">
        <span class="arxiv-id">Original: <a href="https://arxiv.org/abs/${bundle.arxivId}" target="_blank">arXiv:${bundle.arxivId}</a></span>
      </div>
      <div class="wip-banner">
        <span class="icon">🚧</span>
        <div>
          <strong>Work in Progress</strong>
          <p style="margin: 0.25em 0 0 0; font-size: 0.9em;">
            ${completedSections.length} of ${totalSections} sections completed. 
            You can start reading while the rest is being generated.
          </p>
        </div>
      </div>
    </header>
    
    <main class="article-body">
      ${sectionsHTML}
      ${loadingIndicator}
    </main>
  </article>
  
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(document.body, {
          delimiters: [
            {left: "$$", right: "$$", display: true},
            {left: "$", right: "$", display: false},
            {left: "\\\\[", right: "\\\\]", display: true},
            {left: "\\\\(", right: "\\\\)", display: false}
          ],
          throwOnError: false
        });
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Build the complete HTML document
 */
function buildHTML(
  bundle: PaperTeXBundle,
  structured: StructuredPaper,
  rewrittenSections: RewrittenSection[],
  figurePlacements: FigurePlacement[],
  researchNotes: ResearchNote[],
  externalResearch?: ExternalResearch | null
): string {
  // Build reference list from research notes
  const references = buildReferenceList(researchNotes);
  
  // Create figure lookup
  const figureLookup = new Map(
    structured.figures.map(f => [f.id, f])
  );
  
  // Create placement lookup
  const placementBySection = new Map<string, FigurePlacement[]>();
  for (const placement of figurePlacements) {
    const existing = placementBySection.get(placement.placedInSectionId) || [];
    existing.push(placement);
    placementBySection.set(placement.placedInSectionId, existing);
  }
  
  // Build sections with figures
  const sectionsHTML = rewrittenSections.map(section => {
    // Clean any math in the HTML to remove LaTeX-only commands
    let html = cleanMathInHTML(section.html);
    
    // Replace all inline figure placeholders in the HTML
    // Match both <figure data-figure-id="..."></figure> and <figure data-figure-id="..."/>
    html = html.replace(/<figure\s+data-figure-id="([^"]+)"[^>]*>(?:<\/figure>)?/g, (_match, figId) => {
      const figure = figureLookup.get(figId);
      if (figure) {
        return buildFigureHTML(figure, bundle.assets);
      }
      // If figure not found, show a placeholder reference
      return `<span class="figure-ref">[Figure: ${figId}]</span>`;
    });
    
    // Insert figures for this section based on placement hints
    const sectionPlacements = placementBySection.get(section.id) || [];
    const topFigures: string[] = [];
    const bottomFigures: string[] = [];
    
    for (const placement of sectionPlacements) {
      const figure = figureLookup.get(placement.figureId);
      if (!figure) continue;
      
      const figureHTML = buildFigureHTML(figure, bundle.assets);
      
      if (placement.placementHint === 'top') {
        topFigures.push(figureHTML);
      } else if (placement.placementHint === 'bottom') {
        bottomFigures.push(figureHTML);
      } else {
        // Inline placement - already handled above, add at bottom as fallback
        bottomFigures.push(figureHTML);
      }
    }
    
    // Combine section content with figures
    return `
      <section id="${section.id}">
        ${topFigures.join('\n')}
        ${html}
        ${bottomFigures.join('\n')}
      </section>
    `;
  }).join('\n');
  
  // Build the full document
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(bundle.metadata.title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
  <style>
    ${getArxivStyleCSS()}
  </style>
</head>
<body>
  <article class="arxiv-article">
    <header class="article-header">
      <h1 class="article-title">${escapeHTML(bundle.metadata.title)}</h1>
      <p class="article-subtitle">YOLOv3-Style Rewrite</p>
      <div class="article-authors">
        ${bundle.metadata.authors.map(a => `<span class="author">${escapeHTML(a)}</span>`).join(', ')}
      </div>
      <div class="article-meta">
        <span class="arxiv-id">Original: <a href="https://arxiv.org/abs/${bundle.arxivId}" target="_blank">arXiv:${bundle.arxivId}</a></span>
        <span class="generation-date">Generated: ${new Date().toLocaleDateString()}</span>
      </div>
      <div class="disclaimer">
        <strong>⚠️ Disclaimer:</strong> This is an AI-generated rewrite for educational purposes.
        Refer to the <a href="https://arxiv.org/abs/${bundle.arxivId}" target="_blank">original paper</a> for authoritative content.
      </div>
    </header>
    
    <main class="article-body">
      ${sectionsHTML}
      
      ${externalResearch ? `
      <section id="sec-external-research" class="external-research-section">
        <h2>🌐 External Context & Resources</h2>
        <p class="section-intro">Additional context gathered from web research about this paper, its authors, and related discussions.</p>
        
        ${externalResearch.authorInfo ? `
        <div class="research-block">
          <h3>👤 About the Authors</h3>
          <div class="research-content">${markdownToHTML(externalResearch.authorInfo)}</div>
        </div>
        ` : ''}
        
        ${externalResearch.relatedDiscussions ? `
        <div class="research-block">
          <h3>💬 Community Discussions</h3>
          <div class="research-content">${markdownToHTML(externalResearch.relatedDiscussions)}</div>
        </div>
        ` : ''}
        
        ${externalResearch.practicalApplications ? `
        <div class="research-block">
          <h3>🔧 Practical Applications</h3>
          <div class="research-content">${markdownToHTML(externalResearch.practicalApplications)}</div>
        </div>
        ` : ''}
        
        ${externalResearch.citations.length > 0 ? `
        <div class="research-block">
          <h3>🔗 Sources</h3>
          <ul class="external-sources">
            ${externalResearch.citations.map(c => `
              <li><a href="${escapeHTML(c.url)}" target="_blank" rel="noopener">${escapeHTML(c.title)}</a></li>
            `).join('\n')}
          </ul>
        </div>
        ` : ''}
      </section>
      ` : ''}
      
      ${references.length > 0 ? `
      <section id="sec-references-extra" class="references-section">
        <h2>References (Additional Research)</h2>
        <ol class="reference-list">
          ${references.map((ref, i) => `
            <li id="ref-${i + 1}">
              ${escapeHTML(ref.title)}
              ${ref.venue ? `<em>${escapeHTML(ref.venue)}</em>` : ''}
              <a href="${escapeHTML(ref.url)}" target="_blank" rel="noopener">[link]</a>
              ${ref.note ? `<span class="ref-note">— ${escapeHTML(ref.note)}</span>` : ''}
            </li>
          `).join('\n')}
        </ol>
      </section>
      ` : ''}
    </main>
    
    <footer class="article-footer">
      <p>Generated using YOLOv3-Style Paper Rewriter</p>
      <p>Original work by: ${bundle.metadata.authors.join(', ')}</p>
    </footer>
  </article>
  
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(document.body, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false},
            {left: '\\\\[', right: '\\\\]', display: true},
            {left: '\\\\(', right: '\\\\)', display: false}
          ],
          throwOnError: false
        });
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Build HTML for a figure
 * Handles PDF figures by looking for alternative formats (PNG, JPG, etc.)
 */
function buildFigureHTML(
  figure: { id: string; caption: string; assetFilenames: string[] },
  assets: Record<string, string>
): string {
  // Find matching asset with better matching logic
  let imgSrc = '';
  let isPdf = false;
  let matchedFilename = '';
  
  for (const filename of figure.assetFilenames) {
    // Normalize filename (remove path, lowercase)
    const normalizedTarget = filename.toLowerCase().replace(/^.*\//, '');
    const targetBase = normalizedTarget.replace(/\.[^.]+$/, '');
    
    // Try exact match first
    if (assets[filename]) {
      imgSrc = assets[filename];
      isPdf = filename.toLowerCase().endsWith('.pdf');
      matchedFilename = filename;
      break;
    }
    
    // Try matching by base name (without extension)
    for (const [key, value] of Object.entries(assets)) {
      const normalizedKey = key.toLowerCase().replace(/^.*\//, '');
      const keyBase = normalizedKey.replace(/\.[^.]+$/, '');
      
      // Match if base names are similar
      if (keyBase === targetBase || 
          keyBase.includes(targetBase) || 
          targetBase.includes(keyBase)) {
        imgSrc = value;
        isPdf = key.toLowerCase().endsWith('.pdf');
        matchedFilename = key;
        break;
      }
    }
    if (imgSrc) break;
  }
  
  // If we found a PDF, try to find an alternative image format
  if (isPdf || (imgSrc && imgSrc.startsWith('data:application/pdf'))) {
    const altImgSrc = findAlternativeImageFormat(figure, assets, matchedFilename);
    if (altImgSrc) {
      return `
        <figure id="${figure.id}" class="article-figure">
          <img src="${altImgSrc}" alt="${escapeHTML(figure.caption)}" loading="lazy">
          <figcaption><strong>Figure ${figure.id.replace('fig:', '')}:</strong> ${escapeHTML(figure.caption)}</figcaption>
        </figure>
      `;
    }
    
    // No alternative found - show informative placeholder
    // Extract just the filename for display
    const displayFilename = figure.assetFilenames[0]?.split('/').pop() || figure.id;
    return `
      <figure id="${figure.id}" class="article-figure">
        <div class="figure-placeholder pdf-figure">
          <div class="pdf-icon-large">📊</div>
          <div class="pdf-label">Vector Figure (PDF)</div>
          <div class="pdf-filename">${escapeHTML(displayFilename)}</div>
          <div class="pdf-hint">PDF figures require a PDF viewer. See the original paper on arXiv for this figure.</div>
        </div>
        <figcaption><strong>Figure ${figure.id.replace('fig:', '')}:</strong> ${escapeHTML(figure.caption)}</figcaption>
      </figure>
    `;
  }
  
  return `
    <figure id="${figure.id}" class="article-figure">
      ${imgSrc 
        ? `<img src="${imgSrc}" alt="${escapeHTML(figure.caption)}" loading="lazy">`
        : `<div class="figure-placeholder">
            <span class="missing-icon">🖼️</span>
            <span>Figure not found</span>
            <small>${escapeHTML(figure.assetFilenames.join(', ') || figure.id)}</small>
          </div>`
      }
      <figcaption><strong>Figure ${figure.id.replace('fig:', '')}:</strong> ${escapeHTML(figure.caption)}</figcaption>
    </figure>
  `;
}

/**
 * Try to find an alternative image format for a PDF figure
 * Many arXiv papers include both PDF and PNG/JPG versions
 */
function findAlternativeImageFormat(
  figure: { id: string; caption: string; assetFilenames: string[] },
  assets: Record<string, string>,
  pdfFilename: string
): string | null {
  // Get the base filename without extension and path
  const baseFromPdf = pdfFilename
    .replace(/\.[^.]+$/, '')
    .replace(/^.*\//, '')
    .toLowerCase();
  
  // Also try the figure ID as a base
  const baseFromId = figure.id
    .replace(/^fig:/, '')
    .toLowerCase();
  
  // Look for various image formats
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  
  // Collect all potential matches with scores
  const candidates: Array<{ key: string; value: string; score: number }> = [];
  
  for (const [key, value] of Object.entries(assets)) {
    const keyLower = key.toLowerCase();
    const keyBase = keyLower.replace(/\.[^.]+$/, '').replace(/^.*\//, '');
    const keyExt = '.' + (keyLower.split('.').pop() || '');
    
    // Skip non-image files
    if (!imageExtensions.includes(keyExt)) continue;
    
    let score = 0;
    
    // Exact base match with PDF filename
    if (keyBase === baseFromPdf) {
      score += 100;
    } else if (keyBase.includes(baseFromPdf) || baseFromPdf.includes(keyBase)) {
      score += 50;
    }
    
    // Match with figure ID
    if (keyBase === baseFromId) {
      score += 80;
    } else if (keyBase.includes(baseFromId) || baseFromId.includes(keyBase)) {
      score += 40;
    }
    
    // Check if any of the assetFilenames match
    for (const assetName of figure.assetFilenames) {
      const assetBase = assetName.replace(/\.[^.]+$/, '').replace(/^.*\//, '').toLowerCase();
      if (keyBase === assetBase) {
        score += 90;
      } else if (keyBase.includes(assetBase) || assetBase.includes(keyBase)) {
        score += 45;
      }
    }
    
    // Prefer PNG over JPG over others
    if (keyExt === '.png') score += 5;
    else if (keyExt === '.jpg' || keyExt === '.jpeg') score += 4;
    else if (keyExt === '.svg') score += 3;
    
    if (score > 0) {
      candidates.push({ key, value, score });
    }
  }
  
  // Sort by score and return best match
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].value;
  }
  
  return null;
}

/**
 * Build reference list from research notes
 */
function buildReferenceList(researchNotes: ResearchNote[]): Array<{
  title: string;
  url: string;
  venue?: string;
  note?: string;
}> {
  const seen = new Set<string>();
  const refs: Array<{ title: string; url: string; venue?: string; note?: string }> = [];
  
  for (const note of researchNotes) {
    for (const source of note.sources) {
      if (!seen.has(source.url)) {
        seen.add(source.url);
        refs.push(source);
      }
    }
  }
  
  return refs;
}

/**
 * Escape HTML special characters
 */
function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Convert markdown-style text to HTML for research content
 * Handles: links, bold, italic, bullet lists, numbered lists, headers, line breaks
 */
function markdownToHTML(text: string): string {
  let html = escapeHTML(text);
  
  // Convert markdown links [text](url) to HTML links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Convert **bold** and __bold__
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  
  // Convert *italic* and _italic_ (but not inside URLs which have underscores)
  html = html.replace(/(?<![a-zA-Z0-9])\*([^*]+)\*(?![a-zA-Z0-9])/g, '<em>$1</em>');
  
  // Convert `code` to <code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Convert headers (### Header)
  html = html.replace(/^#### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h4>$1</h4>');
  
  // Convert horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');
  
  // Convert bullet lists (- item or * item)
  // First, identify list blocks and wrap them
  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)$/);
    const numberedMatch = line.match(/^[\s]*(\d+)\.\s+(.+)$/);
    
    if (bulletMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>');
        result.push('<ul class="research-list">');
        inList = true;
        listType = 'ul';
      }
      result.push(`<li>${bulletMatch[1]}</li>`);
    } else if (numberedMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(listType === 'ol' ? '</ol>' : '</ul>');
        result.push('<ol class="research-list">');
        inList = true;
        listType = 'ol';
      }
      result.push(`<li>${numberedMatch[2]}</li>`);
    } else {
      if (inList) {
        result.push(listType === 'ol' ? '</ol>' : '</ul>');
        inList = false;
        listType = null;
      }
      // Convert double newlines to paragraphs, single newlines to <br>
      if (line.trim() === '') {
        result.push('</p><p>');
      } else {
        result.push(line);
      }
    }
  }
  
  if (inList) {
    result.push(listType === 'ol' ? '</ol>' : '</ul>');
  }
  
  html = '<p>' + result.join('\n') + '</p>';
  
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*<(ul|ol)/g, '<$1');
  html = html.replace(/<\/(ul|ol)>\s*<\/p>/g, '</$1>');
  html = html.replace(/<p>\s*<h/g, '<h');
  html = html.replace(/<\/h(\d)>\s*<\/p>/g, '</h$1>');
  html = html.replace(/<p>\s*<hr>/g, '<hr>');
  html = html.replace(/<hr>\s*<\/p>/g, '<hr>');
  
  return html;
}

/**
 * Get arXiv-style CSS
 */
function getArxivStyleCSS(): string {
  return `
    :root {
      --text-color: #333;
      --bg-color: #fff;
      --accent-color: #b31b1b;
      --border-color: #ddd;
      --code-bg: #f5f5f5;
    }
    
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Computer Modern Serif', 'Latin Modern Roman', 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.6;
      color: var(--text-color);
      background: var(--bg-color);
      margin: 0;
      padding: 20px;
    }
    
    .arxiv-article {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    
    .article-header {
      text-align: center;
      margin-bottom: 2em;
      padding-bottom: 1em;
      border-bottom: 1px solid var(--border-color);
    }
    
    .article-title {
      font-size: 1.8em;
      font-weight: normal;
      margin-bottom: 0.5em;
      line-height: 1.3;
    }
    
    .article-subtitle {
      font-size: 1em;
      color: var(--accent-color);
      font-style: italic;
      margin: 0.5em 0;
    }
    
    .article-authors {
      font-size: 1.1em;
      margin: 1em 0;
    }
    
    .author {
      display: inline-block;
      margin: 0 0.5em;
    }
    
    .article-meta {
      font-size: 0.9em;
      color: #666;
      margin: 1em 0;
    }
    
    .article-meta span {
      display: inline-block;
      margin: 0 1em;
    }
    
    .disclaimer {
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 4px;
      padding: 10px 15px;
      margin: 1em auto;
      max-width: 600px;
      font-size: 0.9em;
    }
    
    .article-body section {
      margin: 2em 0;
    }
    
    h2 {
      font-size: 1.4em;
      font-weight: bold;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.3em;
    }
    
    h3 {
      font-size: 1.2em;
      font-weight: bold;
      margin-top: 1.2em;
      margin-bottom: 0.4em;
    }
    
    p {
      margin: 0.8em 0;
      text-align: justify;
    }
    
    ul, ol {
      margin: 0.8em 0;
      padding-left: 2em;
    }
    
    li {
      margin: 0.3em 0;
    }
    
    .article-figure {
      margin: 1.5em auto;
      text-align: center;
      max-width: 100%;
    }
    
    .article-figure img {
      max-width: 100%;
      height: auto;
      border: 1px solid var(--border-color);
    }
    
    .article-figure figcaption {
      font-size: 0.9em;
      margin-top: 0.5em;
      color: #555;
      text-align: left;
      padding: 0 1em;
    }
    
    .figure-placeholder {
      background: var(--code-bg);
      border: 1px dashed var(--border-color);
      padding: 2em;
      color: #666;
      font-style: italic;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5em;
      min-height: 150px;
      justify-content: center;
    }
    
    .figure-placeholder .pdf-icon,
    .figure-placeholder .missing-icon {
      font-size: 2em;
    }
    
    .figure-placeholder small {
      font-size: 0.8em;
      color: #999;
      word-break: break-all;
    }
    
    .pdf-figure {
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 1.5em 2em;
      min-height: 120px;
    }
    
    .pdf-figure .pdf-icon-large {
      font-size: 2.5em;
      margin-bottom: 0.25em;
    }
    
    .pdf-figure .pdf-label {
      font-size: 1em;
      font-weight: 600;
      color: #92400e;
      font-style: normal;
    }
    
    .pdf-figure .pdf-filename {
      font-size: 0.85em;
      color: #b45309;
      font-family: 'Monaco', 'Menlo', monospace;
      background: rgba(255,255,255,0.5);
      padding: 2px 8px;
      border-radius: 4px;
      margin: 0.5em 0;
    }
    
    .pdf-figure .pdf-hint {
      font-size: 0.75em;
      color: #78350f;
      font-style: italic;
      max-width: 300px;
      text-align: center;
      line-height: 1.4;
    }
    
    .pdf-figure .pdf-note {
      font-size: 0.75em;
      color: #888;
      font-style: italic;
      margin-top: 0.5em;
    }
    
    sup {
      font-size: 0.75em;
    }
    
    sup a {
      color: var(--accent-color);
      text-decoration: none;
    }
    
    sup a:hover {
      text-decoration: underline;
    }
    
    .references-section {
      margin-top: 3em;
      padding-top: 1em;
      border-top: 2px solid var(--border-color);
    }
    
    .external-research-section {
      margin-top: 3em;
      padding: 1.5em;
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      border-radius: 8px;
      border: 1px solid var(--border-color);
    }
    
    .external-research-section h2 {
      margin-top: 0;
      color: var(--accent-color);
    }
    
    .external-research-section .section-intro {
      color: #666;
      font-style: italic;
      margin-bottom: 1.5em;
    }
    
    .research-block {
      margin: 1.5em 0;
      padding: 1em;
      background: white;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    
    .research-block h3 {
      margin: 0 0 0.75em 0;
      font-size: 1.1em;
      color: #333;
    }
    
    .research-content {
      color: #444;
      line-height: 1.7;
    }
    
    .research-content p {
      margin: 0.6em 0;
    }
    
    .research-content h4, .research-content h5 {
      margin: 1em 0 0.5em 0;
      color: #333;
    }
    
    .research-content a {
      color: var(--accent-color);
      text-decoration: none;
    }
    
    .research-content a:hover {
      text-decoration: underline;
    }
    
    .research-content code {
      background: #f1f5f9;
      padding: 0.1em 0.4em;
      border-radius: 3px;
      font-size: 0.9em;
    }
    
    .research-content strong {
      color: #333;
    }
    
    .research-list {
      margin: 0.8em 0;
      padding-left: 1.5em;
    }
    
    .research-list li {
      margin: 0.4em 0;
      line-height: 1.5;
    }
    
    .research-content hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 1em 0;
    }
    
    .external-sources {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    
    .external-sources li {
      margin: 0.5em 0;
      padding-left: 1.5em;
      position: relative;
    }
    
    .external-sources li::before {
      content: "🔗";
      position: absolute;
      left: 0;
      font-size: 0.9em;
    }
    
    .external-sources a {
      color: var(--accent-color);
      text-decoration: none;
    }
    
    .external-sources a:hover {
      text-decoration: underline;
    }
    
    .reference-list {
      font-size: 0.9em;
    }
    
    .reference-list li {
      margin: 0.5em 0;
      padding-left: 0.5em;
    }
    
    .reference-list a {
      color: var(--accent-color);
      margin-left: 0.5em;
    }
    
    .ref-note {
      color: #666;
      font-style: italic;
      display: block;
      margin-left: 1em;
    }
    
    .article-footer {
      margin-top: 3em;
      padding-top: 1em;
      border-top: 1px solid var(--border-color);
      text-align: center;
      font-size: 0.9em;
      color: #666;
    }
    
    /* KaTeX overrides */
    .katex-display {
      margin: 1em 0;
      overflow-x: auto;
    }
    
    /* Code blocks if any */
    pre, code {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
      background: var(--code-bg);
      border-radius: 3px;
    }
    
    pre {
      padding: 1em;
      overflow-x: auto;
    }
    
    code {
      padding: 0.2em 0.4em;
    }
    
    /* Responsive */
    @media (max-width: 600px) {
      body {
        padding: 10px;
        font-size: 10pt;
      }
      
      .arxiv-article {
        padding: 10px;
      }
      
      .article-title {
        font-size: 1.4em;
      }
    }
    
    /* Print styles */
    @media print {
      body {
        font-size: 10pt;
      }
      
      .disclaimer {
        display: none;
      }
      
      a {
        color: inherit;
        text-decoration: none;
      }
      
      .article-figure img {
        max-height: 300px;
      }
    }
  `;
}

/**
 * Convert final document to downloadable markdown
 */
export function convertToMarkdown(doc: FinalDocument): string {
  // Simple HTML to Markdown conversion
  let md = doc.html
    // Remove HTML tags but keep content
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<header[\s\S]*?<\/header>/g, '')
    .replace(/<footer[\s\S]*?<\/footer>/g, '')
    .replace(/<h1[^>]*>(.*?)<\/h1>/g, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/g, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/g, '### $1\n\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gs, '$1\n\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gs, '- $1\n')
    .replace(/<ul[^>]*>|<\/ul>/g, '\n')
    .replace(/<ol[^>]*>|<\/ol>/g, '\n')
    .replace(/<figure[^>]*>[\s\S]*?<\/figure>/g, '[Figure]\n\n')
    .replace(/<section[^>]*>|<\/section>/g, '\n')
    .replace(/<article[^>]*>|<\/article>/g, '')
    .replace(/<main[^>]*>|<\/main>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  // Add header
  const header = `---
title: ${doc.meta.title}
authors: ${doc.meta.authors.join(', ')}
arxiv_id: ${doc.meta.arxivId}
generated: ${doc.meta.generationDate}
---

# ${doc.meta.title}

**YOLOv3-Style Rewrite**

Original: [arXiv:${doc.meta.arxivId}](https://arxiv.org/abs/${doc.meta.arxivId})

---

`;

  return header + md;
}
