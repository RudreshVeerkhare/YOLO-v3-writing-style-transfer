// ============================================================
// arXiv TeX Fetcher and Extractor
// Uses fflate for decompression in browser
// ============================================================

import { gunzipSync, unzipSync } from 'fflate';
import type { PaperTeXBundle, CustomMacro } from '../types';

// CORS proxy options - arXiv blocks direct browser requests
const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

export type FetchProgressCallback = (message: string) => void;

/**
 * Fetches and extracts TeX source from arXiv
 */
export async function fetchAndExtractTeX(
  arxivId: string,
  onProgress?: FetchProgressCallback
): Promise<PaperTeXBundle> {
  const sourceUrl = `https://arxiv.org/e-print/${arxivId}`;
  const log = onProgress || (() => {});
  
  let tarballData: ArrayBuffer | null = null;
  let lastError: Error | null = null;
  
  // Try direct fetch first (may work with browser extensions)
  log(`Connecting to arXiv for paper ${arxivId}...`);
  try {
    const response = await fetch(sourceUrl);
    if (response.ok) {
      log('Direct connection successful, downloading...');
      tarballData = await response.arrayBuffer();
      log(`Downloaded ${Math.round(tarballData.byteLength / 1024)} KB`);
    }
  } catch (e) {
    log('Direct fetch blocked, trying CORS proxy...');
  }
  
  // Try CORS proxies
  if (!tarballData) {
    for (let i = 0; i < CORS_PROXIES.length; i++) {
      const proxy = CORS_PROXIES[i];
      log(`Trying proxy ${i + 1}/${CORS_PROXIES.length}...`);
      try {
        const proxyUrl = `${proxy}${encodeURIComponent(sourceUrl)}`;
        const response = await fetch(proxyUrl);
        if (response.ok) {
          log('Proxy connection successful, downloading...');
          tarballData = await response.arrayBuffer();
          log(`Downloaded ${Math.round(tarballData.byteLength / 1024)} KB`);
          break;
        }
      } catch (e) {
        lastError = e as Error;
        log(`Proxy ${i + 1} failed, ${i < CORS_PROXIES.length - 1 ? 'trying next...' : 'no more proxies'}`);
      }
    }
  }
  
  if (!tarballData) {
    throw new Error(
      `Failed to fetch arXiv source. CORS restrictions may be blocking the request. ` +
      `Try using a browser extension like "CORS Unblock" or run a local CORS proxy. ` +
      `Last error: ${lastError?.message || 'Unknown'}`
    );
  }
  
  // Extract the tarball
  log('Extracting archive...');
  const files = await extractTarGz(new Uint8Array(tarballData));
  log(`Extracted ${Object.keys(files).length} files`);
  
  // Separate TeX files from assets
  const texFiles: Record<string, string> = {};
  const assets: Record<string, string> = {};
  
  for (const [filename, content] of Object.entries(files)) {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    
    if (['tex', 'sty', 'cls', 'bib', 'bbl', 'bst'].includes(ext)) {
      // Text files - decode as UTF-8
      texFiles[filename] = new TextDecoder('utf-8').decode(content);
    } else if (['png', 'jpg', 'jpeg', 'gif', 'pdf', 'eps', 'svg'].includes(ext)) {
      // Binary assets - convert to data URL
      const mimeType = getMimeType(ext);
      const base64 = arrayBufferToBase64(content);
      assets[filename] = `data:${mimeType};base64,${base64}`;
    }
  }
  
  // Find main TeX file
  const mainTexFilename = findMainTexFile(texFiles);
  
  // Extract metadata from main TeX
  const mainTex = texFiles[mainTexFilename];
  const metadata = extractMetadata(mainTex);
  
  // Extract custom macros from preamble (main file + any .sty files)
  const customMacros = extractCustomMacros(texFiles, mainTexFilename);
  
  return {
    arxivId,
    mainTexFilename,
    texFiles,
    assets,
    metadata,
    customMacros,
  };
}

/**
 * Extracts a tar.gz or tar archive
 */
