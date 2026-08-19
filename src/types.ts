/**
 * Shared types for the Command Code Go for vscode extension.
 */

// ---- API request/response types ----

/**
 * Reasoning effort values supported by the picker.
 *
 * `none` means "do not send any reasoning parameters" — the model runs in its
 * default non-thinking mode. `low` / `medium` / `high` map directly onto the
 * OpenAI-compatible `reasoning_effort` field for models that advertise
 * reasoning capability.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

export type ThinkingEffort = 'none' | ReasoningEffort;

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
	role: ChatRole;
	/** Text content of the message. May be empty for tool/assistant turns. */
	content: string;
	tool_call_id?: string;
	tool_calls?: ChatToolCall[];
	reasoning_content?: string;
	/** Optional multimodal content for user messages (vision input). */
	parts?: ChatMessagePart[];
}

export interface ChatMessagePart {
	type: 'text' | 'image_url';
	text?: string;
	image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface ChatToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface ChatUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
}

/** Workspace and Git metadata required by the Command Code generate endpoint. */
export interface CommandCodeRequestConfig {
	workingDir: string;
	date: string;
	environment: 'cli';
	structure: unknown[];
	isGitRepo: boolean;
	currentBranch: string;
	mainBranch: string;
	gitStatus: string;
	recentCommits: string[];
}

/** A message encoded in the `params.messages` format used by `/alpha/generate`. */
export interface CommandCodeGenerateMessage {
	role: ChatRole;
	content: ChatMessagePart[];
	tool_call_id?: string;
	tool_calls?: ChatToolCall[];
	reasoning_content?: string;
}

/** Parameters accepted by the Command Code generate endpoint. */
export interface CommandCodeGenerateParams {
	model: string;
	messages: CommandCodeGenerateMessage[];
	tools: ChatTool[];
	system: string;
	max_tokens: number;
	temperature: number;
	stream: true;
	tool_choice?: 'none' | 'auto' | 'required';
	reasoning_effort?: ReasoningEffort;
}

/**
 * Request envelope used by `POST /alpha/generate`.
 *
 * `memory`, `taste`, and `skills` are deliberately empty for the VS Code
 * integration. Command Code's CLI owns those values; VS Code already sends
 * its chat context as `params.messages`.
 */
export interface ChatRequest {
	config: CommandCodeRequestConfig;
	memory: '';
	taste: '';
	skills: '';
	params: CommandCodeGenerateParams;
	threadId: string;
}

// ---- Stream callbacks ----

export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: ChatToolCall) => void;
	onError: (error: Error) => void;
	onDone: () => void;
	onUsage?: (usage: ChatUsage) => void;
}

// ---- Model registry ----

export interface ThinkingCapability {
	/** Effort values that appear in the model picker dropdown. */
	supportedEfforts: readonly ReasoningEffort[];
	defaultEffort: ReasoningEffort;
	/** When true, `none` is offered alongside the configured efforts. */
	canDisable: boolean;
}

export interface ModelDefinition {
	id: string;
	name: string;
	family: string;
	version: string;
	detail: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: {
		toolCalling: boolean | number;
		imageInput: boolean;
		thinking: ThinkingCapability | false;
	};
	/** Optional category used to group models in logs/UI. */
	category?: string;
}
