// ============================================================
// Publish Modal - Dialog for publishing papers to gallery
// ============================================================

import React, { useState, useEffect } from 'react';
import type { FinalDocument } from '../types';
import { publishToGallery, isGalleryAvailable, generateTwitterShareUrl, generateTagsFromContent } from '../services/galleryService';
import type { GalleryPaper } from '../services/galleryService';
import './PublishModal.css';

interface PublishModalProps {
  document: FinalDocument;
  isOpen: boolean;
  onClose: () => void;
}

type PublishState = 'form' | 'publishing' | 'success' | 'error';

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format token count
 */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

export const PublishModal: React.FC<PublishModalProps> = ({ document, isOpen, onClose }) => {
  const [state, setState] = useState<PublishState>('form');
  const [contributorName, setContributorName] = useState('');
  const [contributorTwitter, setContributorTwitter] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState('');
  const [publishedUrl, setPublishedUrl] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  
  // Auto-generate tags when modal opens
  useEffect(() => {
    if (isOpen && tags.length === 0) {
      const autoTags = generateTagsFromContent(
        document.meta.title,
        document.meta.originalAbstract
      );
      setTags(autoTags);
    }
  }, [isOpen, document.meta.title, document.meta.originalAbstract]);
  
  if (!isOpen) return null;
  
  const handleAddTag = () => {
    const newTag = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (newTag && !tags.includes(newTag) && tags.length < 10) {
      setTags([...tags, newTag]);
      setTagInput('');
    }
  };
  
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };
  
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };
  
  const handlePublish = async () => {
    setState('publishing');
    setError('');
    
    const result = await publishToGallery({
      document,
      contributorName: contributorName.trim() || undefined,
      contributorTwitter: contributorTwitter.trim().replace('@', '') || undefined,
      tags,
    });
    
    if (result.success) {
      setPublishedUrl(result.publicUrl!);
      setShareUrl(result.shareUrl!);
      setState('success');
    } else {
      setError(result.error || 'Failed to publish');
      setState('error');
    }
  };
  
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };
  
  const handleShareTwitter = () => {
    const paper: GalleryPaper = {
      id: '',
      arxivId: document.meta.arxivId,
      title: document.meta.title,
      authors: document.meta.authors,
      abstract: document.meta.originalAbstract,
      publicUrl: publishedUrl,
      version: 1,
      versionCount: 1,
      contributorName,
      contributorTwitter,
      tags,
      viewCount: 0,
      createdAt: new Date(),
    };
    
    const twitterUrl = generateTwitterShareUrl(paper, shareUrl);
    window.open(twitterUrl, '_blank');
  };
  
  const handleClose = () => {
    // Reset state when closing
    setState('form');
    setError('');
    setPublishedUrl('');
    setShareUrl('');
    setCopied(false);
    setTags([]);
    setTagInput('');
    onClose();
  };
  
  const config = document.meta.generationConfig;
  
  if (!isGalleryAvailable()) {
    return (
      <div className="modal-overlay" onClick={handleClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2>📤 Publish to Gallery</h2>
            <button className="modal-close" onClick={handleClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="not-configured">
              <span className="warning-icon">⚠️</span>
              <h3>Gallery Not Configured</h3>
              <p>
                The public gallery requires Supabase configuration. 
                Please set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> 
                environment variables.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content publish-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📤 Publish to Gallery</h2>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>
        
        <div className="modal-body">
          {state === 'form' && (
            <>
              <div className="paper-preview">
                <h3>{document.meta.title}</h3>
                <p className="paper-meta">
                  arXiv:{document.meta.arxivId} • {document.meta.authors.slice(0, 3).join(', ')}
                  {document.meta.authors.length > 3 && ' et al.'}
                </p>
              </div>
              
              {/* Generation Config Display */}
              <div className="generation-config">
                <h4>⚙️ Generation Settings</h4>
                <div className="config-grid">
                  <div className="config-item">
                    <span className="config-label">Model</span>
                    <span className="config-value">{config.model}</span>
                  </div>
                  <div className="config-item">
                    <span className="config-label">Critique Iterations</span>
                    <span className="config-value">{config.critiqueIterations}</span>
                  </div>
                  <div className="config-item">
                    <span className="config-label">Web Search</span>
                    <span className="config-value">{config.webSearchEnabled ? '✓ Enabled' : '✗ Disabled'}</span>
                  </div>
                  <div className="config-item">
                    <span className="config-label">Total Tokens</span>
                    <span className="config-value">{formatTokens(config.totalTokens)}</span>
                  </div>
                  <div className="config-item">
                    <span className="config-label">Generation Time</span>
                    <span className="config-value">{formatDuration(config.generationTimeMs)}</span>
                  </div>
                  <div className="config-item">
                    <span className="config-label">Estimated Cost</span>
                    <span className="config-value cost">${config.estimatedCost.toFixed(2)}</span>
                  </div>
                </div>
              </div>
              
              <div className="publish-info">
                <p>
                  🌍 Your YOLOv3-style rewrite will be published to the public gallery 
                  where anyone can view and share it.
                </p>
              </div>
              
              <div className="form-group">
                <label htmlFor="contributorName">Your Name (optional)</label>
                <input
                  id="contributorName"
                  type="text"
                  value={contributorName}
                  onChange={e => setContributorName(e.target.value)}
                  placeholder="Anonymous Contributor"
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="contributorTwitter">Twitter Handle (optional)</label>
                <input
                  id="contributorTwitter"
                  type="text"
                  value={contributorTwitter}
                  onChange={e => setContributorTwitter(e.target.value)}
                  placeholder="@username"
                />
              </div>
              
              <div className="form-group">
                <label>Tags (auto-generated, click to remove)</label>
                <div className="tags-container">
                  {tags.map(tag => (
                    <span key={tag} className="tag-chip" onClick={() => handleRemoveTag(tag)}>
                      {tag} <span className="tag-remove">×</span>
                    </span>
                  ))}
                  {tags.length < 10 && (
                    <input
                      type="text"
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      onBlur={handleAddTag}
                      placeholder={tags.length === 0 ? "Add tags..." : "+"}
                      className="tag-input"
                    />
                  )}
                </div>
                <p className="form-hint">Press Enter to add a tag. Max 10 tags.</p>
              </div>
              
              <div className="version-note">
                <span className="info-icon">ℹ️</span>
                <p>
                  If this paper has been published before, your version will be added 
                  as a new revision. All versions are preserved.
                </p>
              </div>
            </>
          )}
          
          {state === 'publishing' && (
            <div className="publishing-state">
              <div className="spinner"></div>
              <p>Publishing to gallery...</p>
            </div>
          )}
          
          {state === 'success' && (
            <div className="success-state">
              <span className="success-icon">✅</span>
              <h3>Published Successfully!</h3>
              <p>Your paper is now live in the public gallery.</p>
              
              <div className="share-url">
                <input 
                  type="text" 
                  value={shareUrl} 
                  readOnly 
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <button onClick={handleCopyUrl} className="copy-btn">
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>
              
              <div className="share-buttons">
                <button onClick={handleShareTwitter} className="twitter-btn">
                  🐦 Share on Twitter
                </button>
                <a 
                  href={publishedUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="view-btn"
                >
                  👁️ View Paper
                </a>
              </div>
            </div>
          )}
          
          {state === 'error' && (
            <div className="error-state">
              <span className="error-icon">❌</span>
              <h3>Publication Failed</h3>
              <p>{error}</p>
              <button onClick={() => setState('form')} className="retry-btn">
                Try Again
              </button>
            </div>
          )}
        </div>
        
        {state === 'form' && (
          <div className="modal-footer">
            <button onClick={handleClose} className="cancel-btn">
              Cancel
            </button>
            <button onClick={handlePublish} className="publish-btn">
              🚀 Publish to Gallery
            </button>
          </div>
        )}
        
        {state === 'success' && (
          <div className="modal-footer">
            <button onClick={handleClose} className="done-btn">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
