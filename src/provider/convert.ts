import vscode from 'vscode';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../consts';
import { safeStringify } from '../json';
import type {
	ChatMessage,
	ChatMessagePart,
	ChatTool,
	ChatToolCall,
	CommandCodeMessagePart,
	CommandCodeTool,
	CommandCodeGenerateMessage,
} from '../types';

/**
 * Convert VS Code chat messages to OpenAI-compatible format. Images are
 * emitted as multimodal `content` arrays for vision-capable models and as
 * plain text otherwise (matching the upstream behavior).
 */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: { imageInput: boolean },
): ChatMessage[] {
	const result: ChatMessage[] = [];

	for (const message of messages) {
		const role = mapRole(message.role);

		const textSegments: string[] = [];
		const imageSegments: ChatMessagePart[] = [];
		let thinkingContent = '';
		const toolCalls: ChatToolCall[] = [];
		const toolResults: Array<{ callId: string; content: string }> = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textSegments.push(part.value);
			} else if (isLanguageModelThinkingPart(part)) {
				thinkingContent += normalizeThinkingPartText(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: {
						name: part.name,
						arguments: safeStringify(part.input),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				let toolContent = '';
				for (const item of part.content) {
					if (item instanceof vscode.LanguageModelTextPart) {
						toolContent += item.value;
					}
				}
				toolResults.push({
					callId: part.callId,
					content: toolContent || safeStringify(part.content),
				});
			} else if (part instanceof vscode.LanguageModelDataPart) {
				if (options.imageInput && part.mimeType.startsWith('image/')) {
					const url = `data:${part.mimeType};base64,${encodeBase64(part.data)}`;
					imageSegments.push({
						type: 'image_url',
						image_url: { url, detail: 'auto' },
					});
				}
				// Non-image data parts are intentionally ignored — the upstream
				// API only accepts text + image_url parts.
			}
		}

		const text = textSegments.join('');

		if (role === 'assistant') {
			if (text || thinkingContent || toolCalls.length > 0) {
				const msg: ChatMessage = {
					role: 'assistant',
					content: text,
				};
				if (toolCalls.length > 0) {
					msg.tool_calls = toolCalls;
				}
				if (thinkingContent) {
					msg.reasoning_content = thinkingContent;
				}
				result.push(msg);
			}
		} else if (role === 'user') {
			if (text || imageSegments.length > 0) {
				if (imageSegments.length > 0 && options.imageInput) {
					const parts: ChatMessagePart[] = [];
					if (text) {
						parts.push({ type: 'text', text });
					}
					parts.push(...imageSegments);
					result.push({
						role: 'user',
						content: text,
						parts,
					});
				} else {
					result.push({ role: 'user', content: text });
				}
			}
		} else if (role === 'system') {
			if (text) {
				result.push({ role: 'system', content: text });
			}
		}

		for (const tr of toolResults) {
			result.push({
				role: 'tool',
				content: tr.content,
				tool_call_id: tr.callId,
			});
		}
	}

	return result;
}

function encodeBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(bytes).toString('base64');
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]!);
	}
	// btoa is available in the extension host
	return btoa(binary);
}

function isLanguageModelThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
	return (
		typeof vscode.LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

function normalizeThinkingPartText(value: string | string[]): string {
	return Array.isArray(value) ? value.join('') : value;
}

function mapRole(role: vscode.LanguageModelChatMessageRole): ChatMessage['role'] {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			return role === LANGUAGE_MODEL_CHAT_SYSTEM_ROLE ? 'system' : 'user';
	}
}

/**
 * `/alpha/generate` accepts system instructions separately from its Vercel AI
 * SDK message array. Keep the remaining conversation in its original order.
 */
export function extractSystemMessages(messages: readonly ChatMessage[]): {
	system: string;
	messages: ChatMessage[];
} {
	const system: string[] = [];
	const conversation: ChatMessage[] = [];

	for (const message of messages) {
		if (message.role === 'system') {
			if (message.content) {
				system.push(message.content);
			}
		} else {
			conversation.push(message);
		}
	}

	return { system: system.join('\n'), messages: conversation };
}

/**
 * Convert VS Code tool definitions to the OpenAI `tools` payload.
 */
export function convertTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): ChatTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema as Record<string, unknown> | undefined,
		},
	}));
}

/**
 * Convert the OpenAI-shaped intermediate tools to Command Code's wire shape.
 * `/alpha/generate` expects `name`, `description`, and `input_schema` at the
 * top level of each definition.
 */
export function toGenerateTools(
	tools: readonly ChatTool[] | undefined,
): CommandCodeTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map((tool) => ({
		name: tool.function.name,
		description: tool.function.description ?? '',
		input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
	}));
}

/**
 * Turn the OpenAI-shaped intermediate messages into the content-part format
 * required by Command Code's `/alpha/generate` endpoint.
 */
export function toGenerateMessages(messages: ChatMessage[]): CommandCodeGenerateMessage[] {
	const toolNames = new Map<string, string>();

	return messages.map((message) => {
		if (message.role === 'tool') {
			const toolCallId = message.tool_call_id ?? '';
			const toolName = toolNames.get(toolCallId) ?? 'unknown';
			return {
				role: 'tool' as const,
				content: [
					{
						type: 'tool-result' as const,
						toolCallId,
						toolName,
						output: { type: 'text' as const, value: message.content },
					},
				],
			};
		}

		const content: CommandCodeMessagePart[] = [];
		if (message.role === 'assistant' && message.reasoning_content) {
			content.push({ type: 'reasoning', text: message.reasoning_content });
		}
		if (message.parts && message.parts.length > 0) {
			for (const part of message.parts) {
				if (part.type === 'image_url') {
					const imageUrl = part.image_url?.url;
					if (imageUrl) {
						content.push({
							type: 'image',
							image: imageUrl,
							...(getMediaType(imageUrl) ? { mimeType: getMediaType(imageUrl) } : {}),
						});
					}
				} else if (part.text !== undefined) {
					content.push({ type: 'text', text: part.text });
				}
			}
		} else if (message.content || message.role !== 'assistant') {
			content.push({ type: 'text', text: message.content });
		}

		if (message.role === 'assistant' && message.tool_calls) {
			for (const toolCall of message.tool_calls) {
				const toolName = toolCall.function.name;
				toolNames.set(toolCall.id, toolName);
				content.push({
					type: 'tool-call',
					toolCallId: toolCall.id,
					toolName,
					input: parseToolArguments(toolCall.function.arguments),
				});
			}
		}

		return { role: message.role, content };
	});
}

function parseToolArguments(value: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function getMediaType(url: string): string | undefined {
	const match = /^data:([^;,]+)[;,]/u.exec(url);
	return match?.[1];
}

/**
 * Sum character counts across all messages so we can calibrate the
 * chars-per-token ratio when usage stats are reported back from the API.
 */
export function countMessageChars(messages: ChatMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		total += msg.reasoning_content?.length ?? 0;
		if (msg.parts) {
			for (const part of msg.parts) {
				if (part.text) {
					total += part.text.length;
				}
			}
		} else {
			total += msg.content?.length ?? 0;
		}
		if (msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				total += tc.function?.name?.length ?? 0;
				total += tc.function?.arguments?.length ?? 0;
			}
		}
	}
	return total;
}
