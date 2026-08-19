# Command Code Go for VS Code

Use the models included with the [Command Code Go plan](https://commandcode.ai/docs/plans/go) directly in GitHub Copilot Chat.

This fork is maintained by [Ho Trung Nhan](https://github.com/hotrungnhan). The source code and issue tracker are hosted at [hotrungnhan/commandcode-go-for-github-copilot](https://github.com/hotrungnhan/commandcode-go-for-github-copilot).

This extension is intentionally Go-plan-only. It does not support the Provider, Pro, or Max plans. The supported model allowlist follows the Go-plan documentation; if a Go model is missing, [open an issue](https://github.com/hotrungnhan/commandcode-go-for-github-copilot/issues).

## What it provides

- Command Code Go models in Copilot Chat's model picker
- Copilot agent mode, tools, MCP servers, instructions, and skills
- Streaming text and reasoning responses
- Image input where the selected Go model supports it
- API-token storage through VS Code SecretStorage

The canonical model list and availability are maintained by Command Code. See the [Go-plan model list](https://commandcode.ai/docs/plans/go#models) rather than relying on a static list in this README.

## Setup

### 1. Install Command Code and sign in

Install the CLI globally:

```bash
bun add --global command-code@latest
```

Start the browser-based login flow:

```bash
command-code login
```

Complete the authorization flow and retrieve the API token created for your Command Code account. If the CLI does not print it, copy it from `~/.commandcode/auth.json` or from Command Code Studio's API Keys page. Keep the token private.

### 2. Add the token to VS Code

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run **Command Code Go: Set API Key**.
3. Paste the token and confirm.

The extension stores it in VS Code SecretStorage and does not write it to the repository.

### 3. Choose a model

Open Copilot Chat, choose a Command Code model, and start chatting. The model list is limited to the current [Command Code Go plan](https://commandcode.ai/docs/plans/go).

## Requirements

- VS Code 1.116 or newer
- GitHub Copilot Chat
- An active Command Code Go plan
- Bun (only needed to install and authenticate the Command Code CLI)

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `commandcode-copilot.maxTokens` | `0` | Output-token cap; `0` uses the Generate API default. |
| `commandcode-copilot.zdr` | `false` | Request zero-data-retention routing when available. |
| `commandcode-copilot.apiKey` | unset | Optional fallback token source; SecretStorage takes precedence. |
| `commandcode-copilot.debugMode` | `minimal` | Control diagnostic logging in the Command Code output channel. |

The extension uses the Command Code Generate API and its required protocol headers. Its workspace and Git context are collected from the current VS Code workspace for each request.

## Problems or missing models

If a model listed for Go is not available in the extension, or a supported request fails, please [create an issue](https://github.com/hotrungnhan/commandcode-go-for-github-copilot/issues) with the model name and the relevant output-channel error. Never include your API token.

## Attribution

This project is a fork of the original [Command Code Copilot Provider](https://github.com/Tyrannmisu/commandcode-copilot-provider) by Tyrannmisu, maintained and published by [Ho Trung Nhan](https://github.com/hotrungnhan).

## License

[MIT](LICENSE)
