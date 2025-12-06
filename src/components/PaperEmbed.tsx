// ============================================================
// Paper Embed Page - Serves HTML content with correct content-type
// ============================================================

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPaperById } from '../services/galleryService';

/**
 * This component fetches the paper HTML and renders it directly,
 * bypassing Supabase's incorrect content-type headers.
 * 
 * When accessed, it replaces the entire document with the paper HTML.
 */
export const PaperEmbedPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setError('No paper ID provided');
      setLoading(false);
      return;
    }

    const loadAndRenderPaper = async () => {
      try {
        // Fetch paper metadata to get the public URL
        const paper = await fetchPaperById(id);
        
        if (!paper) {
          setError('Paper not found');
          setLoading(false);
          return;
        }

        // Fetch the HTML content
        const response = await fetch(paper.publicUrl);
        const html = await response.text();

        // Replace the entire document with the paper HTML
        document.open();
        document.write(html);
        document.close();
      } catch (e) {
        console.error('Failed to load paper:', e);
        setError(e instanceof Error ? e.message : 'Failed to load paper');
        setLoading(false);
      }
    };

    loadAndRenderPaper();
  }, [id]);

  // Show loading or error state (will be replaced once HTML loads)
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f5f5f5',
        color: '#333',
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid #eee',
          borderTopColor: '#b31b1b',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <p style={{ marginTop: '1rem' }}>Loading paper...</p>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f5f5f5',
        color: '#333',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
        <h2 style={{ margin: '0 0 0.5rem 0' }}>Error Loading Paper</h2>
        <p style={{ color: '#666', marginBottom: '1rem' }}>{error}</p>
        <a 
          href="/gallery" 
          style={{
            color: '#b31b1b',
            textDecoration: 'none',
          }}
        >
          ← Back to Gallery
        </a>
      </div>
    );
  }

  return null;
};
