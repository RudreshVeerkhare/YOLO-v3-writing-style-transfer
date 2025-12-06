// ============================================================
// OpenAI Client Wrapper for YOLO-Style Paper Rewriter
// ============================================================

import OpenAI from 'openai';
import { globalUsageTracker } from './usageTracker';

// Model selection based on task complexity and cost:
// 
// REASONING MODELS (support max_completion_tokens, no temperature):
// - gpt-5.1:     Best reasoning model - use for critical review tasks
// - gpt-5-mini:  $0.25/$2 per 1M tokens  - Good reasoning, balanced cost
// - gpt-5-nano:  $0.05/$0.40 per 1M tokens - Fast/cheap reasoning for simple tasks
//
// NON-REASONING MODELS (support max_tokens, temperature):
// - gpt-4.1:      Smartest non-reasoning model - good for structured tasks
// - gpt-4.1-mini: Cheaper, faster - good for simple transformations
// - gpt-4.1-nano: Cheapest - good for classification/extraction
//
// WEB SEARCH MODELS (special models with web access):
// - gpt-4o-search-preview: Web search enabled for research
//
export type ReasoningModel = 'gpt-5.1' | 'gpt-5-mini' | 'gpt-5-nano';
export type NonReasoningModel = 'gpt-4.1' | 'gpt-4.1-mini' | 'gpt-4.1-nano';
export type WebSearchModel = 'gpt-4o-search-preview' | 'gpt-4o-mini-search-preview';
export type ModelType = ReasoningModel | NonReasoningModel | WebSearchModel;

const REASONING_MODELS: Set<string> = new Set(['gpt-5.1', 'gpt-5-mini', 'gpt-5-nano']);
// WEB_SEARCH_MODELS are handled separately via webSearchCompletion function

export interface OpenAIClientConfig {
  apiKey: string;
  dangerouslyAllowBrowser?: boolean;
}

export interface ChatCompletionOptions {
  model: ModelType;
  systemPrompt: string;
  userContent: string;
  maxTokens?: number;
  temperature?: number; // Only used for non-reasoning models
  responseFormat?: 'json' | 'text';
  onStream?: (chunk: string) => void;
}

/**
 * Creates an OpenAI client configured for browser use
 */
export function createOpenAIClient(config: OpenAIClientConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true, // Required for client-side usage
  });
}

/**
 * Makes a chat completion request
 * Automatically handles differences between reasoning and non-reasoning models
 */
export async function chatCompletion(
  client: OpenAI,
  options: ChatCompletionOptions
): Promise<string> {
  const {
    model,
    systemPrompt,
    userContent,
    maxTokens = 16000,
    temperature,
    responseFormat = 'text',
  } = options;

  const isReasoning = REASONING_MODELS.has(model);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  // Build request params based on model type
  const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined,
  };

  if (isReasoning) {
    // Reasoning models use max_completion_tokens, don't support temperature
    requestParams.max_completion_tokens = maxTokens;
  } else {
    // Non-reasoning models use max_tokens, support temperature
    requestParams.max_tokens = maxTokens;
    if (temperature !== undefined) {
      requestParams.temperature = temperature;
    }
  }

  console.log(`[OpenAI] Calling ${model} (reasoning: ${isReasoning}, format: ${responseFormat}, maxTokens: ${maxTokens})`);
  console.log(`[OpenAI] System prompt length: ${systemPrompt.length} chars`);
  console.log(`[OpenAI] User content length: ${userContent.length} chars`);

  let response;
  try {
    response = await client.chat.completions.create(requestParams);
  } catch (apiError: unknown) {
    const err = apiError as Error & { status?: number; code?: string; type?: string };
    console.error('[OpenAI] API call failed:', {
      message: err.message,
      status: err.status,
      code: err.code,
      type: err.type,
      model,
      isReasoning,
    });
    throw new Error(`OpenAI API error: ${err.message} (status: ${err.status || 'unknown'}, code: ${err.code || 'unknown'})`);
  }

  const choice = response.choices[0];
  
  console.log(`[OpenAI] Response received:`, {
    model: response.model,
    finishReason: choice?.finish_reason,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    totalTokens: response.usage?.total_tokens,
  });
  
  // Check for refusal (some models can refuse)
  if (choice?.message?.refusal) {
    console.error('[OpenAI] Model refused the request:', choice.message.refusal);
    throw new Error(`Model refused request: ${choice.message.refusal}`);
  }
  
  // Check for truncation
  if (choice?.finish_reason === 'length') {
    console.warn('[OpenAI] Response was truncated due to length limit');
  }
  
  // Check finish reason for issues
  if (choice?.finish_reason === 'content_filter') {
    console.error('[OpenAI] Response was filtered by content filter');
    throw new Error('Response blocked by content filter');
  }
  
  // Get content
  let content = choice?.message?.content || '';
  
  if (!content) {
    // Log detailed info for debugging
    console.error('[OpenAI] Empty response! Full details:', {
      finishReason: choice?.finish_reason,
      hasMessage: !!choice?.message,
      messageKeys: choice?.message ? Object.keys(choice.message) : [],
      messageContent: choice?.message,
      choicesCount: response.choices?.length,
      allChoices: response.choices,
      model: response.model,
      usage: response.usage,
      systemFingerprint: response.system_fingerprint,
    });
    throw new Error(`Empty response from ${model} (finish_reason: ${choice?.finish_reason || 'unknown'}, tokens: ${response.usage?.completion_tokens || 0})`);
  }
  
  console.log(`[OpenAI] Content received: ${content.length} chars`);
  
  // Track usage
  if (response.usage) {
    globalUsageTracker.recordUsage(response.model || model, {
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
      prompt_tokens_details: (response.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details,
      completion_tokens_details: (response.usage as { completion_tokens_details?: { reasoning_tokens?: number } }).completion_tokens_details,
    });
  }
  
  return content;
}

