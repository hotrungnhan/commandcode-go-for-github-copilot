import type { CancellationToken } from 'vscode';
import { logger } from '../logger';
import { DEFAULT_BASE_URL, COMMAND_CODE_CLIENT_VERSION } from '../consts';
import { safeStringify } from '../json';
import type { ChatRequest, ChatToolCall, ChatUsage, StreamCallbacks } from '../types';
import { createHttpError, formatRequestError, normalizeRequestError } from './error';

export interface ClientOptions {
	/** Optional extra headers attached to every request (e.g. `x-cmdc-zdr: 1`). */
	extraHeaders?: Record<string, string>;
	/** Surface non-fatal request metadata in logs. */
	debug?: boolean;
}

const ZDR_HEADER_NAME = 'x-cmdc-zdr';
const ZDR_HEADER_VALUE = '1';

/** Lightweight client for Command Code's Generate API, using built-in `fetch`. */
export class CommandCodeClient {
	private readonly baseUrl = DEFAULT_BASE_URL;
	private readonly apiKey: string;
	private readonly options: ClientOptions;

	constructor(apiKey: string, options: ClientOptions = {}) {
		this.apiKey = apiKey;
		this.options = options;
	}

	/**
	 * Stream a response from the Command Code Generate API. The endpoint emits
	 * AI SDK data-stream events (JSONL, sometimes framed as SSE), rather than
	 * OpenAI chat-completion chunks.
	 */
	async streamChatCompletion(
		request: ChatRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => {
			controller.abort();
		});
		if (cancellationToken?.isCancellationRequested) {
			controller.abort();
		}

