# Changelog

## 0.2.5 (2026-10-01)

### Features

- Synced the Go-plan model allowlist with [commandcode.ai/docs/plans/go](https://commandcode.ai/docs/plans/go) and `cmdc --list-models` (54 models).
- Normalized model ids to the current CLI slugs (lowercase `vendor/name`).
- Added GPT-6 Luna, DeepSeek V4.1, MiMo V2.6, Qwen 3.8 Flash/Omni/0902, GLM-5.3 Flash/FlashX, Step 5 Preview, Muse Spark 1.3 Contributor, stealth free models, and other Go-catalog entries.

## 0.1.1 (2026-08-19)

### Features

- Added `Qwen/Qwen3.8-27B` to the model catalog (262K context, vision, reasoning).

## 0.1.0 (2026-08-17)

### Features

- Initial release — Command Code Go for VS Code.
- Pulls live model list from `GET /provider/v1/models` and exposes them in the Copilot Chat model picker.
- Streaming Chat Completions over the OpenAI-compatible `/provider/v1/chat/completions` endpoint.
- BYOK API key stored in VS Code SecretStorage.
- Per-model thinking effort selector (`none`, `low`, `medium`, `high`).
- Vision-capable models receive image parts natively (no proxy required).
- Optional zero-data-retention header (`x-cmdc-zdr: 1`).
