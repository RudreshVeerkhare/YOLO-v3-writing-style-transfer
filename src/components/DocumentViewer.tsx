// ============================================================
// Document Viewer Component
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import type { FinalDocument } from '../types';
import { convertToMarkdown } from '../services/assembler';

interface DocumentViewerProps {
  document: FinalDocument | null;
  isPartial?: boolean;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ document, isPartial = false }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'html' | 'markdown'>('preview');
  
  useEffect(() => {
    if (document && iframeRef.current && viewMode === 'preview') {
      const iframe = iframeRef.current;
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      
      if (iframeDoc) {
        // Save scroll position before updating
        const scrollTop = iframeDoc.documentElement?.scrollTop || 0;
        
        iframeDoc.open();
        iframeDoc.write(document.html);
        iframeDoc.close();
        
        // Restore scroll position after update (for partial docs)
        if (isPartial && scrollTop > 0) {
          setTimeout(() => {
            if (iframeDoc.documentElement) {
              iframeDoc.documentElement.scrollTop = scrollTop;
            }
          }, 50);
        }
      }
    }
  }, [document, viewMode, isPartial]);
  
  if (!document) {
    return (
      <div className="document-viewer empty">
        <div className="empty-state">
          <span className="empty-icon">📄</span>
          <h3>No Document Yet</h3>
          <p>Enter an arXiv ID and click "Transform Paper" to generate a YOLO-style rewrite.</p>
        </div>
      </div>
    );
  }
  
  const handleDownloadHTML = () => {
    const blob = new Blob([document.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${document.meta.arxivId}-yolo-style.html`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const handleDownloadMarkdown = () => {
    const markdown = convertToMarkdown(document);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${document.meta.arxivId}-yolo-style.md`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const handleOpenInNewTab = () => {
    const blob = new Blob([document.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };
  
  const handleDownloadPDF = async () => {
    // Use browser's print functionality for PDF generation
    // This opens the document in a new window and triggers print dialog
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to download PDF');
      return;
    }
    
    // Add print-specific styles
    const printStyles = `
      <style>
        @media print {
          body { 
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .disclaimer { 
            page-break-after: always; 
          }
          section { 
            page-break-inside: avoid; 
          }
          figure { 
            page-break-inside: avoid; 
          }
          pre, code { 
            white-space: pre-wrap !important;
            word-break: break-word !important;
          }
        }
        @page {
          margin: 1in;
          size: letter;
        }
      </style>
    `;
    
    // Inject print styles into HTML
    const htmlWithPrintStyles = document.html.replace('</head>', `${printStyles}</head>`);
    
    printWindow.document.open();
    printWindow.document.write(htmlWithPrintStyles);
    printWindow.document.close();
    
    // Wait for content to load (including KaTeX)
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 1000); // Give KaTeX time to render
    };
  };
  
  return (
    <div className={`document-viewer ${isPartial ? 'partial' : ''}`}>
      <div className="viewer-header">
        <div className="document-info">
          <h3>
            {isPartial && <span className="wip-badge">🚧 WIP</span>}
            {document.meta.title}
          </h3>
          <p className="meta">
            arXiv:{document.meta.arxivId}
            {isPartial 
              ? ' • Generating... (you can read while sections load)' 
              : ` • Generated: ${new Date(document.meta.generationDate).toLocaleDateString()}`
            }
          </p>
        </div>
        
        <div className="viewer-actions">
          <div className="view-mode-buttons">
            <button 
              className={viewMode === 'preview' ? 'active' : ''}
              onClick={() => setViewMode('preview')}
            >
              Preview
            </button>
            <button 
              className={viewMode === 'html' ? 'active' : ''}
              onClick={() => setViewMode('html')}
              disabled={isPartial}
            >
              HTML
            </button>
            <button 
              className={viewMode === 'markdown' ? 'active' : ''}
              onClick={() => setViewMode('markdown')}
              disabled={isPartial}
            >
              Markdown
            </button>
          </div>
          
          {!isPartial && (
            <div className="download-buttons">
              <button onClick={handleDownloadHTML} className="download-btn">
                ⬇️ HTML
              </button>
              <button onClick={handleDownloadMarkdown} className="download-btn">
                ⬇️ Markdown
              </button>
              <button onClick={handleDownloadPDF} className="download-btn">
                📄 PDF
              </button>
              <button onClick={handleOpenInNewTab} className="download-btn">
                🔗 Open
              </button>
            </div>
          )}
        </div>
      </div>
      
      <div className="viewer-content">
        {viewMode === 'preview' && (
          <iframe
            ref={iframeRef}
            title="Document Preview"
            className="document-iframe"
            sandbox="allow-same-origin allow-scripts"
          />
        )}
        
        {viewMode === 'html' && !isPartial && (
          <div className="code-view">
            <pre>{document.html}</pre>
          </div>
        )}
        
        {viewMode === 'markdown' && !isPartial && (
          <div className="code-view">
            <pre>{convertToMarkdown(document)}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