async function extractTarGz(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  let tarData: Uint8Array;
  
  // Check if it's gzipped (magic bytes: 1f 8b)
  if (data[0] === 0x1f && data[1] === 0x8b) {
    try {
      tarData = gunzipSync(data);
    } catch (e) {
      console.error('Failed to gunzip, trying as raw data:', e);
      tarData = data;
    }
  } 
  // Check if it's a zip file (magic bytes: PK)
  else if (data[0] === 0x50 && data[1] === 0x4b) {
    try {
      const unzipped = unzipSync(data);
      return unzipped;
    } catch (e) {
      console.error('Failed to unzip:', e);
      throw new Error('Failed to extract ZIP archive');
    }
  }
  // Assume raw tar or single TeX file
  else {
    // Check if it looks like a tar file
    if (looksLikeTar(data)) {
      tarData = data;
    } else {
      // Single TeX file
      return { 'main.tex': data };
    }
  }
  
  // Parse tar archive
  return parseTar(tarData);
}

/**
 * Check if data looks like a tar file
 */
function looksLikeTar(data: Uint8Array): boolean {
  // TAR files have 'ustar' at offset 257
  if (data.length > 262) {
    const ustarMagic = new TextDecoder().decode(data.slice(257, 262));
    if (ustarMagic === 'ustar') return true;
  }
  // Also check for null padding typical in tar
  return data.length > 512 && data[100] === 0;
}

/**
 * Parse a tar archive
 */
function parseTar(data: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let offset = 0;
  
  while (offset < data.length - 512) {
    // Read header (512 bytes)
    const header = data.slice(offset, offset + 512);
    
    // Check for empty block (end of archive)
    if (header.every(b => b === 0)) {
      break;
    }
    
    // Extract filename (first 100 bytes, null-terminated)
    let filename = '';
    for (let i = 0; i < 100 && header[i] !== 0; i++) {
      filename += String.fromCharCode(header[i]);
    }
    
    // Skip if no filename
    if (!filename) {
      offset += 512;
      continue;
    }
    
    // Extract file size (octal string at offset 124, 12 bytes)
    let sizeStr = '';
    for (let i = 124; i < 136 && header[i] !== 0 && header[i] !== 32; i++) {
      sizeStr += String.fromCharCode(header[i]);
    }
    const fileSize = parseInt(sizeStr, 8) || 0;
    
    // Extract type flag (offset 156)
    const typeFlag = header[156];
    
    // Move past header
    offset += 512;
    
    // Only process regular files (type 0 or ASCII '0')
    if (typeFlag === 0 || typeFlag === 48) {
      if (fileSize > 0 && offset + fileSize <= data.length) {
        files[filename] = data.slice(offset, offset + fileSize);
      }
    }
    
    // Move to next 512-byte boundary
    const paddedSize = Math.ceil(fileSize / 512) * 512;
    offset += paddedSize;
  }
  
  return files;
}

/**
 * Find the main TeX file in the bundle
 */
function findMainTexFile(texFiles: Record<string, string>): string {
  const texFilenames = Object.keys(texFiles).filter(f => f.endsWith('.tex'));
  
  if (texFilenames.length === 0) {
    throw new Error('No .tex files found in the archive');
  }
  
  if (texFilenames.length === 1) {
    return texFilenames[0];
  }
  
  // Score each file
  const scores: Record<string, number> = {};
  
  for (const filename of texFilenames) {
    const content = texFiles[filename];
    let score = 0;
    
    // Has \begin{document}
    if (content.includes('\\begin{document}')) score += 10;
    
    // Has \documentclass
    if (content.includes('\\documentclass')) score += 5;
    
    // Has title/author
    if (content.includes('\\title{')) score += 3;
    if (content.includes('\\author{')) score += 3;
    
    // Has abstract
    if (content.includes('\\begin{abstract}')) score += 3;
    
    // Named main.tex or similar
    const lowerName = filename.toLowerCase();
    if (lowerName === 'main.tex') score += 5;
    if (lowerName === 'paper.tex') score += 4;
    if (lowerName === 'article.tex') score += 4;
    
    // Penalize if it's just an input file
    if (content.includes('\\input{') && !content.includes('\\begin{document}')) score -= 5;
    
    scores[filename] = score;
  }
  
  // Return highest scoring file
  return texFilenames.reduce((best, curr) => 
    (scores[curr] > scores[best]) ? curr : best
  );
}

