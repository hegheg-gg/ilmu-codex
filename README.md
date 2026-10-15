# ILMU Codex: AI Pair Programmer & Cloud Delegation

An intelligent, agentic AI extension for **Antigravity IDE** and **Visual Studio Code** powered by **[ILMU AI](https://docs.ilmu.ai/docs/getting-started/overview)** (YTL AI Labs, Malaysia). 

ILMU Codex delivers a **Codex-style development experience**:
1. **Side-by-Side in IDE**: An interactive assistant panel running side-by-side with your code, featuring real-time streaming, collapsible reasoning inspection, automatic editor context tracking, and safety-approved agentic tools to read, edit, patch, and test your codebase.
2. **Delegate to Cloud**: Offload heavy multi-file workflows (e.g. extensive refactorings, complete test suites, API generation, full repo migrations) to an asynchronous **Cloud Delegation Runner**, track live cloud execution, and review/merge diffs back into your IDE with one click.

---

## ⚡ Key Features

### 1. Side-by-Side Agentic Coding
- **Autonomous Tool Execution**: The agent can read files, search the workspace, stage modifications with `apply_diff`, run terminal commands, and create new files.
- **Safety Confirmations**: Read-only tools execute automatically (configurable), while write/destructive actions and shell commands prompt for your explicit approval before running.
- **Real-Time Streaming & Thinking Models**: Full support for Server-Sent Events (SSE) streaming and collapsible reasoning/thinking blocks for reasoning models like `ilmu-v3.1` and `ilmu-glm-5.3`.
- **Malaysian Context & Multilingual**: Tailored support for formal Bahasa Malaysia, English, and natural code-switching (Manglish) as trained in the ILMU corpus.

### 2. Cloud Delegation Runner
- **Task Offloading**: Similar to Codex Cloud, delegate large tasks to a cloud container/VM runner while keeping your local editor responsive and free.
- **Live Task Tracker**: Real-time progress bar, status pills (`queued`, `running`, `completed`, `failed`), and live streaming console logs.
- **Diff Inspection & 1-Click Merge**: Receive unified git diffs from the cloud runner and merge them directly into your workspace.

### 3. Model Support
Seamlessly switch between ILMU models directly in the extension header:

| Model | Context Window | Use Case |
| :--- | :---: | :--- |
| **`ilmu-glm-5.3`** | **1,000,000** | Flagship coding, refactoring, and deep agentic tool use |
| **`ilmu-glm-5.3-flash`**| **1,000,000** | Ultra-fast, low-cost coding and rapid agent turns |
| **`ilmu-v3.1`** | **200,000** | Flagship reasoning and extended thinking |
| **`ilmu-mini-v3.3`** | **200,000** | High-volume fast summaries, classification, and edits |

---

## 📦 Installation in Antigravity IDE / VS Code

### Method 1: Install Pre-built `.vsix` (Instant)
1. In Antigravity or VS Code, press `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`).
2. Search and select: **`Extensions: Install from VSIX...`**.
3. Choose the generated package:
   ```
   c:\Users\kaunter\AndroidStudioProjects\ilmuai\ilmu-codex-0.1.0.vsix
   ```
4. The **ILMU Codex** icon will appear on your activity bar!

### Method 2: Development Mode (Run from Source)
1. Open this folder in Antigravity or VS Code.
2. Run `npm install` and `npm run compile`.
3. Press `F5` to launch an Extension Development Host window.

---

## 🚀 Getting Started & Authentication

You have two ways to authenticate:

### 1. Web OAuth (Recommended — No Key Management Needed)
Just like [ILMUcode](https://docs.ilmu.ai/ilmucode/sign-in-and-models):
1. Open the ILMU Codex sidebar.
2. Click **🌐 Sign in with ILMU Account (Web OAuth)**.
3. Your default browser opens the ILMU Console. Sign in or choose your account.
4. The browser automatically hands back authentication to Antigravity IDE! Your token is encrypted and stored in secure secret storage.

### 2. Manual API Key (Optional)
1. Generate an API key starting with `sk-` on [console.ilmu.ai/dashboard/keys](https://console.ilmu.ai/dashboard/keys).
2. Enter the key in the settings panel or set `$env:ILMU_API_KEY`.

---

## ☁️ Running the Cloud Delegation Runner

The extension includes a standalone Cloud Runner service in the `cloud-runner` directory:

### Run Locally:
```bash
cd cloud-runner
npm install
npm run build
npm start
```
The runner will start on `http://localhost:4000`.

### Run via Docker:
```bash
cd cloud-runner
docker build -t ilmu-codex-cloud-runner .
docker run -p 4000:4000 -e ILMU_API_KEY="sk-your-key" ilmu-codex-cloud-runner
```
You can deploy this Docker container to **Google Cloud Run**, **AWS ECS**, **Fly.io**, or any cloud VM to have a 24/7 cloud delegation endpoint.

---

## ⚙️ Extension Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `ilmuCodex.apiKey` | `""` | ILMU API Key starting with `sk-` |
| `ilmuCodex.baseUrl` | `https://api.ilmu.ai/v1` | ILMU API Base URL |
| `ilmuCodex.model` | `ilmu-glm-5.3` | Default model for coding and agent turns |
| `ilmuCodex.cloudRunnerUrl` | `http://localhost:4000` | Endpoint of the Cloud Delegation Runner |
| `ilmuCodex.autoApproveReadOnly` | `true` | Automatically approve read-only tools (`read_file`, `list_dir`, `grep_search`) |
| `ilmuCodex.preferredLanguage` | `English` | Language preference (`English`, `Bahasa Malaysia`, `Manglish`) |

---

## 📚 References
- [ILMU API Getting Started Documentation](https://docs.ilmu.ai/docs/getting-started/overview)
- [ILMU Model Catalog & Pricing](https://docs.ilmu.ai/docs/models/comparison)
- [ILMU Codex CLI Guide](https://docs.ilmu.ai/docs/developer-tools/coding/codex)
