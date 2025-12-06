// ============================================================
// Usage Tracker - Tracks token usage and estimates cost
// ============================================================

/**
 * Model pricing per 1M tokens (Standard tier)
 * Source: https://platform.openai.com/docs/pricing
 * Last updated: December 2025
 * 
 * Note: There's no API to fetch prices dynamically.
 * These must be updated manually when OpenAI changes pricing.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // GPT-5 family
  'gpt-5.1': { input: 10.00, output: 40.00 },
  'gpt-5': { input: 10.00, output: 40.00 },
  'gpt-5-mini': { input: 2.00, output: 8.00 },
  'gpt-5-nano': { input: 0.40, output: 1.60 },
  
  // GPT-4.1 family
  'gpt-4.1': { input: 8.00, output: 32.00 },
  'gpt-4.1-mini': { input: 1.60, output: 6.40 },
  'gpt-4.1-nano': { input: 0.40, output: 1.60 },
  
  // GPT-4o family
  'gpt-4o': { input: 10.00, output: 40.00 },
  'gpt-4o-mini': { input: 0.60, output: 2.40 },
  
  // Search models
  'gpt-4o-search-preview': { input: 10.00, output: 40.00 },
  'gpt-4o-mini-search-preview': { input: 0.60, output: 2.40 },
  'gpt-5-search-api': { input: 10.00, output: 40.00 },
  
  // Reasoning models (o-series)
  'o3': { input: 8.00, output: 32.00 },
  'o3-mini': { input: 4.40, output: 17.60 },
  'o4-mini': { input: 4.40, output: 17.60 },
  'o1': { input: 60.00, output: 240.00 },
  'o1-mini': { input: 4.40, output: 17.60 },
};

/**
 * Web search tool pricing
 * $10 per 1000 calls for reasoning models
 * $25 per 1000 calls for non-reasoning models (preview)
 */
export const WEB_SEARCH_COST_PER_CALL = 0.01; // $10/1000 = $0.01 per call

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  requests: number;
  webSearchCalls: number;
}

export interface UsageStats {
  byModel: Record<string, ModelUsage>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalReasoningTokens: number;
  totalRequests: number;
  totalWebSearchCalls: number;
  estimatedCost: number;
}

/**
 * Creates an empty usage stats object
 */
function createEmptyStats(): UsageStats {
  return {
    byModel: {},
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
    totalReasoningTokens: 0,
    totalRequests: 0,
    totalWebSearchCalls: 0,
    estimatedCost: 0,
  };
}

/**
 * Creates empty model usage
 */
function createEmptyModelUsage(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    requests: 0,
    webSearchCalls: 0,
  };
}

/**
 * Calculates cost for a model's usage
 */
export function calculateModelCost(model: string, usage: ModelUsage): number {
  // Normalize model name (remove date suffixes like -2025-04-14)
  const normalizedModel = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const pricing = MODEL_PRICING[normalizedModel] || MODEL_PRICING[model];
  
  if (!pricing) {
    console.warn(`[UsageTracker] Unknown model pricing: ${model}, using gpt-4.1 rates`);
    // Fallback to gpt-4.1 pricing
    return (
      (usage.inputTokens / 1_000_000) * 8.00 +
      (usage.outputTokens / 1_000_000) * 32.00 +
      usage.webSearchCalls * WEB_SEARCH_COST_PER_CALL
    );
  }
  
  // Cached tokens are typically free or discounted - assume free
  const billableInputTokens = usage.inputTokens - usage.cachedTokens;
  
  return (
    (billableInputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output +
    usage.webSearchCalls * WEB_SEARCH_COST_PER_CALL
  );
}

/**
 * Usage tracker class - accumulates usage across multiple API calls
 */
export class UsageTracker {
  private stats: UsageStats;
  private listeners: Set<(stats: UsageStats) => void>;
  
  constructor() {
    this.stats = createEmptyStats();
    this.listeners = new Set();
  }
  
  /**
   * Record usage from an API response
   */
  recordUsage(
    model: string,
    usage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: {
        cached_tokens?: number;
      };
      completion_tokens_details?: {
        reasoning_tokens?: number;
      };
    },
    webSearchCalls = 0
  ): void {
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
    
    // Initialize model entry if needed
    if (!this.stats.byModel[model]) {
      this.stats.byModel[model] = createEmptyModelUsage();
    }
    
    // Update model stats
    const modelStats = this.stats.byModel[model];
    modelStats.inputTokens += inputTokens;
    modelStats.outputTokens += outputTokens;
    modelStats.cachedTokens += cachedTokens;
    modelStats.reasoningTokens += reasoningTokens;
    modelStats.requests += 1;
    modelStats.webSearchCalls += webSearchCalls;
    
    // Update totals
    this.stats.totalInputTokens += inputTokens;
    this.stats.totalOutputTokens += outputTokens;
    this.stats.totalCachedTokens += cachedTokens;
    this.stats.totalReasoningTokens += reasoningTokens;
    this.stats.totalRequests += 1;
    this.stats.totalWebSearchCalls += webSearchCalls;
    
    // Recalculate total cost
    this.stats.estimatedCost = Object.entries(this.stats.byModel).reduce(
      (sum, [modelName, modelUsage]) => sum + calculateModelCost(modelName, modelUsage),
      0
    );
    
    // Notify listeners
    this.notifyListeners();
  }
  
  /**
   * Get current stats
   */
  getStats(): UsageStats {
    return { ...this.stats };
  }
  
  /**
   * Reset all stats
   */
  reset(): void {
    this.stats = createEmptyStats();
    this.notifyListeners();
  }
  
  /**
   * Subscribe to usage updates
   */
  subscribe(listener: (stats: UsageStats) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private notifyListeners(): void {
    const statsCopy = this.getStats();
    this.listeners.forEach(listener => listener(statsCopy));
  }
}

/**
 * Format token count for display
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toString();
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Get model display name - clear and informative
 */
export function getModelDisplayName(model: string): string {
  // Remove date suffixes
  const clean = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  
  // Map to friendly names with task context
  const displayNames: Record<string, string> = {
    'gpt-5.1': 'GPT-5.1 (Critique)',
    'gpt-5': 'GPT-5 (Web Search)',
    'gpt-5-mini': 'GPT-5 Mini (Rewrite)',
    'gpt-5-nano': 'GPT-5 Nano (Tasks)',
    'gpt-4.1': 'GPT-4.1',
    'gpt-4.1-mini': 'GPT-4.1 Mini',
    'gpt-4.1-nano': 'GPT-4.1 Nano',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o-search-preview': 'GPT-4o Search',
    'gpt-4o-mini-search-preview': 'GPT-4o Mini Search',
    'gpt-5-search-api': 'GPT-5 Search API',
    'o3': 'o3',
    'o3-mini': 'o3 Mini',
    'o4-mini': 'o4 Mini',
    'o1': 'o1',
    'o1-mini': 'o1 Mini',
  };
  
  return displayNames[clean] || clean;
}

// Global singleton tracker
export const globalUsageTracker = new UsageTracker();