/**
 * Extract metadata from TeX content
 */
function extractMetadata(tex: string): PaperTeXBundle['metadata'] {
  // Extract title
  const titleMatch = tex.match(/\\title\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
  const title = titleMatch ? cleanLatex(titleMatch[1]) : 'Unknown Title';
  
  // Extract authors using robust multi-format parser
  const authors = parseAuthors(tex);
  
  // Extract abstract
  const abstractMatch = tex.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
  const abstract = abstractMatch ? cleanLatex(abstractMatch[1]) : '';
  
  return {
    title,
    authors,
    abstract,
  };
}

/**
 * Parse authors from TeX source - handles many common formats
 */
function parseAuthors(tex: string): string[] {
  const authors: string[] = [];
  
  // Strategy 1: Multiple \author{Name} commands (authblk package style)
  // Matches: \author{Name}, \author[1]{Name}, \author[1,2]{Name}
  const multiAuthorPattern = /\\author(?:\[[^\]]*\])?\{([^}]+)\}/g;
  let multiMatch;
  const multiAuthors: string[] = [];
  while ((multiMatch = multiAuthorPattern.exec(tex)) !== null) {
    const name = cleanAuthorName(multiMatch[1]);
    if (name && !multiAuthors.includes(name)) {
      multiAuthors.push(name);
    }
  }
  
  // If we found multiple \author commands, use them
  if (multiAuthors.length > 1) {
    return multiAuthors;
  }
  
  // Strategy 2: Single \author{} block with \and separators or other delimiters
  const singleAuthorMatch = tex.match(/\\author\{([\s\S]*?)\}(?=\s*(?:\\|%|\n\s*\n|$))/);
  if (singleAuthorMatch) {
    const authorBlock = singleAuthorMatch[1];
    
    // Try splitting by \and first
    if (authorBlock.includes('\\and')) {
      const parts = authorBlock.split(/\\and/);
      for (const part of parts) {
        const name = cleanAuthorName(part);
        if (name && !authors.includes(name)) {
          authors.push(name);
        }
      }
      if (authors.length > 0) return authors;
    }
    
    // Try splitting by \\ (line breaks often separate authors)
    if (authorBlock.includes('\\\\')) {
      const parts = authorBlock.split(/\\\\+/);
      for (const part of parts) {
        const name = cleanAuthorName(part);
        if (name && !authors.includes(name)) {
          authors.push(name);
        }
      }
      if (authors.length > 0) return authors;
    }
    
    // Try splitting by \name{} pattern (some templates)
    const namePattern = /\\name\{([^}]+)\}/g;
    let nameMatch;
    while ((nameMatch = namePattern.exec(authorBlock)) !== null) {
      const name = cleanAuthorName(nameMatch[1]);
      if (name && !authors.includes(name)) {
        authors.push(name);
      }
    }
    if (authors.length > 0) return authors;
    
    // Try comma separation (common in some styles)
    // But be careful not to split "Last, First" style names
    const commaTest = authorBlock.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (commaTest.length > 1) {
      // Check if it looks like "Last, First" format (2 parts, second starts with capital)
      const isLastFirstFormat = commaTest.length === 2 && 
        /^[A-Z]/.test(commaTest[1].trim().replace(/[\\{}]/g, ''));
      
      if (!isLastFirstFormat) {
        for (const part of commaTest) {
          const name = cleanAuthorName(part);
          if (name && !authors.includes(name)) {
            authors.push(name);
          }
        }
        if (authors.length > 0) return authors;
      }
    }
    
    // Fallback: treat the whole block as one author or extract names
    const singleName = cleanAuthorName(authorBlock);
    if (singleName) {
      authors.push(singleName);
    }
  }
  
  // Strategy 3: Look for \Author{} (some LNCS/Springer templates)
  const lncsPattern = /\\Author\{([^}]+)\}/g;
  let lncsMatch;
  while ((lncsMatch = lncsPattern.exec(tex)) !== null) {
    const name = cleanAuthorName(lncsMatch[1]);
    if (name && !authors.includes(name)) {
      authors.push(name);
    }
  }
  
  // Strategy 4: Look for \authorname or similar
  const authorNamePattern = /\\authorname\s*\{([^}]+)\}/gi;
  let authorNameMatch;
  while ((authorNameMatch = authorNamePattern.exec(tex)) !== null) {
    const name = cleanAuthorName(authorNameMatch[1]);
    if (name && !authors.includes(name)) {
      authors.push(name);
    }
  }
  
  return authors.length > 0 ? authors : ['Unknown Author'];
}

