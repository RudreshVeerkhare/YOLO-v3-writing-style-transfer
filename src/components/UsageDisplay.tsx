// ============================================================
// Usage Display Component
// Shows real-time token usage and estimated cost
// ============================================================

import React, { useState, useEffect } from 'react';
import { 
  globalUsageTracker, 
  formatTokenCount, 
  formatCost, 
  getModelDisplayName,
  calculateModelCost,
  type UsageStats 
} from '../services/usageTracker';

interface UsageDisplayProps {
  isRunning: boolean;
}

export const UsageDisplay: React.FC<UsageDisplayProps> = ({ isRunning }) => {
  const [stats, setStats] = useState<UsageStats>(globalUsageTracker.getStats());
  const [isExpanded, setIsExpanded] = useState(true);
  
  useEffect(() => {
    // Subscribe to usage updates
    const unsubscribe = globalUsageTracker.subscribe(setStats);
    return unsubscribe;
  }, []);
  
  // Reset when a new run starts
  useEffect(() => {
    if (isRunning) {
      // Check if this is a fresh start (no requests yet)
      const currentStats = globalUsageTracker.getStats();
      if (currentStats.totalRequests === 0) {
        // Already reset, no action needed
      }
    }
  }, [isRunning]);
  
  const hasUsage = stats.totalRequests > 0;
  const modelEntries = Object.entries(stats.byModel);
  
  if (!hasUsage && !isRunning) {
    return null;
  }
  
  return (
    <div className="usage-display">
      <button 
        className="usage-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="usage-icon">💰</span>
        <span className="usage-title">Usage & Cost</span>
        <span className="usage-summary">
          {formatTokenCount(stats.totalInputTokens + stats.totalOutputTokens)} tokens • {formatCost(stats.estimatedCost)}
        </span>
        <span className={`usage-chevron ${isExpanded ? 'expanded' : ''}`}>▼</span>
      </button>
      
      {isExpanded && (
        <div className="usage-content">
          {/* Total summary */}
          <div className="usage-totals">
            <div className="usage-stat">
              <span className="stat-label">Total Tokens</span>
              <span className="stat-value">
                {formatTokenCount(stats.totalInputTokens + stats.totalOutputTokens)}
              </span>
            </div>
            <div className="usage-stat">
              <span className="stat-label">Input</span>
              <span className="stat-value">{formatTokenCount(stats.totalInputTokens)}</span>
            </div>
            <div className="usage-stat">
              <span className="stat-label">Output</span>
              <span className="stat-value">{formatTokenCount(stats.totalOutputTokens)}</span>
            </div>
            {stats.totalCachedTokens > 0 && (
              <div className="usage-stat cached">
                <span className="stat-label">Cached</span>
                <span className="stat-value">{formatTokenCount(stats.totalCachedTokens)}</span>
              </div>
            )}
            <div className="usage-stat">
              <span className="stat-label">Requests</span>
              <span className="stat-value">{stats.totalRequests}</span>
            </div>
            {stats.totalWebSearchCalls > 0 && (
              <div className="usage-stat">
                <span className="stat-label">Web Searches</span>
                <span className="stat-value">{stats.totalWebSearchCalls}</span>
              </div>
            )}
            <div className="usage-stat cost">
              <span className="stat-label">Est. Cost</span>
              <span className="stat-value">{formatCost(stats.estimatedCost)}</span>
            </div>
          </div>
          
          {/* Per-model breakdown */}
          {modelEntries.length > 0 && (
            <div className="usage-by-model">
              <h5>By Model</h5>
              <div className="model-list">
                {modelEntries.map(([model, usage]) => (
                  <div key={model} className="model-row">
                    <span className="model-name">{getModelDisplayName(model)}</span>
                    <span className="model-tokens">
                      {formatTokenCount(usage.inputTokens)}↓ {formatTokenCount(usage.outputTokens)}↑
                    </span>
                    <span className="model-requests">{usage.requests}req</span>
                    <span className="model-cost">{formatCost(calculateModelCost(model, usage))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="usage-note">
            <small>
              💡 Prices are estimated based on standard tier rates.
              Actual billing may vary.
            </small>
          </div>
        </div>
      )}
    </div>
  );
};