/**
 * Web search interface for research
 */
export interface WebSearchResult {
  content: string;
  citations: Array<{
    url: string;
    title: string;
  }>;
}

/**
 * Makes an agentic web search using the Responses API with gpt-5
 * This is similar to how ChatGPT's browse feature works - the model
 * actively decides what to search, analyzes results, and may search again.
 */
export async function webSearchCompletion(
  client: OpenAI,
  query: string,
  context?: string
): Promise<WebSearchResult> {
  const userContent = context 
    ? `Context: ${context}\n\nResearch task: ${query}\n\nPlease search the web thoroughly and provide comprehensive, factual information with citations.`
    : `Research task: ${query}\n\nPlease search the web thoroughly and provide comprehensive, factual information with citations.`;
    
  console.log(`[OpenAI WebSearch] Agentic search: ${query.slice(0, 100)}...`);
  
  try {
    // Use Responses API with web_search tool for agentic search
    // The model will actively search, analyze, and may search again
    const apiKey = client.apiKey;
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5',  // Use gpt-5 for agentic reasoning search
        tools: [
          { 
            type: 'web_search',
            search_context_size: 'high',  // More context for better results
          }
        ],
        tool_choice: 'auto',
        input: userContent,
        reasoning: { effort: 'medium' },  // Balance between depth and speed
        include: ['web_search_call.action.sources'],  // Include sources
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Responses API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json() as {
      output_text?: string;
      output?: Array<{
        type: string;
        content?: Array<{
          type: string;
          text?: string;
          annotations?: Array<{ type: string; url?: string; title?: string }>;
        }>;
      }>;
    };
    
    // Extract content and citations from Responses API format
    let content = '';
    const citations: Array<{ url: string; title: string }> = [];
    
    if (data.output_text) {
      content = data.output_text;
    }
    
    // Extract citations from output
    if (data.output) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const contentItem of item.content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
              content = contentItem.text;
            }
            if (contentItem.annotations) {
              for (const annotation of contentItem.annotations) {
                if (annotation.type === 'url_citation' && annotation.url) {
                  citations.push({
                    url: annotation.url,
                    title: annotation.title || annotation.url,
                  });
                }
              }
            }
          }
        }
      }
    }
    
    console.log(`[OpenAI WebSearch] Found ${citations.length} citations, ${content.length} chars`);
    
    // Track web search usage (responses API - estimate tokens)
    // Responses API doesn't return usage in the same format, estimate based on content
    const estimatedInputTokens = Math.ceil(userContent.length / 4);
    const estimatedOutputTokens = Math.ceil(content.length / 4);
    globalUsageTracker.recordUsage('gpt-5', {
      prompt_tokens: estimatedInputTokens,
      completion_tokens: estimatedOutputTokens,
    }, 1); // 1 web search call
    
    return { content, citations };
  } catch (e) {
    console.warn('[OpenAI WebSearch] Responses API failed, falling back to Chat Completions:', e);
    
    // Fallback to Chat Completions with search model
    return webSearchCompletionFallback(client, query, context);
  }
}

/**
 * Fallback web search using Chat Completions API with improved prompts
 */
