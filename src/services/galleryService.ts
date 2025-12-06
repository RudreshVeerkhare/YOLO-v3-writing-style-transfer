// ============================================================
// Gallery Service - Upload and fetch papers from public gallery
// ============================================================

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import type { Paper, PaperInsert } from '../types/supabase';
import type { FinalDocument } from '../types';

const BUCKET_NAME = 'yolo-papers';

// Common ML/AI topic keywords for tag generation
const TAG_KEYWORDS: Record<string, string[]> = {
  'machine-learning': ['machine learning', 'ml', 'learning algorithm', 'training'],
  'deep-learning': ['deep learning', 'neural network', 'deep neural', 'dnn'],
  'nlp': ['natural language', 'nlp', 'language model', 'text', 'linguistic', 'bert', 'gpt', 'transformer'],
  'computer-vision': ['computer vision', 'image', 'visual', 'object detection', 'segmentation', 'cnn', 'convolutional'],
  'reinforcement-learning': ['reinforcement learning', 'rl', 'reward', 'policy', 'agent', 'mdp'],
  'generative-ai': ['generative', 'gan', 'diffusion', 'vae', 'autoencoder', 'generation'],
  'llm': ['large language model', 'llm', 'gpt', 'chatgpt', 'claude', 'llama', 'instruction'],
  'transformer': ['transformer', 'attention', 'self-attention', 'multi-head'],
  'optimization': ['optimization', 'gradient', 'sgd', 'adam', 'convergence'],
  'robotics': ['robot', 'robotics', 'manipulation', 'navigation', 'autonomous'],
  'speech': ['speech', 'audio', 'voice', 'acoustic', 'asr', 'tts'],
  'recommendation': ['recommendation', 'collaborative filtering', 'ranking'],
  'graph-neural-networks': ['graph neural', 'gnn', 'graph network', 'node embedding'],
  'federated-learning': ['federated', 'distributed learning', 'privacy-preserving'],
  'explainability': ['explainability', 'interpretable', 'xai', 'attention visualization'],
  'multimodal': ['multimodal', 'multi-modal', 'vision-language', 'cross-modal'],
  'few-shot': ['few-shot', 'zero-shot', 'meta-learning', 'in-context'],
  'fine-tuning': ['fine-tuning', 'fine-tune', 'transfer learning', 'pretrained'],
  'benchmark': ['benchmark', 'dataset', 'evaluation', 'leaderboard'],
  'efficiency': ['efficient', 'lightweight', 'compression', 'pruning', 'quantization'],
};

/**
 * Auto-generate tags based on paper title and abstract
 */
export function generateTagsFromContent(title: string, abstract: string): string[] {
  const content = `${title} ${abstract}`.toLowerCase();
  const tags: string[] = [];
  
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    for (const keyword of keywords) {
      if (content.includes(keyword.toLowerCase())) {
        tags.push(tag);
        break; // Only add tag once
      }
    }
  }
  
  // Limit to top 5 most relevant tags
  return tags.slice(0, 5);
}

export interface PublishOptions {
  document: FinalDocument;
  contributorName?: string;
  contributorTwitter?: string;
  tags?: string[];
}

export interface PublishResult {
  success: boolean;
  publicUrl?: string;
  paperId?: string;
  shareUrl?: string;
  error?: string;
}

export interface GalleryPaper {
  id: string;
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  publicUrl: string;
  version: number;
  versionCount: number;
  contributorName: string | null;
  contributorTwitter: string | null;
  tags: string[];
  viewCount: number;
  createdAt: Date;
}

/**
 * Check if gallery features are available
 */
export function isGalleryAvailable(): boolean {
  return isSupabaseConfigured;
}

/**
 * Publish a document to the public gallery
 */
