// ============================================================
// Input Form Component
// ============================================================

import React, { useState } from 'react';
import { normalizeArxivId, validateArxivId, prefetchAndEstimateCost } from '../services/pipeline';
import type { CostEstimate } from '../services/pipeline';
import type { PaperTeXBundle, StructuredPaper } from '../types';
import { formatCostRange } from '../services/costEstimator';
import { formatTokenCount } from '../services/usageTracker';

export interface PipelineOptions {
  critiqueIterations: number;
  enableWebSearch: boolean;
}

// Extended submit that can include prefetched data
export interface SubmitData {
  arxivId: string;
  apiKey: string;
  options: PipelineOptions;
  prefetchedData?: {
    bundle: PaperTeXBundle;
    structured: StructuredPaper;
  };
}

export interface EstimateProgressCallbacks {
  onEstimateStart: () => void;
  onStageChange: (stage: 'fetch' | 'ingestion' | 'structure') => void;
  onLog: (stage: 'fetch' | 'ingestion' | 'structure', message: string) => void;
  onProgress: (progress: number) => void;
  onEstimateComplete: () => void;
}

interface InputFormProps {
  onSubmit: (data: SubmitData) => void;
  isRunning: boolean;
  onEstimateProgress?: EstimateProgressCallbacks;
}

