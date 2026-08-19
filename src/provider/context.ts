import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vscode from 'vscode';
import { DEFAULT_THREAD_ID } from '../consts';
import type { CommandCodeRequestConfig } from '../types';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 2_000;

/**
 * Collect the project context supplied to Command Code by its CLI, using the
 * current VS Code workspace rather than a hard-coded sample project.
 */
export async function collectRequestConfig(): Promise<CommandCodeRequestConfig> {
	const workingDir = getWorkingDirectory();
	const [isGitRepo, currentBranch, remoteHead, gitStatus, recentCommits] = await Promise.all([
		runGit(workingDir, ['rev-parse', '--is-inside-work-tree']).then((value) => value === 'true'),
		runGit(workingDir, ['branch', '--show-current']),
		runGit(workingDir, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']),
		runGit(workingDir, ['status', '--short']),
		runGit(workingDir, ['log', '--oneline', '-5']),
	]);

	return {
		workingDir,
		date: getLocalDate(),
		environment: 'cli',
		structure: [],
		isGitRepo,
		currentBranch: isGitRepo ? currentBranch : '',
		mainBranch: isGitRepo ? getMainBranch(remoteHead) : 'main',
		gitStatus: isGitRepo ? gitStatus : '',
		recentCommits: isGitRepo && recentCommits ? recentCommits.split(/\r?\n/u) : [],
	};
}

/**
 * VS Code's public Language Model provider API does not document a chat
 * thread ID. Preserve it if a host version supplies one in its opaque request
 * options, otherwise use Command Code's documented all-zero new-thread ID.
 */
export function getThreadId(options: vscode.ProvideLanguageModelChatResponseOptions): string {
	const requestOptions = options as vscode.ProvideLanguageModelChatResponseOptions & {
		threadId?: unknown;
		chatThreadId?: unknown;
		conversationId?: unknown;
		modelOptions?: Record<string, unknown>;
	};

	for (const value of [
		requestOptions.threadId,
		requestOptions.chatThreadId,
		requestOptions.conversationId,
		requestOptions.modelOptions?.threadId,
		requestOptions.modelOptions?.chatThreadId,
	]) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}

	return DEFAULT_THREAD_ID;
}

function getWorkingDirectory(): string {
	const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
	const activeWorkspace = activeEditorUri
		? vscode.workspace.getWorkspaceFolder(activeEditorUri)
		: undefined;
	const folder = activeWorkspace ?? vscode.workspace.workspaceFolders?.[0];
	return folder?.uri.fsPath || process.cwd();
}

async function runGit(workingDir: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync('git', args, {
			cwd: workingDir,
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: 64 * 1024,
			windowsHide: true,
		});
		return stdout.trim();
	} catch {
		return '';
	}
}

function getMainBranch(remoteHead: string): string {
	const prefix = 'refs/remotes/origin/';
	return remoteHead.startsWith(prefix) ? remoteHead.slice(prefix.length) : 'main';
}

function getLocalDate(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${month}-${day}`;
}