/**
 * Clean an individual author name from LaTeX markup
 */
function cleanAuthorName(raw: string): string {
  let name = raw;
  
  // Remove common LaTeX commands but keep their content where appropriate
  name = name
    // Remove \textsuperscript, \thanks, \footnote and their content
    .replace(/\\(?:textsuperscript|thanks|footnote|footnotetext)\{[^}]*\}/g, '')
    // Remove \inst{}, \affiliation{} etc
    .replace(/\\(?:inst|affiliation|affil|address|email|orcid|authororcid)\{[^}]*\}/g, '')
    // Remove optional args like [1,2]
    .replace(/\[[^\]]*\]/g, '')
    // Remove \orcidlink, \orcidicon etc
    .replace(/\\orcid(?:link|icon|ID)?\{[^}]*\}/g, '')
    // Keep content of \textbf, \emph, etc
    .replace(/\\(?:textbf|textit|emph|textrm|textsc|text)\{([^}]*)\}/g, '$1')
    // Remove stray commands
    .replace(/\\[a-zA-Z]+\*/g, '')
    .replace(/\\[a-zA-Z]+(?![a-zA-Z])/g, ' ')
    // Remove braces
    .replace(/[{}]/g, '')
    // Remove superscripts like ^{1} or ^1
    .replace(/\^(?:\{[^}]*\}|\d+)/g, '')
    // Remove affiliations in parentheses at end
    .replace(/\s*\([^)]*(?:university|institute|lab|department|school)[^)]*\)\s*/gi, '')
    // Remove email addresses
    .replace(/\s*[\w.-]+@[\w.-]+\.\w+\s*/g, ' ')
    // Remove URLs
    .replace(/https?:\/\/\S+/g, '')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  // Filter out things that are clearly not names
  // Names should have at least 2 characters and contain letters
  if (name.length < 2 || !/[a-zA-Z]{2,}/.test(name)) {
    return '';
  }
  
  // Filter out affiliation-only entries
  const affiliationKeywords = [
    'university', 'institute', 'college', 'department', 'school',
    'laboratory', 'center', 'centre', 'corp', 'inc', 'ltd',
    'research', 'sciences', 'faculty', 'academia'
  ];
  const lowerName = name.toLowerCase();
  if (affiliationKeywords.some(kw => lowerName.includes(kw))) {
    return '';
  }
  
  // Filter out entries that are just numbers or symbols
  if (/^[\d\s,.*]+$/.test(name)) {
    return '';
  }
  
  return name;
}

/**
 * Clean LaTeX content to plain text
 */