export const InputForm: React.FC<InputFormProps> = ({ onSubmit, isRunning, onEstimateProgress }) => {
  const [arxivId, setArxivId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  
  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [critiqueIterations, setCritiqueIterations] = useState(3);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  
  // Cost estimation state
  const [isFetching, setIsFetching] = useState(false);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [prefetchedBundle, setPrefetchedBundle] = useState<PaperTeXBundle | null>(null);
  const [prefetchedStructured, setPrefetchedStructured] = useState<StructuredPaper | null>(null);
  
  // Reset estimate when options change
  const resetEstimate = () => {
    setCostEstimate(null);
    setPrefetchedBundle(null);
    setPrefetchedStructured(null);
  };
  
  const handleEstimateCost = async () => {
    setError('');
    
    const normalizedId = normalizeArxivId(arxivId);
    
    if (!normalizedId) {
      setError('Please enter an arXiv ID');
      return;
    }
    
    if (!validateArxivId(normalizedId)) {
      setError('Invalid arXiv ID format. Examples: 2301.12345, 1706.03762, hep-th/9901001');
      return;
    }
    
    setIsFetching(true);
    onEstimateProgress?.onEstimateStart();
    
    try {
      const { estimate, bundle, structured } = await prefetchAndEstimateCost(
        normalizedId,
        { critiqueIterations, enableWebSearch },
        onEstimateProgress
      );
      
      setCostEstimate(estimate);
      setPrefetchedBundle(bundle);
      setPrefetchedStructured(structured);
      onEstimateProgress?.onEstimateComplete();
    } catch (e) {
      setError(`Failed to fetch paper: ${e instanceof Error ? e.message : String(e)}`);
      onEstimateProgress?.onEstimateComplete();
    } finally {
      setIsFetching(false);
    }
  };
  
  const handleConfirmAndRun = () => {
    setError('');
    
    if (!apiKey.trim()) {
      setError('Please enter your OpenAI API key');
      return;
    }
    
    if (!apiKey.startsWith('sk-')) {
      setError('Invalid API key format. OpenAI keys start with "sk-"');
      return;
    }
    
    const normalizedId = normalizeArxivId(arxivId);
    
    onSubmit({
      arxivId: normalizedId,
      apiKey: apiKey.trim(),
      options: { critiqueIterations, enableWebSearch },
      prefetchedData: prefetchedBundle && prefetchedStructured ? {
        bundle: prefetchedBundle,
        structured: prefetchedStructured,
      } : undefined,
    });
    
    // Reset estimate after starting
    resetEstimate();
  };
  
  const handleCancel = () => {
    resetEstimate();
  };
  
  // Estimate cost savings from options
  const estimatedSavings = () => {
    let savings = 0;
    if (critiqueIterations < 3) {
      savings += (3 - critiqueIterations) * 0.13;
    }
    if (!enableWebSearch) {
      savings += 0.26;
    }
    return savings;
  };
  
  return (
    <div className="input-form-container">
      <h2>📄 YOLOv3-Style Paper Rewriter</h2>
      <p className="subtitle">
        Transform dense academic papers into honest, accessible explanations
      </p>
      
      <div className="input-form">
        <div className="form-group">
          <label htmlFor="arxiv-id">arXiv ID or URL</label>
          <input
            id="arxiv-id"
            type="text"
            value={arxivId}
            onChange={(e) => { setArxivId(e.target.value); resetEstimate(); }}
            placeholder="e.g., 2301.12345 or https://arxiv.org/abs/2301.12345"
            disabled={isRunning || isFetching}
          />
          <span className="hint">
            Supports new format (2301.12345) and old format (hep-th/9901001)
          </span>
        </div>
        
        <div className="form-group">
          <label htmlFor="api-key">OpenAI API Key</label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            disabled={isRunning || isFetching}
          />
          <span className="hint">
            Your key is never stored — only used in memory for API calls
          </span>
        </div>
        
        {/* Advanced Options Toggle */}
        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
          disabled={isRunning || isFetching}
        >
          {showAdvanced ? '▼' : '▶'} Advanced Options
          {estimatedSavings() > 0 && !showAdvanced && (
            <span className="savings-hint">
              (can save ~${estimatedSavings().toFixed(2)})
            </span>
          )}
        </button>
        
        {showAdvanced && (
          <div className="advanced-options">
            {/* Critique Iterations */}
            <div className="form-group">
              <label htmlFor="critique-iterations">
                Critique Iterations
                <span className="option-cost">~$0.13/iteration</span>
              </label>
              <div className="range-input">
                <input
                  id="critique-iterations"
                  type="range"
                  min="0"
                  max="5"
                  value={critiqueIterations}
                  onChange={(e) => { setCritiqueIterations(parseInt(e.target.value)); resetEstimate(); }}
                  disabled={isRunning || isFetching}
                />
                <span className="range-value">{critiqueIterations}</span>
              </div>
              <span className="hint">
                {critiqueIterations === 0 
                  ? 'No critique — fastest but may have errors'
                  : critiqueIterations === 1
                  ? 'Single pass — catches major issues'
                  : critiqueIterations <= 3
                  ? 'Recommended — good accuracy/cost balance'
                  : 'Thorough — highest accuracy, higher cost'
                }
              </span>
            </div>
            
            {/* Web Search Toggle */}
            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={enableWebSearch}
                  onChange={(e) => { setEnableWebSearch(e.target.checked); resetEstimate(); }}
                  disabled={isRunning || isFetching}
                />
                <span className="checkbox-text">
                  Enable Web Research
                  <span className="option-cost">~$0.26</span>
                </span>
              </label>
              <span className="hint">
                {enableWebSearch
                  ? 'Searches for author info, community discussions, and practical applications'
                  : 'Skip web research to save cost — uses only paper content'
                }
              </span>
            </div>
            
            {/* Cost Summary */}
            {estimatedSavings() > 0 && (
              <div className="cost-summary">
                <span className="savings-badge">
                  💰 Estimated savings: ~${estimatedSavings().toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}
        
        {error && <div className="error-message">{error}</div>}
        
        {/* Cost Estimate Display */}
        {costEstimate && (
          <div className="cost-estimate-box">
            <div className="cost-estimate-header">
              <h4>📊 Cost Estimate</h4>
              <button 
                className="cancel-btn"
                onClick={handleCancel}
                disabled={isRunning}
              >
                ✕
              </button>
            </div>
            
            <div className="paper-info">
              <strong>{costEstimate.paperStats.title}</strong>
              <div className="paper-stats">
                <span>{costEstimate.paperStats.sections} sections</span>
                <span>•</span>
                <span>{costEstimate.paperStats.figures} figures</span>
                <span>•</span>
                <span>~{formatTokenCount(costEstimate.paperStats.estimatedTokens)} tokens</span>
              </div>
            </div>
            
            <div className="cost-breakdown">
              <div className="cost-main">
                <span className="cost-label">Estimated Cost:</span>
                <span className="cost-value">{formatCostRange(costEstimate)}</span>
              </div>
              <div className="cost-details">
                <span>{costEstimate.totalRequests} API calls</span>
                <span>•</span>
                <span>~{costEstimate.estimatedMinutes} min</span>
              </div>
            </div>
            
            <details className="cost-stages-details">
              <summary>View breakdown by stage</summary>
              <div className="cost-stages">
                {costEstimate.stages.map((stage, i) => (
                  <div key={i} className="cost-stage-row">
                    <span className="stage-name">{stage.name}</span>
                    <span className="stage-model">{stage.model}</span>
                    <span className="stage-cost">${stage.cost.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </details>
            
            <p className="cost-disclaimer">
              ⚠️ <strong>Estimate only.</strong> Actual cost may vary based on content complexity, 
              tokenization, and API pricing. Prompt caching may reduce actual cost.
            </p>
            
            <button 
              type="button" 
              onClick={handleConfirmAndRun}
              disabled={isRunning || !apiKey.trim()}
              className="submit-button confirm-btn"
            >
              {!apiKey.trim() ? (
                '🔑 Enter API Key Above'
              ) : (
                <>✅ Confirm & Start Processing</>
              )}
            </button>
          </div>
        )}
        
        {/* Initial button - shows estimate first */}
        {!costEstimate && (
          <button 
            type="button"
            onClick={handleEstimateCost}
            disabled={isRunning || isFetching}
            className="submit-button"
          >
            {isFetching ? (
              <>
                <span className="spinner"></span>
                Fetching paper...
              </>
            ) : isRunning ? (
              <>
                <span className="spinner"></span>
                Processing...
              </>
            ) : (
              '📄 Fetch Paper & Estimate Cost'
            )}
          </button>
        )}
      </div>
      
      <div className="info-box">
        <h4>How it works:</h4>
        <ol>
          <li><strong>Fetch & Estimate</strong> — Downloads paper, shows cost estimate</li>
          <li><strong>Confirm</strong> — Review cost, then start processing</li>
          <li>Parses structure, extracts meaning, researches gaps</li>
          <li>Rewrites in YOLOv3-style honest narrative</li>
          <li>Reviews and patches for accuracy</li>
        </ol>
      </div>
    </div>
  );
};
