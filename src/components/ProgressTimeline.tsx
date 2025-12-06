// ============================================================
// Progress Timeline Component
// Shows collapsible pipeline stages with grouped progress inside
// ============================================================

import React, { useState, useEffect, useMemo } from 'react';
import type { PipelineStage, LogEntry } from '../types';

interface ProgressTimelineProps {
  currentStage: PipelineStage;
  logs: LogEntry[];
  progress: number;
  error?: string;
  startTime?: number; // Unix timestamp when pipeline started
}

const STAGES: { id: PipelineStage; label: string; icon: string; optional?: boolean }[] = [
  { id: 'fetch', label: 'Download Paper', icon: '📡' },
  { id: 'ingestion', label: 'Extract Content', icon: '📥' },
  { id: 'structure', label: 'Parse Structure', icon: '🔍' },
  { id: 'semantics', label: 'Extract Meaning', icon: '🧠' },
  { id: 'research', label: 'Research & Answer', icon: '🔬' },
  { id: 'websearch', label: 'Web Search', icon: '🌐', optional: true },
  { id: 'rewrite', label: 'YOLO Rewrite', icon: '✍️' },
  { id: 'figures', label: 'Place Figures', icon: '🖼️' },
  { id: 'critique', label: 'Review & Fix', icon: '👀' },
  { id: 'assembly', label: 'Assemble', icon: '📦' },
  { id: 'done', label: 'Done!', icon: '✅' },
];

const STAGE_ORDER = STAGES.map(s => s.id);

// Format elapsed time as MM:SS or HH:MM:SS
const formatElapsedTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const ProgressTimeline: React.FC<ProgressTimelineProps> = ({
  currentStage,
  logs,
  progress,
  error,
  startTime,
}) => {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  
  // Track elapsed time
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  
  // Update elapsed time every second while running
  useEffect(() => {
    if (!startTime || currentStage === 'done' || currentStage === 'idle') {
      return;
    }
    
    // Calculate initial elapsed time
    const updateElapsed = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      setElapsedSeconds(elapsed);
    };
    
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    
    return () => clearInterval(interval);
  }, [startTime, currentStage]);
  
  // Track which sections are manually expanded (override auto-collapse)
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<PipelineStage>>(new Set());
  
  // Auto-expand current stage when it changes
  useEffect(() => {
    if (currentStage !== 'idle' && currentStage !== 'error' && currentStage !== 'done') {
      setManuallyExpanded(prev => {
        const next = new Set(prev);
        next.add(currentStage);
        return next;
      });
    }
  }, [currentStage]);
  
  const getStageStatus = (stageId: PipelineStage): 'pending' | 'active' | 'complete' | 'error' | 'skipped' => {
    const stageLogs = logsByStage[stageId] || [];
    const stageConfig = STAGES.find(s => s.id === stageId);
    
    if (currentStage === 'error') {
      const stageIndex = STAGE_ORDER.indexOf(stageId);
      if (stageIndex < currentIndex) return 'complete';
      if (stageIndex === currentIndex) return 'error';
      return 'pending';
    }
    
    // When done, check if optional stages were skipped (no logs means skipped)
    if (currentStage === 'done') {
      if (stageConfig?.optional && stageLogs.length === 0) {
        return 'skipped';
      }
      return 'complete';
    }
    
    const stageIndex = STAGE_ORDER.indexOf(stageId);
    if (stageIndex < currentIndex) {
      // Check if optional stage was skipped
      if (stageConfig?.optional && stageLogs.length === 0) {
        return 'skipped';
      }
      return 'complete';
    }
    if (stageIndex === currentIndex) return 'active';
    return 'pending';
  };
  
  // Group logs by stage
  const logsByStage = useMemo(() => {
    const grouped: Record<string, LogEntry[]> = {};
    for (const log of logs) {
      if (!grouped[log.stage]) {
        grouped[log.stage] = [];
      }
      grouped[log.stage].push(log);
    }
    return grouped;
  }, [logs]);
  
  // Determine if a section should be expanded
  const isExpanded = (stageId: PipelineStage): boolean => {
    const status = getStageStatus(stageId);
    // Active stages are always expanded
    if (status === 'active') return true;
    // Completed stages auto-collapse unless manually expanded
    if (status === 'complete') return manuallyExpanded.has(stageId);
    // Pending stages are collapsed
    return false;
  };
  
  const toggleSection = (stageId: PipelineStage) => {
    setManuallyExpanded(prev => {
      const next = new Set(prev);
      if (next.has(stageId)) {
        next.delete(stageId);
      } else {
        next.add(stageId);
      }
      return next;
    });
  };
  
  // Auto-collapse completed stages
  useEffect(() => {
    // When a stage completes (current stage moves forward), remove it from manually expanded
    STAGES.forEach(stage => {
      const status = getStageStatus(stage.id);
      if (status === 'complete') {
        setManuallyExpanded(prev => {
          const next = new Set(prev);
          next.delete(stage.id);
          return next;
        });
      }
    });
  }, [currentStage]);
  
  const isRunning = currentStage !== 'idle' && currentStage !== 'done' && currentStage !== 'error';
  
  return (
    <div className="progress-timeline">
      <div className="progress-header">
        <div className="progress-title-row">
          <h3>Processing Pipeline</h3>
          {startTime && (
            <div className={`thinking-timer ${isRunning ? 'active' : ''}`}>
              <span className="timer-icon">{isRunning ? '⏱️' : (currentStage === 'done' ? '✅' : '⏸️')}</span>
              <span className="timer-value">{formatElapsedTime(elapsedSeconds)}</span>
              {isRunning && <span className="timer-label">elapsed</span>}
            </div>
          )}
        </div>
        <div className="progress-bar-container">
          <div 
            className="progress-bar" 
            style={{ width: `${progress}%` }}
          />
          <span className="progress-text">{progress}%</span>
        </div>
      </div>
      
      {error && (
        <div className="error-box">
          <h4>❌ Error</h4>
          <p>{error}</p>
        </div>
      )}
      
      <div className="stages-accordion">
        {STAGES.map((stage) => {
          const status = getStageStatus(stage.id);
          const stageLogs = logsByStage[stage.id] || [];
          const expanded = isExpanded(stage.id);
          const hasLogs = stageLogs.length > 0;
          
          return (
            <div 
              key={stage.id} 
              className={`stage-section stage-${status}`}
            >
              <button 
                className="stage-header"
                onClick={() => toggleSection(stage.id)}
                disabled={status === 'pending' || status === 'skipped'}
              >
                <span className="stage-icon">{stage.icon}</span>
                <span className="stage-label">
                  {stage.label}
                  {stage.optional && <span className="stage-optional-badge">optional</span>}
                </span>
                {status === 'skipped' && (
                  <span className="stage-skipped-label">skipped</span>
                )}
                {hasLogs && (
                  <span className="stage-log-count">
                    {stageLogs.length} {stageLogs.length === 1 ? 'log' : 'logs'}
                  </span>
                )}
                <span className="stage-status-icon">
                  {status === 'complete' && '✓'}
                  {status === 'skipped' && '–'}
                  {status === 'active' && <span className="spinner-small"></span>}
                  {status === 'error' && '✗'}
                </span>
                <span className={`stage-chevron ${expanded ? 'expanded' : ''}`}>
                  {status !== 'pending' && '▼'}
                </span>
              </button>
              
              {expanded && hasLogs && (
                <div className="stage-logs">
                  {stageLogs.map((log, i) => (
                    <div key={i} className="stage-log-entry">
                      <span className="log-time">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="log-message">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