async function webSearchCompletionFallback(
  client: OpenAI,
  query: string,
  context?: string
): Promise<WebSearchResult> {
  const userContent = context 
    ? `Context: ${context}\n\nResearch task: ${query}`
    : `Research task: ${query}`;
    
  console.log(`[OpenAI WebSearch Fallback] Using gpt-4o-search-preview`);
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { 
      role: 'system', 
      content: `You are a thorough research assistant with web search capabilities. 

IMPORTANT: You MUST actively search the web to answer. Do not rely on training data alone.

Your task is to search the web and provide detailed, factual information. Be specific:
- Include concrete facts, numbers, dates, and names
- Name specific people, organizations, institutions, and projects  
- Cite specific sources with full URLs
- If searching for a person, find their affiliation, title, notable work, Google Scholar profile
- If searching for a paper/research, find discussions, implementations, GitHub repos, blog posts

Search strategies:
1. If looking for a person, search their full name + "researcher" or "professor"
2. Search for their Google Scholar or DBLP profile
3. Look for their institutional homepage or personal website
4. Search social media (Twitter/X) for their handle

Do NOT say "I couldn't find information" without trying multiple search strategies.
Do NOT give generic or vague answers. Provide specific, verifiable facts with sources.`
    },
    { role: 'user', content: userContent },
  ];

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-search-preview',
      messages,
      max_tokens: 3000,
      web_search_options: {
        search_context_size: 'high',  // More context
      },
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

    const choice = response.choices[0];
    const content = choice?.message?.content || '';
    
    // Extract citations from annotations if available
    const citations: Array<{ url: string; title: string }> = [];
    const message = choice?.message as OpenAI.Chat.ChatCompletionMessage & { 
      annotations?: Array<{ type: string; url?: string; title?: string }> 
    };
    
    if (message?.annotations) {
      for (const annotation of message.annotations) {
        if (annotation.type === 'url_citation' && annotation.url) {
          citations.push({
            url: annotation.url,
            title: annotation.title || annotation.url,
          });
        }
      }
    }
    
    console.log(`[OpenAI WebSearch] Found ${citations.length} citations`);
    
    // Track usage with web search call
    if (response.usage) {
      globalUsageTracker.recordUsage('gpt-4o-search-preview', {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
      }, 1); // 1 web search call
    }
    
    return { content, citations };
  } catch (e) {
    console.error('[OpenAI WebSearch] Search failed:', e);
    // Return empty result instead of throwing
    return { content: '', citations: [] };
  }
}

/**
 * Parse JSON response safely with error handling
 * Handles various formats including markdown code blocks and partial JSON
 */
export function parseJSONResponse<T>(response: string): T {
  if (!response || response.trim() === '') {
    throw new Error('Empty response - cannot parse JSON');
  }
  
  let jsonString = response.trim();
  
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }
  
  // Try to find JSON object or array boundaries
  const jsonObjectMatch = jsonString.match(/(\{[\s\S]*\})/);
  const jsonArrayMatch = jsonString.match(/(\[[\s\S]*\])/);
  
  if (jsonObjectMatch) {
    jsonString = jsonObjectMatch[1];
  } else if (jsonArrayMatch) {
    jsonString = jsonArrayMatch[1];
  }
  
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    // Log what we received for debugging
    console.error('Failed to parse JSON. Response preview:', jsonString.slice(0, 500));
    console.error('Response length:', jsonString.length);
    
    // Try to repair common JSON issues
    try {
      // Sometimes trailing content after valid JSON
      const repaired = extractValidJSON(jsonString);
      if (repaired) {
        return JSON.parse(repaired) as T;
      }
    } catch {
      // Repair failed
    }
    
    throw new Error(`Failed to parse JSON response: ${error}`);
  }
}

/**
 * Attempt to extract valid JSON from a string that might have extra content
 */
function extractValidJSON(str: string): string | null {
  // Find the start of JSON
  const startObj = str.indexOf('{');
  const startArr = str.indexOf('[');
  
  let start = -1;
  let isObject = true;
  
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
    start = startObj;
    isObject = true;
  } else if (startArr >= 0) {
    start = startArr;
    isObject = false;
  }
  
  if (start < 0) return null;
  
  // Try to find matching end bracket
  let depth = 0;
  const openBracket = isObject ? '{' : '[';
  const closeBracket = isObject ? '}' : ']';
  
  for (let i = start; i < str.length; i++) {
    if (str[i] === openBracket) depth++;
    if (str[i] === closeBracket) depth--;
    
    if (depth === 0) {
      return str.slice(start, i + 1);
    }
  }
  
  return null;
}

/**
 * Utility to truncate content to fit within token limits
 * Rough estimation: 1 token ≈ 4 characters
 */
export function truncateForTokenLimit(content: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) {
    return content;
  }
  return content.slice(0, maxChars) + '\n\n[... content truncated for token limits ...]';
}
