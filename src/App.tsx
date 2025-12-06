// ============================================================
// Main App Component
// ============================================================

import { useState, useCallback } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { InputForm, ProgressTimeline, DocumentViewer, UsageDisplay, GalleryPage, PaperViewPage, PaperEmbedPage } from './components';
import type { SubmitData, EstimateProgressCallbacks } from './components/InputForm';
import { runPipeline, runPipelineWithPrefetchedData } from './services/pipeline';
import { globalUsageTracker } from './services/usageTracker';
import type { PipelineStage, LogEntry, FinalDocument } from './types';
import './App.css';

// Main converter page component
function ConverterPage() {
  // Pipeline state
  const [isRunning, setIsRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<PipelineStage>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [document, setDocument] = useState<FinalDocument | null>(null);
  const [isPartialDocument, setIsPartialDocument] = useState(false);
  const [startTime, setStartTime] = useState<number | undefined>();
  
  // Handle form submission
  const handleSubmit = useCallback(async (data: SubmitData) => {
    const { arxivId, apiKey, options, prefetchedData } = data;
    
    // Reset state
    setIsRunning(true);
    setCurrentStage('idle');
    setLogs([]);
    setProgress(0);
    setError(undefined);
    setDocument(null);
    setIsPartialDocument(false);
    setStartTime(Date.now());
    
    // Reset usage tracker for new run
    globalUsageTracker.reset();
    
    const callbacks = {
      onStageChange: (stage: PipelineStage) => {
        setCurrentStage(stage);
      },
      onLog: (entry: LogEntry) => {
        setLogs(prev => [...prev, entry]);
      },
      onProgress: (p: number) => {
        setProgress(p);
      },
      onPartialDocument: (doc: FinalDocument, _completed: number, _total: number) => {
        setDocument(doc);
        setIsPartialDocument(true);
      },
      onError: (err: string) => {
        setError(err);
        setIsRunning(false);
        setIsPartialDocument(false);
      },
      onComplete: (doc: FinalDocument) => {
        setDocument(doc);
        setIsRunning(false);
        setIsPartialDocument(false);
      },
    };
    
    // Use prefetched data if available, otherwise run full pipeline
    if (prefetchedData) {
      await runPipelineWithPrefetchedData(
        prefetchedData.bundle,
        prefetchedData.structured,
        apiKey,
        options,
        callbacks
      );
    } else {
      await runPipeline(arxivId, apiKey, options, callbacks);
    }
  }, []);
  
  // Determine layout based on state
  const showTimeline = isRunning || currentStage !== 'idle';
  const showDocument = document !== null;
  
  // Estimate progress callbacks - shows fetch/parse progress during cost estimation
  const estimateProgressCallbacks: EstimateProgressCallbacks = {
    onEstimateStart: () => {
      // Reset state when estimate begins
      setCurrentStage('fetch');
      setLogs([]);
      setProgress(0);
      setError(undefined);
      setDocument(null);
      setStartTime(Date.now());
    },
    onStageChange: (stage) => {
      setCurrentStage(stage);
    },
    onLog: (stage, message) => {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        stage,
        message,
      }]);
    },
    onProgress: (p) => {
      setProgress(p);
    },
    onEstimateComplete: () => {
      // Keep the timeline visible but don't reset - user will see the estimate
    },
  };
  
  return (
    <div className="app">
      <header className="app-header">
        <h1>🎯 YOLOv3-Style GPT-5.1 Paper Rewriter</h1>
        <p>Multi-agent pipeline for honest, accessible academic paper rewrites</p>
        <Link to="/gallery" className="gallery-link">📚 Browse Gallery →</Link>
      </header>
      
      <main className="app-main">
        <div className={`app-layout ${showTimeline ? 'with-timeline' : ''} ${showDocument ? 'with-document' : ''}`}>
          {/* Left Panel - Input Form */}
          <aside className="panel-left">
            <InputForm 
              onSubmit={handleSubmit} 
              isRunning={isRunning} 
              onEstimateProgress={estimateProgressCallbacks}
            />
          </aside>
          
          {/* Center Panel - Progress Timeline */}
          {showTimeline && (
            <div className="panel-center">
              <ProgressTimeline
                currentStage={currentStage}
                logs={logs}
                progress={progress}
                error={error}
                startTime={startTime}
              />
              <UsageDisplay isRunning={isRunning} />
            </div>
          )}
          
          {/* Right Panel - Document Viewer */}
          <div className="panel-right">
            <DocumentViewer document={document} isPartial={isPartialDocument} />
          </div>
        </div>
      </main>
      
      <footer className="app-footer">
        <p>
          Built with React + TypeScript + GPT-5.1 • 
          <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a> • 
          Your API key is never stored
        </p>
      </footer>
    </div>
  );
}

// Main App with routing
function App() {
  return (
    <Routes>
      <Route path="/" element={<ConverterPage />} />
      <Route path="/gallery" element={<GalleryPage />} />
      <Route path="/gallery/:id" element={<PaperViewPage />} />
      <Route path="/paper/:id" element={<PaperEmbedPage />} />
    </Routes>
  );
}

export default App;
