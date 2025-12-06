// ============================================================
// Gallery Page Component - Public gallery of YOLO-style papers
// ============================================================

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  fetchGalleryPapers, 
  fetchPaperById, 
  fetchPaperVersions,
  isGalleryAvailable,
  generateTwitterShareUrl,
  type GalleryPaper 
} from '../services/galleryService';
import './Gallery.css';

// Gallery List View
export const GalleryPage: React.FC = () => {
  const navigate = useNavigate();
  const [papers, setPapers] = useState<GalleryPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'popular'>('recent');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 12;
  
  useEffect(() => {
    if (!isGalleryAvailable()) {
      setError('Gallery is not configured. Please set up Supabase.');
      setLoading(false);
      return;
    }
    
    loadPapers();
  }, [searchQuery, sortBy, page]);
  
  const loadPapers = async () => {
    setLoading(true);
    try {
      const result = await fetchGalleryPapers({
        limit: pageSize,
        offset: page * pageSize,
        searchQuery: searchQuery || undefined,
        sortBy,
      });
      setPapers(result.papers);
      setTotal(result.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load gallery');
    } finally {
      setLoading(false);
    }
  };
  
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
  };
  
  const totalPages = Math.ceil(total / pageSize);
  
  return (
    <div className="gallery-page">
      <header className="gallery-header">
        <div className="gallery-header-content">
          <Link to="/" className="back-link">← Back to Converter</Link>
          <h1>🎯 YOLOv3-Style Paper Gallery</h1>
          <p>Community-contributed honest paper rewrites</p>
        </div>
      </header>
      
      <div className="gallery-controls">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="Search by title or arXiv ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-btn">🔍</button>
        </form>
        
        <div className="sort-controls">
          <button 
            className={sortBy === 'recent' ? 'active' : ''} 
            onClick={() => { setSortBy('recent'); setPage(0); }}
          >
            🕐 Recent
          </button>
          <button 
            className={sortBy === 'popular' ? 'active' : ''} 
            onClick={() => { setSortBy('popular'); setPage(0); }}
          >
            🔥 Popular
          </button>
        </div>
      </div>
      
      {loading && (
        <div className="gallery-loading">
          <div className="spinner"></div>
          <p>Loading papers...</p>
        </div>
      )}
      
      {error && (
        <div className="gallery-error">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
        </div>
      )}
      
      {!loading && !error && papers.length === 0 && (
        <div className="gallery-empty">
          <span className="empty-icon">📭</span>
          <h3>No Papers Yet</h3>
          <p>Be the first to publish a YOLOv3-style paper rewrite!</p>
          <Link to="/" className="create-btn">Create One Now →</Link>
        </div>
      )}
      
      {!loading && !error && papers.length > 0 && (
        <>
          <div className="gallery-stats">
            Showing {papers.length} of {total} papers
          </div>
          
          <div className="gallery-grid">
            {papers.map(paper => (
              <PaperCard 
                key={paper.id} 
                paper={paper} 
                onClick={() => navigate(`/gallery/${paper.id}`)}
              />
            ))}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                disabled={page === 0} 
                onClick={() => setPage(p => p - 1)}
              >
                ← Previous
              </button>
              <span>Page {page + 1} of {totalPages}</span>
              <button 
                disabled={page >= totalPages - 1} 
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Paper Card Component
const PaperCard: React.FC<{ paper: GalleryPaper; onClick: () => void }> = ({ paper, onClick }) => {
  return (
    <div className="paper-card" onClick={onClick}>
      <div className="paper-card-header">
        <span className="arxiv-badge">arXiv:{paper.arxivId}</span>
        {paper.versionCount > 1 && (
          <span className="version-badge">v{paper.version} ({paper.versionCount} versions)</span>
        )}
      </div>
      
      <h3 className="paper-title">{paper.title}</h3>
      
      <p className="paper-authors">
        {paper.authors.slice(0, 3).join(', ')}
        {paper.authors.length > 3 && ' et al.'}
      </p>
      
      <p className="paper-abstract">
        {paper.abstract.length > 150 
          ? paper.abstract.substring(0, 150) + '...' 
          : paper.abstract}
      </p>
      
      {paper.tags.length > 0 && (
        <div className="paper-tags">
          {paper.tags.slice(0, 3).map(tag => (
            <span key={tag} className="tag">{tag}</span>
          ))}
          {paper.tags.length > 3 && <span className="tag">+{paper.tags.length - 3}</span>}
        </div>
      )}
      
      <div className="paper-card-footer">
        <span className="view-count">👁️ {paper.viewCount}</span>
        <span className="date">{paper.createdAt.toLocaleDateString()}</span>
        {paper.contributorName && (
          <span className="contributor">
            by {paper.contributorTwitter 
              ? <a href={`https://twitter.com/${paper.contributorTwitter}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>@{paper.contributorTwitter}</a>
              : paper.contributorName}
          </span>
        )}
      </div>
    </div>
  );
};

// Single Paper View
export const PaperViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [paper, setPaper] = useState<GalleryPaper | null>(null);
  const [versions, setVersions] = useState<GalleryPaper[]>([]);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [copied, setCopied] = useState(false);
  
  useEffect(() => {
    if (!id) return;
    loadPaper();
  }, [id]);
  
  const loadPaper = async () => {
    if (!id) return;
    setLoading(true);
    setHtmlContent(null);
    try {
      const paperData = await fetchPaperById(id);
      if (!paperData) {
        setError('Paper not found');
      } else {
        setPaper(paperData);
        // Load versions if there are multiple
        if (paperData.versionCount > 1) {
          const versionData = await fetchPaperVersions(paperData.arxivId);
          setVersions(versionData);
        }
        // Fetch HTML content to render it properly (bypasses content-type issues)
        try {
          const response = await fetch(paperData.publicUrl);
          const html = await response.text();
          setHtmlContent(html);
        } catch (e) {
          console.error('Failed to fetch HTML content:', e);
          // Fall back to iframe if fetch fails
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load paper');
    } finally {
      setLoading(false);
    }
  };
  
  const handleCopyUrl = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };
  
  const handleShareTwitter = () => {
    if (!paper) return;
    const twitterUrl = generateTwitterShareUrl(paper, window.location.href);
    window.open(twitterUrl, '_blank');
  };
  
  if (loading) {
    return (
      <div className="paper-view-page">
        <div className="gallery-loading">
          <div className="spinner"></div>
          <p>Loading paper...</p>
        </div>
      </div>
    );
  }
  
  if (error || !paper) {
    return (
      <div className="paper-view-page">
        <div className="gallery-error">
          <span className="error-icon">⚠️</span>
          <p>{error || 'Paper not found'}</p>
          <Link to="/gallery" className="back-btn">← Back to Gallery</Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="paper-view-page">
      <header className="paper-view-header">
        <Link to="/gallery" className="back-link">← Back to Gallery</Link>
        
        <div className="paper-info">
          <div className="paper-badges">
            <span className="arxiv-badge">arXiv:{paper.arxivId}</span>
            {paper.versionCount > 1 && (
              <button 
                className="version-badge clickable" 
                onClick={() => setShowVersions(!showVersions)}
              >
                v{paper.version} ({paper.versionCount} versions) {showVersions ? '▲' : '▼'}
              </button>
            )}
          </div>
          
          <h1>{paper.title}</h1>
          
          <p className="paper-authors">
            {paper.authors.join(', ')}
          </p>
          
          {paper.tags.length > 0 && (
            <div className="paper-tags">
              {paper.tags.map(tag => (
                <span key={tag} className="tag">{tag}</span>
              ))}
            </div>
          )}
          
          <div className="paper-meta">
            <span className="view-count">👁️ {paper.viewCount} views</span>
            <span className="date">Published: {paper.createdAt.toLocaleDateString()}</span>
            {paper.contributorName && (
              <span className="contributor">
                Contributed by: {paper.contributorTwitter 
                  ? <a href={`https://twitter.com/${paper.contributorTwitter}`} target="_blank" rel="noopener noreferrer">@{paper.contributorTwitter}</a>
                  : paper.contributorName}
              </span>
            )}
          </div>
        </div>
        
        <div className="share-actions">
          <button onClick={handleCopyUrl} className="share-btn">
            {copied ? '✓ Copied!' : '📋 Copy Link'}
          </button>
          <button onClick={handleShareTwitter} className="share-btn twitter">
            🐦 Tweet
          </button>
          <a href={`/paper/${paper.id}`} target="_blank" rel="noopener noreferrer" className="share-btn">
            🔗 Direct HTML
          </a>
        </div>
      </header>
      
      {/* Version Selector */}
      {showVersions && versions.length > 1 && (
        <div className="versions-panel">
          <h3>All Versions</h3>
          <div className="versions-list">
            {versions.map(v => (
              <button
                key={v.id}
                className={`version-item ${v.id === paper.id ? 'active' : ''}`}
                onClick={() => navigate(`/gallery/${v.id}`)}
              >
                <span className="version-number">v{v.version}</span>
                <span className="version-date">{v.createdAt.toLocaleDateString()}</span>
                {v.contributorName && (
                  <span className="version-contributor">by {v.contributorName}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Paper Content */}
      <div className="paper-content">
        {htmlContent ? (
          <iframe
            srcDoc={htmlContent}
            title={paper.title}
            className="paper-iframe"
          />
        ) : (
          <iframe
            src={paper.publicUrl}
            title={paper.title}
            className="paper-iframe"
          />
        )}
      </div>
    </div>
  );
};
