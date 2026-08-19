import type { ChatRequest } from '../types';

export interface ErrorActionUrls {
	configureApiKey?: string;
	showLogs?: string;
	createApiKey?: string;
	viewPricing?: string;
}

export interface RequestErrorContext {
	baseUrl: string;
	request?: ChatRequest;
}

export interface ErrorActionLink {
	labelKey: ErrorActionLabelKey;
	url: string;
}

export type ErrorActionLabelKey = 'error.action.createApiKey' | 'error.action.viewPricing';

export interface HttpErrorLinkDefinition {
	labelKey: ErrorActionLabelKey;
	url: string;
}

export type ApiProviderId = 'commandcode';
export type HttpErrorLinkStatusKey = 401 | 403 | 422 | 429 | '5xx';

export type CommandCodeRequestErrorKind = 'http' | 'network' | 'unknown';

export type NetworkErrorCategory =
	| 'dns'
	| 'unreachable'
	| 'interrupted'
	| 'timeout'
	| 'tls'
	| 'aborted'
	| 'protocol'
	| 'configuration'
	| 'generic';
