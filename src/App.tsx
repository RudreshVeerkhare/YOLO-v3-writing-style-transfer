// ============================================================
// Main App Component
// ============================================================

import { useState, useCallback } from 'react';
import { InputForm, ProgressTimeline, DocumentViewer, UsageDisplay } from './components';
import type { SubmitData } from './components/InputForm';
import { runPipeline, runPipelineWithPrefetchedData } from './services/pipeline';
import { globalUsageTracker } from './services/usageTracker';
import type { PipelineStage, LogEntry, FinalDocument } from './types';
import './App.css';

function App() {
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
  
  return (
    <div className="app">
      <header className="app-header">
        <h1>🎯 YOLO-Style GPT-5.1 Paper Rewriter</h1>
        <p>Multi-agent pipeline for honest, accessible academic paper rewrites</p>
      </header>
      
      <main className="app-main">
        <div className={`app-layout ${showTimeline ? 'with-timeline' : ''} ${showDocument ? 'with-document' : ''}`}>
          {/* Left Panel - Input Form */}
          <aside className="panel-left">
            <InputForm onSubmit={handleSubmit} isRunning={isRunning} />
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

export default App;