function cleanLatex(tex: string): string {
  return tex
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1') // \cmd{text} -> text
    .replace(/\\[a-zA-Z]+/g, '') // \cmd -> ''
    .replace(/\{|\}/g, '')
    .replace(/\$[^$]+\$/g, '[math]') // inline math
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get MIME type for file extension
 */
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
    'eps': 'application/postscript',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

/**
 * Resolve \input and \include commands to create a single TeX string
 */
export function resolveTexIncludes(
  mainTex: string,
  texFiles: Record<string, string>
): string {
  let resolved = mainTex;
  
  // Handle \input{filename} and \include{filename}
  const includePattern = /\\(?:input|include)\{([^}]+)\}/g;
  let match;
  
  while ((match = includePattern.exec(resolved)) !== null) {
    const includedFile = match[1];
    
    // Try different file name variations
    const variations = [
      includedFile,
      `${includedFile}.tex`,
      includedFile.replace(/\.tex$/, ''),
    ];
    
    let content = '';
    for (const variant of variations) {
      if (texFiles[variant]) {
        content = texFiles[variant];
        break;
      }
    }
    
    if (content) {
      // Recursively resolve includes
      content = resolveTexIncludes(content, texFiles);
      resolved = resolved.replace(match[0], content);
    }
  }
  
  return resolved;
}

/**
 * Extract custom macro definitions from LaTeX preamble
 * Supports: \newcommand, \renewcommand, \def, \DeclareMathOperator
 */
function extractCustomMacros(
  texFiles: Record<string, string>,
  mainTexFilename: string
): CustomMacro[] {
  const macros: CustomMacro[] = [];
  const seenNames = new Set<string>();
  
  // Collect preamble content from main file and any .sty files
  const preambleSources: string[] = [];
  
  // Extract preamble from main file (before \begin{document})
  const mainTex = texFiles[mainTexFilename] || '';
  const docStart = mainTex.indexOf('\\begin{document}');
  if (docStart > 0) {
    preambleSources.push(mainTex.slice(0, docStart));
  } else {
    // No document start, might all be preamble or different format
    preambleSources.push(mainTex);
  }
  
  // Also check .sty files (custom style files often contain macros)
  for (const [filename, content] of Object.entries(texFiles)) {
    if (filename.endsWith('.sty')) {
      preambleSources.push(content);
    }
  }
  
  const fullPreamble = preambleSources.join('\n');
  
  // Pattern for \newcommand{\name}[args]{replacement}
  // Also handles \newcommand*{\name}[args][default]{replacement}
  // and \renewcommand variants
  const newcommandPattern = /\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?\s*(?:\[([^\]]*)\])?\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
  
  let match;
  while ((match = newcommandPattern.exec(fullPreamble)) !== null) {
    const name = match[1];
    const numArgs = match[2] ? parseInt(match[2], 10) : 0;
    const optionalArg = match[3];
    const replacement = match[4];
    
    if (!seenNames.has(name)) {
      seenNames.add(name);
      macros.push({
        name,
        numArgs,
        optionalArg,
        replacement,
      });
    }
  }
  
  // Pattern for \def\name{replacement} (simple, no args)
  // and \def\name#1#2{replacement}
  const defPattern = /\\def\s*\\([a-zA-Z@]+)((?:#\d)*)\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g;
  
  while ((match = defPattern.exec(fullPreamble)) !== null) {
    const name = match[1];
    const argMarkers = match[2];
    const replacement = match[3];
    const numArgs = argMarkers ? (argMarkers.match(/#\d/g) || []).length : 0;
    
    if (!seenNames.has(name)) {
      seenNames.add(name);
      macros.push({
        name,
        numArgs,
        replacement,
      });
    }
  }
  
  // Pattern for \DeclareMathOperator{\name}{text}
  // and \DeclareMathOperator*{\name}{text}
  const mathOpPattern = /\\DeclareMathOperator\*?\s*\{?\\([a-zA-Z@]+)\}?\s*\{([^}]*)\}/g;
  
  while ((match = mathOpPattern.exec(fullPreamble)) !== null) {
    const name = match[1];
    const operatorText = match[2];
    
    if (!seenNames.has(name)) {
      seenNames.add(name);
      macros.push({
        name,
        numArgs: 0,
        replacement: `\\operatorname{${operatorText}}`,
      });
    }
  }
  
  // Log found macros for debugging
  if (macros.length > 0) {
    console.log(`[TeX] Found ${macros.length} custom macros:`, 
      macros.slice(0, 10).map(m => `\\${m.name}[${m.numArgs}]`).join(', '),
      macros.length > 10 ? `... and ${macros.length - 10} more` : ''
    );
  }
  
  return macros;
}