export async function publishToGallery(options: PublishOptions): Promise<PublishResult> {
  const { document, contributorName, contributorTwitter, tags = [] } = options;
  
  try {
    const supabase = getSupabaseClient();
    const { arxivId, title, authors, originalAbstract } = document.meta;
    
    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50);
    const filename = `${arxivId}/${timestamp}-${sanitizedTitle}.html`;
    
    // Check for existing versions of this paper
    const { data: existingPapers } = await supabase
      .from('papers')
      .select('id, version')
      .eq('arxiv_id', arxivId)
      .order('version', { ascending: false })
      .limit(1);
    
    const existingList = existingPapers as { id: string; version: number }[] | null;
    const latestVersion = existingList?.[0]?.version ?? 0;
    const parentVersionId = existingList?.[0]?.id ?? null;
    const newVersion = latestVersion + 1;
    
    // Upload HTML to storage
    const htmlBlob = new Blob([document.html], { type: 'text/html; charset=utf-8' });
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, htmlBlob, {
        contentType: 'text/html; charset=utf-8',
        cacheControl: '3600',
        upsert: false,
      });
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return { success: false, error: `Upload failed: ${uploadError.message}` };
    }
    
    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(uploadData.path);
    
    const publicUrl = publicUrlData.publicUrl;
    
    // Insert metadata into database
    const paperData: PaperInsert = {
      arxiv_id: arxivId,
      title,
      authors,
      original_abstract: originalAbstract,
      file_path: uploadData.path,
      public_url: publicUrl,
      version: newVersion,
      parent_version_id: parentVersionId,
      contributor_name: contributorName || null,
      contributor_twitter: contributorTwitter || null,
      tags,
    };
    
    const { data: insertedData, error: insertError } = await supabase
      .from('papers')
      .insert(paperData as never)
      .select()
      .single();
    
    if (insertError) {
      console.error('Insert error:', insertError);
      // Try to clean up uploaded file
      await supabase.storage.from(BUCKET_NAME).remove([uploadData.path]);
      return { success: false, error: `Database error: ${insertError.message}` };
    }
    
    const insertedPaper = insertedData as Paper;
    
    // Generate shareable URL (to the gallery page for this paper)
    const shareUrl = `${window.location.origin}/gallery/${insertedPaper.id}`;
    
    // Generate direct embed URL (serves HTML directly)
    const embedUrl = `${window.location.origin}/paper/${insertedPaper.id}`;
    
    return {
      success: true,
      publicUrl: embedUrl, // Use embed URL as the public URL for proper HTML rendering
      paperId: insertedPaper.id,
      shareUrl,
    };
  } catch (error) {
    console.error('Publish error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Fetch all papers for the public gallery
 */
export async function fetchGalleryPapers(options?: {
  limit?: number;
  offset?: number;
  searchQuery?: string;
  tags?: string[];
  sortBy?: 'recent' | 'popular';
}): Promise<{ papers: GalleryPaper[]; total: number }> {
  const supabase = getSupabaseClient();
  const { limit = 20, offset = 0, searchQuery, tags, sortBy = 'recent' } = options ?? {};
  
  // Build query
  let query = supabase
    .from('papers')
    .select('*', { count: 'exact' });
  
  // Apply search filter
  if (searchQuery) {
    query = query.or(`title.ilike.%${searchQuery}%,arxiv_id.ilike.%${searchQuery}%`);
  }
  
  // Apply tag filter
  if (tags && tags.length > 0) {
    query = query.contains('tags', tags);
  }
  
  // Apply sorting
  if (sortBy === 'popular') {
    query = query.order('view_count', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }
  
  // Apply pagination
  query = query.range(offset, offset + limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    console.error('Fetch gallery error:', error);
    throw new Error(`Failed to fetch gallery: ${error.message}`);
  }
  
  const paperList = (data ?? []) as Paper[];
  
  // Group by arxiv_id to get version counts
  const arxivIdVersionCounts = new Map<string, number>();
  
  // Get version counts for each unique arxiv_id
  const uniqueArxivIds = [...new Set(paperList.map(p => p.arxiv_id))];
  
  if (uniqueArxivIds.length > 0) {
    const { data: versionData } = await supabase
      .from('papers')
      .select('arxiv_id')
      .in('arxiv_id', uniqueArxivIds);
    
    const versionList = (versionData ?? []) as { arxiv_id: string }[];
    versionList.forEach(p => {
      arxivIdVersionCounts.set(p.arxiv_id, (arxivIdVersionCounts.get(p.arxiv_id) ?? 0) + 1);
    });
  }
  
  const papers: GalleryPaper[] = paperList.map(paper => ({
    id: paper.id,
    arxivId: paper.arxiv_id,
    title: paper.title,
    authors: paper.authors,
    abstract: paper.original_abstract,
    publicUrl: paper.public_url,
    version: paper.version,
    versionCount: arxivIdVersionCounts.get(paper.arxiv_id) ?? 1,
    contributorName: paper.contributor_name,
    contributorTwitter: paper.contributor_twitter,
    tags: paper.tags,
    viewCount: paper.view_count,
    createdAt: new Date(paper.created_at),
  }));
  
  return { papers, total: count ?? 0 };
}

/**
 * Fetch a single paper by ID
 */
export async function fetchPaperById(id: string): Promise<GalleryPaper | null> {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error || !data) {
    console.error('Fetch paper error:', error);
    return null;
  }
  
  const paper = data as Paper;
  
  // Increment view count (fire and forget)
  supabase
    .from('papers')
    .update({ view_count: paper.view_count + 1 } as never)
    .eq('id', id)
    .then(() => {});
  
  // Get version count
  const { count } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
    .eq('arxiv_id', paper.arxiv_id);
  
  return {
    id: paper.id,
    arxivId: paper.arxiv_id,
    title: paper.title,
    authors: paper.authors,
    abstract: paper.original_abstract,
    publicUrl: paper.public_url,
    version: paper.version,
    versionCount: count ?? 1,
    contributorName: paper.contributor_name,
    contributorTwitter: paper.contributor_twitter,
    tags: paper.tags,
    viewCount: paper.view_count + 1, // Include the current view
    createdAt: new Date(paper.created_at),
  };
}

/**
 * Fetch all versions of a paper by arxiv ID
 */
export async function fetchPaperVersions(arxivId: string): Promise<GalleryPaper[]> {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .eq('arxiv_id', arxivId)
    .order('version', { ascending: false });
  
  if (error) {
    console.error('Fetch versions error:', error);
    throw new Error(`Failed to fetch versions: ${error.message}`);
  }
  
  const paperList = (data ?? []) as Paper[];
  const versionCount = paperList.length;
  
  return paperList.map(paper => ({
    id: paper.id,
    arxivId: paper.arxiv_id,
    title: paper.title,
    authors: paper.authors,
    abstract: paper.original_abstract,
    publicUrl: paper.public_url,
    version: paper.version,
    versionCount,
    contributorName: paper.contributor_name,
    contributorTwitter: paper.contributor_twitter,
    tags: paper.tags,
    viewCount: paper.view_count,
    createdAt: new Date(paper.created_at),
  }));
}

/**
 * Generate a Twitter share URL
 */
export function generateTwitterShareUrl(paper: GalleryPaper, shareUrl: string): string {
  const tweetText = `Check out the YOLOv3-style rewrite of "${paper.title}" 🎯\n\n${shareUrl}`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
}
