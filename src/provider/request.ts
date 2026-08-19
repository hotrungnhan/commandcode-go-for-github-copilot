import vscode from 'vscode';
import { AuthManager } from '../auth';
import { CommandCodeClient, ZDR_HEADER } from '../client';
import { getDebugLoggingEnabled, getMaxTokens, getZdrEnabled } from '../config';
import { DEFAULT_MAX_OUTPUT_TOKENS, TOOLS_LIMIT } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import type { ChatRequest, ChatTool, ReasoningEffort } from '../types';
import {
	convertMessages,
	convertTools,
	countMessageChars,
	toGenerateMessages,
	toGenerateTools,
} from './convert';
import { collectRequestConfig, getThreadId } from './context';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';

export interface PreparedChatRequest {
	client: CommandCodeClient;
	request: ChatRequest;
	totalRequestChars: number;
	isThinkingModel: boolean;
	thinkingEffort: 'none' | ReasoningEffort;
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	modelInfo: vscode.LanguageModelChatInformation;
	modelDefinition: import('../types').ModelDefinition | undefined;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
	token: vscode.CancellationToken;
}

export async function prepareChatRequest({
	authManager,
	modelInfo,
	modelDefinition,
	messages,
	options,
	token: _token,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}

	const extraHeaders = getZdrEnabled() ? ZDR_HEADER : undefined;
	const client = new CommandCodeClient(apiKey, {
		extraHeaders,
		debug: getDebugLoggingEnabled(),
	});

	const thinkingCapability = modelDefinition?.capabilities.thinking;
	const isThinkingModel = Boolean(thinkingCapability);
	const imageInput = Boolean(modelDefinition?.capabilities.imageInput);
	const maxTokens = getMaxTokens();

	const chatMessages = convertMessages(messages, { imageInput });
	const tools = prepareTools(modelDefinition?.capabilities.toolCalling, options);
	const generateTools = toGenerateTools(tools);

	const totalRequestChars = countMessageChars(chatMessages);
	const thinkingEffort: 'none' | ReasoningEffort = thinkingCapability
		? getConfiguredThinkingEffort(options as ModelConfigurationOptions, thinkingCapability)
		: 'none';

	const request: ChatRequest = {
		config: await collectRequestConfig(),
		memory: '',
		taste: '',
		skills: '',
		params: {
			model: modelInfo.id,
			messages: toGenerateMessages(chatMessages),
			tools: generateTools ?? [],
			system: '',
			max_tokens: maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
			temperature: 0.3,
			stream: true,
			// `/alpha/generate` selects tools automatically when `tools` is present;
			// unlike Chat Completions, it does not use a string `tool_choice` field.
			// Attach `reasoning_effort` only when thinking is enabled. `none`
			// intentionally omits the field so the upstream model uses its
			// default (non-thinking) behavior.
			...(isThinkingModel && thinkingEffort !== 'none' ? { reasoning_effort: thinkingEffort } : {}),
		},
		threadId: getThreadId(options),
	};

	logger.debug(
		`Prepared request: model=${request.params.model} messages=${chatMessages.length} tools=${tools?.length ?? 0} thinking=${thinkingEffort}`,
	);

	return {
		client,
		request,
		totalRequestChars,
		isThinkingModel,
		thinkingEffort,
	};
}

function prepareTools(
	toolCallingCapability: boolean | number | undefined,
	options: vscode.ProvideLanguageModelChatResponseOptions,
): ChatTool[] | undefined {
	if (!toolCallingCapability) {
		return undefined;
	}
	const tools = convertTools(options.tools);
	const limit = typeof toolCallingCapability === 'number' ? toolCallingCapability : TOOLS_LIMIT;
	const count = tools?.length ?? 0;
	if (count > limit) {
		throw new Error(t('request.toolsLimitExceeded', limit, count));
	}
	return tools;
}