		const url = `${this.baseUrl}/generate`;
		const headers = this.buildHeaders();

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers,
				body: safeStringify(request),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw await createHttpError(response, {
					baseUrl: this.baseUrl,
					request,
				});
			}

			if (!response.body) {
				throw new Error('No response body received');
			}

			await this.consumeStream(response.body, callbacks, request, cancellationToken, controller);
		} catch (error) {
			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				return;
			}
			const normalized = normalizeRequestError(error, {
				baseUrl: this.baseUrl,
				request,
			});
			if (this.options.debug) {
				logger.error('Command Code request failed:', formatRequestError(normalized));
			}
			callbacks.onError(normalized);
		} finally {
			cancelListener?.dispose();
		}
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.apiKey}`,
			Accept: 'text/event-stream',
			'x-command-code-version': COMMAND_CODE_CLIENT_VERSION,
			'x-cli-environment': 'production',
		};
		if (this.options.extraHeaders) {
			Object.assign(headers, this.options.extraHeaders);
		}
		return headers;
	}

	private async consumeStream(
		body: ReadableStream<Uint8Array>,
		callbacks: StreamCallbacks,
		request: ChatRequest,
		cancellationToken: CancellationToken | undefined,
		controller: AbortController,
	): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let latestUsage: ChatUsage | undefined;
		let protocol: 'sse' | 'jsonl' | undefined;
		let doneNotified = false;
		const pendingToolCalls = new Map<string, ChatToolCall>();
		const completedToolCallIds = new Set<string>();

		const finish = () => {
			if (doneNotified) {
				return;
			}
			doneNotified = true;
			flushToolCalls(pendingToolCalls, callbacks);
			reportFinalUsage(callbacks, latestUsage);
			callbacks.onDone();
		};

		const handlePayload = (payload: string) => {
			if (doneNotified) {
				return;
			}
			if (!payload || payload === '[DONE]') {
				finish();
				return;
			}

			let event: GenerateStreamEvent;
			try {
				event = JSON.parse(payload) as GenerateStreamEvent;
			} catch (parseError) {
				if (this.options.debug) {
					logger.warn(`Failed to parse stream event: ${payload.slice(0, 200)}`, parseError);
				}
				return;
			}
			const usage = handleGenerateEvent(event, callbacks, pendingToolCalls, completedToolCallIds);
			if (usage) {
				latestUsage = usage;
			}
			if (event.type === 'finish') {
				finish();
			}
		};

		try {
			while (true) {
				if (cancellationToken?.isCancellationRequested) {
					controller.abort();
					return;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				protocol ??= detectStreamProtocol(buffer);

				if (protocol === 'sse') {
					const frames = buffer.split(/\r?\n\r?\n/u);
					buffer = frames.pop() ?? '';
					for (const frame of frames) {
						for (const payload of getSsePayloads(frame)) {
							handlePayload(payload);
						}
					}
				} else if (protocol === 'jsonl') {
					const result = takeJsonObjects(buffer);
					buffer = result.remainder;
					for (const payload of result.objects) {
						handlePayload(payload);
					}
				}
			}

			buffer += decoder.decode();
			if (protocol === 'sse' && buffer.trim()) {
				for (const payload of getSsePayloads(buffer)) {
					handlePayload(payload);
				}
			} else if (protocol === 'jsonl' && buffer.trim()) {
				const result = takeJsonObjects(buffer);
				for (const payload of result.objects) {
					handlePayload(payload);
				}
			}
			finish();
		} catch (error) {
			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				return;
			}
			const normalized = normalizeRequestError(error, {
				baseUrl: this.baseUrl,
				request,
			});
			if (this.options.debug) {
				logger.error('Command Code stream failed:', formatRequestError(normalized));
			}
			callbacks.onError(normalized);
		}
	}
}

/** Header key/value pair attached to every Command Code request. */
export const ZDR_HEADER: Record<string, string> = {
	[ZDR_HEADER_NAME]: ZDR_HEADER_VALUE,
};

function reportFinalUsage(callbacks: StreamCallbacks, usage: ChatUsage | undefined): void {
	if (!usage || !callbacks.onUsage) {
		return;
	}
	callbacks.onUsage(usage);
}

function flushToolCalls(pending: Map<string, ChatToolCall>, callbacks: StreamCallbacks): void {
	for (const tc of pending.values()) {
		callbacks.onToolCall(tc);
	}
	pending.clear();
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

interface GenerateStreamEvent {
	type?: string;
	id?: string;
	text?: string;
	delta?: string;
	toolCallId?: string;
	toolName?: string;
	input?: unknown;
	usage?: unknown;
	totalUsage?: unknown;
	errorText?: string;
	error?: unknown;
}

function handleGenerateEvent(
	event: GenerateStreamEvent,
	callbacks: StreamCallbacks,
	pendingToolCalls: Map<string, ChatToolCall>,
	completedToolCallIds: Set<string>,
): ChatUsage | undefined {
	switch (event.type) {
		case 'reasoning-delta':
			if (event.text) {
				callbacks.onThinking(event.text);
			}
			break;
		case 'text-delta':
			if (event.text) {
				callbacks.onContent(event.text);
			}
			break;
		case 'tool-input-start':
			startToolCall(event, pendingToolCalls, completedToolCallIds);
			break;
		case 'tool-input-delta': {
			appendToolCallArguments(event, pendingToolCalls, completedToolCallIds);
			break;
		}
		case 'tool-call':
		case 'tool-input-available':
			completeToolCall(event, callbacks, pendingToolCalls, completedToolCallIds);
			break;
		case 'tool-use':
			startToolCall(event, pendingToolCalls, completedToolCallIds);
			break;
		case 'tool-delta':
			appendToolCallArguments(event, pendingToolCalls, completedToolCallIds);
			break;
		case 'error':
			throw new Error(getGenerateErrorMessage(event));
		case 'finish-step':
			return toChatUsage(event.usage);
		case 'finish':
			return toChatUsage(event.totalUsage) ?? toChatUsage(event.usage);
		default:
			break;
	}

	return undefined;
}

/**
 * Command Code's incremental events use `id`; only the final `tool-call`
 * event uses `toolCallId`. Supporting both also keeps the client compatible
 * with older data-stream event names.
 */
function getToolCallId(event: GenerateStreamEvent): string | undefined {
	return event.toolCallId ?? event.id;
}

function startToolCall(
	event: GenerateStreamEvent,
	pendingToolCalls: Map<string, ChatToolCall>,
	completedToolCallIds: Set<string>,
): void {
	const toolCallId = getToolCallId(event);
	if (!toolCallId || completedToolCallIds.has(toolCallId)) {
		return;
	}

	const call = pendingToolCalls.get(toolCallId);
	if (call) {
		if (event.toolName) {
			call.function.name = event.toolName;
		}
		return;
	}

	if (event.toolName) {
		pendingToolCalls.set(toolCallId, {
			id: toolCallId,
			type: 'function',
			function: { name: event.toolName, arguments: '' },
		});
	}
}

function appendToolCallArguments(
	event: GenerateStreamEvent,
	pendingToolCalls: Map<string, ChatToolCall>,
	completedToolCallIds: Set<string>,
): void {
	const toolCallId = getToolCallId(event);
	const call = toolCallId ? pendingToolCalls.get(toolCallId) : getLatestToolCall(pendingToolCalls);
	if (!call || completedToolCallIds.has(call.id)) {
		return;
	}

	const argumentsDelta = event.delta ?? event.text;
	if (argumentsDelta) {
		call.function.arguments += argumentsDelta;
	}
}

function getLatestToolCall(pendingToolCalls: Map<string, ChatToolCall>): ChatToolCall | undefined {
	let latest: ChatToolCall | undefined;
	for (const call of pendingToolCalls.values()) {
		latest = call;
	}
	return latest;
}

function completeToolCall(
	event: GenerateStreamEvent,
	callbacks: StreamCallbacks,
	pendingToolCalls: Map<string, ChatToolCall>,
	completedToolCallIds: Set<string>,
): void {
	const toolCallId = getToolCallId(event);
	if (!toolCallId || completedToolCallIds.has(toolCallId)) {
		return;
	}

	const call = pendingToolCalls.get(toolCallId) ?? {
		id: toolCallId,
		type: 'function' as const,
		function: { name: '', arguments: '' },
	};
	if (event.toolName) {
		call.function.name = event.toolName;
	}
	if (!call.function.name) {
		return;
	}
	if (event.input !== undefined) {
		call.function.arguments =
			typeof event.input === 'string' ? event.input : safeStringify(event.input);
	}

	pendingToolCalls.delete(toolCallId);
	completedToolCallIds.add(toolCallId);
	callbacks.onToolCall(call);
}

function detectStreamProtocol(buffer: string): 'sse' | 'jsonl' | undefined {
	const firstContent = buffer.trimStart();
	if (!firstContent) {
		return undefined;
	}
	return firstContent.startsWith('data:') ||
		firstContent.startsWith('event:') ||
		firstContent.startsWith(':')
		? 'sse'
		: 'jsonl';
}

function getSsePayloads(frame: string): string[] {
	const dataLines = frame
		.split(/\r?\n/u)
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trimStart());
	return dataLines.length > 0 ? [dataLines.join('\n')] : [];
}

function takeJsonObjects(buffer: string): { objects: string[]; remainder: string } {
	const objects: string[] = [];
	let cursor = 0;

	while (cursor < buffer.length) {
		while (cursor < buffer.length && /\s/u.test(buffer[cursor]!)) {
			cursor += 1;
		}
		if (cursor === buffer.length) {
			return { objects, remainder: '' };
		}
		if (buffer[cursor] !== '{') {
			return { objects, remainder: buffer.slice(cursor) };
		}

		const start = cursor;
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (; cursor < buffer.length; cursor += 1) {
			const character = buffer[cursor]!;
			if (inString) {
				if (escaped) {
					escaped = false;
				} else if (character === '\\') {
					escaped = true;
				} else if (character === '"') {
					inString = false;
				}
				continue;
			}
			if (character === '"') {
				inString = true;
			} else if (character === '{') {
				depth += 1;
			} else if (character === '}') {
				depth -= 1;
				if (depth === 0) {
					objects.push(buffer.slice(start, cursor + 1));
					cursor += 1;
					break;
				}
			}
		}

		if (depth !== 0 || inString) {
			return { objects, remainder: buffer.slice(start) };
		}
	}

	return { objects, remainder: '' };
}

function toChatUsage(value: unknown): ChatUsage | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const raw = isRecord(value.raw) ? value.raw : undefined;
	const promptTokens = numberAt(value.inputTokens) ?? numberAt(raw?.prompt_tokens);
	const completionTokens = numberAt(value.outputTokens) ?? numberAt(raw?.completion_tokens);
	const totalTokens = numberAt(value.totalTokens) ?? numberAt(raw?.total_tokens);
	if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) {
		return undefined;
	}

	const inputDetails = isRecord(value.inputTokenDetails) ? value.inputTokenDetails : undefined;
	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: totalTokens,
		prompt_cache_hit_tokens:
			numberAt(value.cachedInputTokens) ??
			numberAt(inputDetails?.cacheReadTokens) ??
			numberAt(raw?.prompt_cache_hit_tokens),
		prompt_cache_miss_tokens:
			numberAt(inputDetails?.noCacheTokens) ?? numberAt(raw?.prompt_cache_miss_tokens),
	};
}

function getGenerateErrorMessage(event: GenerateStreamEvent): string {
	if (event.errorText) {
		return event.errorText;
	}
	if (typeof event.error === 'string' && event.error) {
		return event.error;
	}
	return 'Command Code Generate API returned a stream error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function numberAt(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
