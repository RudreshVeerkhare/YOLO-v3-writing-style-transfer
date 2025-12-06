# YOLO-Style GPT-5.1 Paper Rewriter

A **single-page web application** that transforms dense academic papers from arXiv into honest, accessible explanations using a multi-agent GPT-5.1 pipeline.

## 🎯 What It Does

1. **Fetches** TeX source and figures directly from arXiv
2. **Parses** the LaTeX into structured sections
3. **Extracts** semantic meaning and identifies research gaps
4. **Rewrites** in YOLOv3-style honest narrative
5. **Reviews** and patches for accuracy (2-3 feedback loops)
6. **Assembles** an arXiv-style HTML article

## ✨ Features

- **100% Client-Side**: No backend required, runs entirely in your browser
- **Multi-Agent Pipeline**: 8 specialized GPT-5.1 agents working together
- **Live Progress**: See real-time streaming as the paper is rewritten
- **Figure Preservation**: Original figures are extracted and repositioned
- **Research Augmentation**: Identifies gaps and adds sourced information
- **Critique Loop**: Built-in review agent ensures accuracy
- **Export Options**: Download as HTML or Markdown

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- An OpenAI API key with access to GPT-5.1 models

### Installation

```bash
# Clone or navigate to the project
cd yolo-style-gpt5

# Install dependencies
npm install

# Start the development server
npm run dev
```

### Usage

1. Open http://localhost:5173 in your browser
2. Enter an arXiv ID (e.g., `2301.12345` or `https://arxiv.org/abs/2301.12345`)
3. Enter your OpenAI API key
4. Click "Transform Paper" and watch the magic happen!

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         UI Layer                             │
│  InputForm │ ProgressTimeline │ DocumentViewer               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Pipeline Orchestrator                     │
│  Coordinates all agents and manages state                    │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  TeX Fetcher  │    │ Agent Suite   │    │   Assembler   │
│  (fflate)     │    │ (OpenAI API)  │    │   (HTML Gen)  │
└───────────────┘    └───────────────┘    └───────────────┘
```

### Agent Pipeline

| Agent | Model | Purpose |
|-------|-------|---------|
| Structure Agent | gpt-5.1-mini | Parse LaTeX → JSON |
| Semantic Map Agent | gpt-5.1-mini | Extract key concepts |
| Research Questions | gpt-5.1 | Identify gaps |
| Research Answer | gpt-5.1 | Fill gaps with sources |
| YOLO Rewriter | gpt-5.1 | Main rewriting |
| Figure Mapping | gpt-5.1-mini | Place figures |
| Critique Agent | gpt-5.1 | Review for accuracy |
| Patch Agent | gpt-5.1-mini | Fix issues |

## 📁 Project Structure

```
src/
├── components/
│   ├── InputForm.tsx        # arXiv ID + API key input
│   ├── ProgressTimeline.tsx # Live pipeline progress
│   └── DocumentViewer.tsx   # Final document display
├── services/
│   ├── openaiClient.ts      # OpenAI API wrapper
│   ├── texFetcher.ts        # arXiv fetch + tar extraction
│   ├── agentPrompts.ts      # All agent system prompts
│   ├── agents.ts            # Agent function implementations
│   ├── assembler.ts         # Final HTML assembly
│   └── pipeline.ts          # Orchestrator
├── types/
│   └── index.ts             # TypeScript type definitions
├── App.tsx                  # Main app component
├── App.css                  # Styles
└── main.tsx                 # Entry point
```

## 🎨 The YOLO Style

The YOLOv3 paper is famous for its honest, slightly irreverent tone. This app rewrites papers to be:

- **Honest about limitations**: "Look, this doesn't work great on small objects."
- **Conversational but precise**: Complex ideas in accessible language
- **Transparent about uncertainty**: "We're not entirely sure why this works..."
- **No hype**: Facts over marketing

## ⚠️ Known Limitations

### CORS Issues

arXiv blocks direct browser requests. The app tries multiple CORS proxies, but you may need to:

1. Use a browser extension like "CORS Unblock"
2. Run a local CORS proxy
3. The app will show instructions if fetching fails

### API Costs

This app makes multiple GPT-5.1 API calls per paper. A typical transformation might cost $0.50-$2.00 depending on paper length.

### Model Availability

The app assumes access to `gpt-5.1` and `gpt-5.1-mini`. If these models aren't available, modify the model names in `src/services/agents.ts`.

## 🔒 Privacy & Security

- Your OpenAI API key is **never stored** - it only exists in browser memory
- No data is sent to any server except OpenAI's API
- All processing happens client-side

## 📜 License

MIT License - feel free to use, modify, and distribute.

## 🙏 Acknowledgments

- Inspired by the legendary [YOLOv3 paper](https://arxiv.org/abs/1804.02767) by Joseph Redmon
- Built with React, TypeScript, Vite, and the OpenAI API
- Uses [fflate](https://github.com/101arrowz/fflate) for in-browser decompression
- Uses [KaTeX](https://katex.org/) for math rendering

---

**Disclaimer**: This tool generates AI-written rewrites for educational purposes. Always refer to the original paper for authoritative content.
