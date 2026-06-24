# Open-Source ML Extraction: 2026 Field Guide

> Research context document for the trafilatura-alpha TypeScript port.
> Saved 2026-06-24. Source: deep technical research session.
>
> **What's in this doc:** Survey of the open-source ML extraction landscape across (1) HTML main-content extraction (MinerU-HTML, ReaderLM, NuExtract), (2) schema-guided web extraction (Instructor/Outlines + local LLMs), and (3) document understanding (Docling, MinerU 2.5, VLMs). Self-hostable options on CPU or single GPU. **For trafilatura-alpha:** this is *adjacent* context. The port itself is heuristic + XGBoost (Phase 4), not a neural extractor. Keep this doc for: (1) understanding why we *don't* go neural for the classifier, (2) future "neural fallback" features (e.g. routing low-confidence pages to MinerU-HTML), (3) the licensing-trap table (ReaderLM-v2 CC-BY-NC, Marker GPL, etc.) when evaluating any neural addition.

---

# The 2026 field guide to open-source ML extraction

**Three facts reshape the open-source extraction stack in April 2026.** First, purpose-built 0.6–1.2B extractors (MinerU-HTML, MinerU2.5-Pro, PaddleOCR-VL) now beat 70B+ generalist LLMs on their respective benchmarks at a fraction of the cost. Second, the practical bottleneck has shifted from accuracy to licensing — ReaderLM-v2 (CC-BY-NC-4.0), Marker (GPL-3.0), PyMuPDF4LLM (AGPL-3.0), LayoutLMv3 (CC-BY-NC-SA), Pixtral Large (Mistral Research), and Llama 3.2-Vision (EU-excluded) all trap unwary commercial users. Third, end-to-end VLMs emitting structured markup (DocTags, Markdown+JSON) have displaced the multi-stage layout→OCR→tables pipeline for anyone with a GPU, with the exception of rule-based crawlers at web scale where Trafilatura remains unbeatable at ~44 ms/page.

The honest "what should I actually use" answers are short. For **HTML main content**: MinerU-HTML (Apache-2.0) if you want SOTA, or rs-trafilatura with a MinerU-HTML fallback if you need to scale. For **schema-guided web extraction**: Crawl4AI plus Instructor or Outlines, pointed at a local Qwen2.5-7B served by vLLM with XGrammar as the grammar backend. For **documents**: Docling as the default (MIT, ~58k stars, MLX-accelerated), MinerU 2.5 when accuracy justifies the setup cost, and Qwen3-VL-8B-Instruct as the single best generalist document VLM on a 24 GB GPU. Read on for the numbers behind each of these picks.

---

## Category 1: HTML main content extraction

The 2025–2026 breakthrough in this category is **MinerU-HTML** (also called Dripper in its accompanying paper, arXiv 2511.23119). It is a 0.6–0.8B sequence-labeling model built on Qwen3-0.6B, released by OpenDataLab in December 2025 and updated to v1.1 in March 2026. Critically, it is **Apache-2.0** — the only top-tier neural extractor that is unambiguously commercial-friendly. On **WebMainBench** (7,887 pages across 5,434 domains), it scores **ROUGE-N F1 of 0.8399 with fallback**, beating GPT-5 (0.8302) and DeepSeek-V3 (0.8252) inside the same framework while remaining over 1,000× smaller. Per-element preservation is even more striking: **code-block edit similarity 0.9093** and **formula edit similarity 0.9399**, versus Trafilatura's 0.13 and 0.61.

The second story is **ReaderLM-v2** (Jina AI, 1.54B, Qwen2.5-1.5B base, January 2025). It is still widely deployed, has 34 community GGUF quantizations, runs comfortably at Q4_K_M on 8 GB CPU machines, and handles 512K combined context across 29 languages. But it is **CC-BY-NC-4.0** and the license propagates to every derived GGUF/MLX/Ollama build. Jina has not released a v3 as of April 2026 — the collection was last touched July 2025 — and a "ReaderLM-v2-pro" exists only as an enterprise SKU. On **WCXB** (a newer independent benchmark), it scores word-level F1 0.741 at **10,410 ms/page** — the slowest of any system measured. The low ROUGE score on WebMainBench (0.2264) is partly a benchmark-framing artifact: ReaderLM-v2 emits opinionated Markdown that diverges from the html2text ground truth, so its practical quality is better than that headline number suggests.

**The hybrid pattern wins at scale.** rs-trafilatura (a Rust port of Trafilatura with an XGBoost confidence predictor) achieves WCXB F1 of **0.859 dev, 0.893 test at 44 ms/page on CPU** — 200× faster than any neural model. Routing the ~8% of low-confidence pages to MinerU-HTML raises combined F1 to **0.910 on the held-out test set**, essentially tying the best neural-only result at a fraction of the cost. OpenDataLab used this pattern to extract the 7.3 trillion-token AICC corpus.

### HTML extraction model lineup

| Model | Params | License | WebMainBench F1 | VRAM (fp16/Q4) | GGUF/MLX/Ollama |
|---|---|---|---|---|---|
| **MinerU-HTML / Dripper** | 0.6–0.8B | **Apache-2.0** | **0.8399** | 1.3 GB / 0.4 GB | Community only / No / No |
| ReaderLM-v2 | 1.54B | **CC-BY-NC-4.0** ⚠️ | 0.2264 (framing) | 3.1 GB / 1.1 GB | 34 quants / Community / Community |
| NuExtract-2.0-8B | 8B | MIT | n/a (JSON-focused) | 16 GB / 5 GB | Official / No / — |
| NuExtract-2.0-4B | 4B | **Qwen Research (NC)** ⚠️ | n/a | 8 GB / 2.5 GB | Official / No / — |
| NuExtract-2.0-2B | 2B | MIT | n/a | 4 GB / 1.3 GB | Official / No / Community |
| Qwen2.5-32B-Instruct | 32B | Apache-2.0 | (beaten by ReaderLM-v2 1.5B per Jina) | 64 GB / 20 GB | Yes / Yes / Yes |
| Magic-HTML (rule-based) | — | Apache-2.0 | 0.7091 | CPU-only | — |
| Trafilatura (rule-based) | — | Apache-2.0 | 0.6358 | CPU-only | — |

**The honest verdict for HTML.** If you are shipping a commercial product, use **MinerU-HTML** on a small GPU (it fits in 2 GB at Q4) with Trafilatura as a CPU fallback for the 90%+ of article-like pages where Trafilatura already scores F1 ≈ 0.88. If you need HTML-to-JSON with a schema and commercial rights, use **NuExtract-2.0-2B or -8B** — and explicitly avoid the **4B, which inherits Qwen Research non-commercial terms from its Qwen2.5-VL-3B base**. If you are doing research or hobby work and want the widest Ollama/LM Studio tooling, ReaderLM-v2 Q4_K_M is excellent. And if you need billions of pages per day on CPU, nothing beats rule-based extractors; the neural era has not changed that.

The key cautionary note: the two leading HTML benchmarks measure different things. **WebMainBench** uses ROUGE-N against html2text-converted ground truth, which punishes models with opinionated Markdown styles. **WCXB** uses word-level F1 on plain text, which punishes models that generate Markdown structure. MinerU-HTML wins the first, rs-trafilatura wins the second, and neither contradicts the other.

---

## Category 2: Schema-guided structured extraction from web

This category has matured in 2025 around a clear architectural consensus: a scraper fetches and cleans HTML, a structured-generation library provides type-safe output via Pydantic or Zod, and a local LLM served by vLLM or Ollama runs the actual extraction with a constrained-decoding engine guaranteeing JSON-schema validity. The dominant components have reshuffled since 2024.

**Constrained decoding has been solved.** The new foundation across vLLM, SGLang, TRT-LLM, and MLC-LLM is **XGrammar** (Apache-2.0, ~2k stars), which masks tokens against a byte-level pushdown automaton in **<40 µs per token** and delivers the paper-reported **3.5× speedup over Outlines for JSON Schema and up to 14× end-to-end** on Llama-3.1 H100 serving. **llguidance** (Rust, MIT, ~1k stars) competes at ~50 µs/token, runs inside llama.cpp, vLLM, SGLang, mistral.rs, and even Chromium, and has been adopted by OpenAI for its Structured Outputs feature. Both libraries produce **100% structurally valid JSON by construction**, versus 70–90% for prompt-only approaches.

**The wrapper layer has consolidated too.** Instructor (567-labs, ~12.7k stars, MIT, v1.15.1 April 2026) is the mainstream Pydantic + function-calling wrapper, supporting 15+ providers including Ollama and llama.cpp. Outlines (dottxt-ai, ~13.4k stars, Apache 2.0) is preferred when you self-serve the model and want true grammar-based generation rather than function-calling retries. **LangExtract** (google/langextract, Apache 2.0, ~26.3k stars) is the most interesting 2025 entrant — launched July 2025, it adds **source-grounded span tracking** and a visual HTML viewer, and ships an official Ollama+Gemma2:2b example. Guidance (~20k) lives on via llguidance. Marvin v3 (Apache 2.0, ~5.9k) merged in ControlFlow and added MCP. **LMQL is dormant** — no commits since mid-2024 — and should not be chosen for new projects.

**Scraper frameworks now dominate over bespoke tools.** **Crawl4AI** (unclecode, ~64k stars, Apache 2.0, v0.8.6 March 2026) has become the default Python framework. Its `JsonCssExtractionStrategy` and `JsonXPathExtractionStrategy` run LLM-free at essentially zero cost for templated pages; `LLMExtractionStrategy` accepts Pydantic schemas and any LiteLLM provider including Ollama, and it can auto-generate CSS selectors from a single LLM call then fall back to pure-selector extraction. **ScrapeGraphAI** (~23.3k stars, MIT) is the batteries-included alternative built on LangGraph. **Firecrawl's `/extract` endpoint** is widely used but the core is AGPL-3.0 (hosted SaaS deployments of derivative works must open-source), and its Fire-Engine anti-bot, /browser, and dashboard remain cloud-only. **Skyvern** (AGPL-3.0, ~21k) and **Stagehand** (MIT, ~15k from Browserbase) are the agentic browser options, the latter offering a particularly clean Zod-based `extract()` primitive.

### The schema-extraction stack that actually works

| Layer | Pick | Why |
|---|---|---|
| Grammar engine | **XGrammar** (default in vLLM/SGLang) or **llguidance** | 100% JSON validity, <40 µs/token, negligible throughput cost |
| Structured-output library | **Instructor** (general) or **Outlines** (self-served) | Instructor is provider-agnostic; Outlines is backend-agnostic |
| Scraper / crawler | **Crawl4AI** (Python) or **ScrapeGraphAI** | Crawl4AI's hybrid CSS+LLM strategy is unmatched on cost |
| Wrapper for source-grounded extraction | **LangExtract** | Spans, visualization, Ollama-friendly, Apache-2.0 |
| Local LLM | **Qwen2.5-7B-Instruct** or **Llama-3.3-8B** | Best cost/accuracy for extraction workloads |

**CrawlBench** (Firecrawl, December 2024) remains the only public end-to-end LLM-extraction benchmark, though it is Firecrawl-authored and uses the Y Combinator top 50 as ground truth. Firecrawl's own LLM Extract scored ~100% on Level 0 and ~50% on Level 1 (>700 datapoints) for a combined ~70%. Independent head-to-head testing is sparse — Scrapeway's 2026 comparison pegs Firecrawl at 65.4% average success, 5.2s latency, $5.5/1k. A self-hosted **Qwen2.5-7B on a single A10/3090 via vLLM+XGrammar** breaks even with hosted APIs somewhere around **1–5 million extractions per month**; below that, hosted APIs win on total cost of ownership.

**The honest verdict.** For new commercial projects in 2026, build the stack **Crawl4AI + Instructor (or Outlines) + vLLM + XGrammar + Qwen2.5-7B**. Use `JsonCssExtractionStrategy` wherever the target site is templated (near-zero per-page cost) and fall back to `LLMExtractionStrategy` for irregular pages. For CPU-only deployments, **Instructor + Ollama with Gemma-2 2B or Phi-3.5-mini** handles 1–3 requests/sec/core and ships the fastest. Avoid LMQL (dormant), avoid ReaderLM-v2 in JSON mode unless non-commercial (CC-BY-NC-4.0), and watch for Firecrawl/Skyvern's AGPL implications if you plan to expose derivatives as a SaaS.

---

## Category 3: Document understanding — the VLM era arrives

The landscape for PDFs, DOCX files, scanned images, and forms has been fully rewritten between mid-2024 and April 2026. **OmniDocBench v1.5 is now saturated** — top six systems sit within ~5 points of each other — and the practical decision has collapsed to three questions: what is your license budget, what is your VRAM budget, and how much volume do you process.

### Pipelines and the Docling–MinerU duopoly

**Docling** (docling-project/docling, IBM, now under LF AI & Data Foundation) is the clean-license default. At **~58k stars**, MIT-licensed, v2.90.0 released April 17 2026, it combines an RT-DETR layout model (docling-layout-heron), TableFormer, formula recognition, and configurable OCR (EasyOCR/Tesseract/RapidOCR/PaddleOCR) behind a unified DoclingDocument IR that exports to Markdown, HTML, or JSON. Apple Silicon support is particularly strong: MLX plus TableFormer MPS acceleration delivers **14–17× speedup** (a 9-page PDF with 5 tables drops from 145.9 s on CPU to 10.4 s on MPS). Docling parses PDF, DOCX, PPTX, XLSX, HTML, LaTeX, WAV, MP3, and images. Unstructured.io integrated Docling's object detection as a component in Q1 2026 — strong third-party validation.

**MinerU** (opendatalab/MinerU, ~60.4k stars) is the accuracy leader. Its **MinerU2.5-Pro-1.2B VLM** (April 2026) scores **95.69 on OmniDocBench v1.6** with a decoupled two-stage architecture (structure detect → content generation), **2.12 pages/s on an A100 via vLLM**, and TEDS +5.54 over prior SOTA on tables. The critical news: **MinerU relicensed to a new "MinerU Open Source License" in April 2026** — Apache-2.0 plus attribution requirement plus commercial thresholds (MAU/revenue), replacing its previous AGPLv3. That finally makes it commercially usable below those thresholds, but projects pinned to older versions still carry AGPL.

**Marker** (VikParuchuri/datalab-to, ~33.1k stars) has fallen behind on both accuracy and licensing. It is **GPL-3.0** (strong copyleft — unusable inside closed-source products without open-sourcing the derivative) and independent benchmarks show ~16 s/page on x86 CPU versus Docling's 3.1 s/page on the same docs. Its Surya OCR component (v0.17.1 January 2026) remains excellent at 2.2× 2024 throughput, but the overall pipeline has been outpaced.

**Nougat** (Meta) is dead — no releases since 2023 — and should not be used. **LayoutLMv3** still posts F1 92.08 on FUNSD as a fine-tuneable encoder but its weights are **CC-BY-NC-SA-4.0** (non-commercial) and end-to-end parsing has moved to DocTags-style VLMs. **PyMuPDF4LLM** is the fastest born-digital extractor at 0.12 s/page but is **AGPL-3.0** from Artifex. **PaddleOCR's PP-StructureV3** is the best CPU-only pipeline at 3.74 s/image on a modest Xeon, Apache-2.0, with especially strong CJK coverage.

### The specialist VLM wave

Four small VLMs published between mid-2025 and early 2026 collectively define the frontier for pure document parsing:

- **PaddleOCR-VL-1.5** (Baidu, 0.9B, Apache-2.0, January 2026) scores **94.5 on OmniDocBench v1.5** and runs in 4 GB VRAM — the best quality-per-watt available.
- **GLM-OCR** (Zhipu, ~9B, Apache-2.0, February 2026) sits at **94.6 on OmniDocBench v1.5** — the current numerical leader.
- **dots.ocr-1.5** (rednote-hilab, 3B, MIT, Q1 2026) is near-SOTA on OmniDocBench at 7 GB fp16 and particularly strong on low-resource languages and formulas.
- **olmOCR-2-7B** (AllenAI, Apache-2.0, October 2025) is a **Qwen2.5-VL-7B fine-tune with GRPO reinforcement learning** that tops olmOCR-Bench at **82.4** and processes **10,000 pages in 17 minutes on an L40S**, delivering sub-$200 per million pages on a 4090. It is the cheapest large-scale English OCR pipeline published.
- **Granite-Docling-258M** (IBM, Apache-2.0, January 2026) is the ultra-small specialist — 258M parameters, fits in **under 4 GB VRAM (runs in-browser via WebGPU)**, emits IBM's DocTags markup preserving layout, tables, equations, charts, and code in a single pass. It is supported in transformers, vLLM, ONNX, MLX, Ollama (`ibm/granite-docling:258m`), and llama.cpp via mmproj.

### Generalist VLMs for documents

For mixed workloads that include VQA, chart reasoning, and multilingual content alongside OCR, generalist VLMs remain essential. **Qwen3-VL-8B-Instruct** (Alibaba, 8.77B, Apache-2.0, October 2025) is the current clear winner: **DocVQA ANLS 96.1**, **OCRBench 896–905**, **32 OCR languages** (up from 19 in Qwen2.5-VL), 256K native context (extensible to 1M), and full support across vLLM, llama.cpp (`llama-mtmd-cli` with official Qwen GGUF + mmproj), MLX, and Ollama. It fits in 24 GB at fp16 or 8 GB at Q4.

**MiniCPM-V 4.5** (OpenBMB, 8B, Apache-2.0, August 2025) is the efficient runner-up — built on Qwen3-8B + SigLIP2, ships int4 checkpoints by default, tops OCRBench under 25B, and uses 4× fewer visual tokens than comparable models. **InternVL3.5** (OpenGVLab, 2–38B + MoE variants, mostly Apache-2.0) is the strongest InternVL generation and particularly competitive at the 8B scale. **Granite 4.0 3B Vision** (IBM, February 2026) is the right pick for enterprise license reviews that reject Qwen and Meta terms. Apple's **Phi-4-multimodal** (Microsoft, 5.6B, MIT, February 2025) hits DocVQA 93.2 and is strong on MathVista despite its size.

### Document models at a glance

| Model | Size | License | OmniDocBench v1.5 | DocVQA | VRAM (fp16 / Q4) | Best for |
|---|---|---|---|---|---|---|
| **GLM-OCR** | ~9B | Apache-2.0 | **94.6** | — | 18 GB / 6 GB | Accuracy leader |
| **PaddleOCR-VL-1.5** | 0.9B | Apache-2.0 | **94.5** | — | 2 GB / 0.6 GB | Quality per watt |
| **MinerU2.5-Pro** | 1.2B | MinerU OSL | **95.69** (v1.6) | — | 4–6 GB | Tables + CJK |
| **Qwen3-VL-8B** | 8.77B | Apache-2.0 | ~90 | **96.1** | 17 GB / 6 GB | Generalist default |
| **dots.ocr-1.5** | 3B | MIT | ~89 | ~93 | 7 GB / 2.5 GB | Low-resource languages |
| **olmOCR-2-7B** | 7B | Apache-2.0 | 85 (v1.0) | ~95 | 15 GB / 5 GB | English volume |
| **MiniCPM-V 4.5** | 8B | Apache-2.0 | ~86 | ~95 | 17 GB / 6 GB | Generalist efficient |
| **Granite-Docling-258M** | 258M | Apache-2.0 | ~70 | — | <4 GB | Ultra-small / WebGPU |
| **Granite 4.0 3B Vision** | 3B | Apache-2.0 | (strong tables/charts) | ~90 | 7 GB / 2 GB | Enterprise license safety |
| **SmolDocling-256M** | 256M | CDLA-Permissive-2.0 | ~70 | — | 0.6 GB | CPU / M2 / WebGPU |
| **Qwen2.5-VL-7B** | 7B | Apache-2.0 | ~82 | 95.7 | 13 GB / 5 GB | Proven generalist |
| **Qwen2.5-VL-3B** | 3B | **Qwen Research (NC)** ⚠️ | ~75 | ~93 | 5.75 GB / 2.5 GB | 8 GB GPU, non-commercial |
| **Qwen2.5-VL-72B** | 72B | Qwen License (gated) | ~87 | 96.4 | 133 GB / 42 GB | Flagship multi-GPU |
| **Llama 3.2-Vision 11B** | 10.6B | Llama 3.2 Community **EU-excluded** ⚠️ | ~55 | 88.4 | 22 GB / 8 GB | Avoid in EU |
| **Pixtral Large** | 124B | **Mistral Research (NC)** ⚠️ | ~75 | 93.3 | 240 GB / 70 GB | Non-commercial only |

### Cross-cutting observations

**Licensing traps worth memorizing.** The following all carry restrictive licenses that commercial teams regularly miss: **ReaderLM-v1 and v2** (CC-BY-NC-4.0 — non-commercial, propagates to all GGUFs), **NuExtract-2.0-4B** (Qwen Research, non-commercial — the 2B and 8B siblings are MIT), **Qwen2.5-VL-3B and -72B** (non-standard Qwen licenses — the 7B and 32B are clean Apache-2.0, and all Qwen3-VL sizes are clean Apache-2.0), **Llama 3.2-Vision** (Llama 3.2 Community explicitly excludes EU-domiciled multimodal rights), **Pixtral Large** (Mistral Research — Pixtral 12B is Apache-2.0 and safe), **Marker and Surya** (GPL-3.0), **PyMuPDF4LLM** (AGPL-3.0), **Nougat weights** (CC-BY-NC-4.0), **LayoutLMv3** (CC-BY-NC-SA-4.0), **MinerU pre-3.1** (AGPLv3, relicensed April 2026), and **Firecrawl / Skyvern** (AGPL-3.0 — fine internally, risky for SaaS derivatives).

Fully commercially safe, high-performing picks: **MinerU-HTML, MinerU 3.1+, Docling, Granite-Docling-258M, Granite 4.0 3B Vision, PaddleOCR-VL, dots.ocr, olmOCR-2, SmolDocling, Qwen3-VL (all sizes), Qwen2.5-VL-7B/32B, MiniCPM-V 4.5, Phi-4-multimodal, InternVL3.5, Pixtral 12B, Molmo, Crawl4AI, Instructor, Outlines, LangExtract, XGrammar, llguidance**.

**Maintenance status — what is alive in April 2026.** **Thriving with 2026 releases**: Docling (v2.90 April), MinerU (v3.1 April), Qwen3-VL (October 2025 with active iteration), Granite 4.0 Vision (February 2026), PaddleOCR-VL (v1.5 January), dots.ocr (v1.5 Q1), olmOCR (October 2025), MiniCPM-V 4.5 (August 2025), Crawl4AI (v0.8.6 March), ScrapeGraphAI (v1.76 April), Instructor (v1.15.1 April), Outlines, LangExtract, XGrammar, llguidance. **Maintenance mode**: Tesseract 5 (stable and still best CPU classical OCR), Table Transformer (last push June 2024), AutoScraper, GPT Crawler, Camelot/Tabula, Pixtral 12B (no successor in the Pixtral line), Molmo (no release since the December 2024 tech report), Phi-3.5-Vision (superseded by Phi-4-MM), Llama 3.2-Vision (Meta shifted to Llama 4). **Dead or deprecated**: Nougat (2023), LMQL (mid-2024), ReaderLM-v1 (Jina marks it deprecated), LayoutLMv3 (last major work 2022), ReaderLM-v2 (no updates since January 2025, no v3 as of April 2026).

---

## Conclusion: three picks, one paragraph each

**For HTML extraction**, MinerU-HTML at 0.6B parameters and Apache-2.0 is the first open-source neural extractor that is both best-in-class and commercially usable without asterisks. The WebMainBench results are not marginal — it beats GPT-5 and DeepSeek-V3 on structured element preservation while running on an 8 GB GPU at 3 pages/sec. The sensible architecture is a hybrid: Trafilatura (or its Rust-XGBoost variant) at 44 ms/page on CPU handles the 90% easy case, and MinerU-HTML rescues the 8% of pages that heuristics fumble, for combined WCXB F1 of 0.91 on held-out data.

**For schema-guided web extraction**, the stack has converged and is no longer controversial: Crawl4AI fetches and cleans, Instructor or Outlines types the output, XGrammar guarantees JSON validity at ~40 µs/token inside vLLM or SGLang, and a local Qwen2.5-7B or Llama-3.3-8B does the reasoning. For scripting and prototypes, LangExtract with Ollama and Gemma-2 2B on CPU is the newest good idea in the category. The only trap is LMQL (dormant), and the only deeply ambiguous choice is whether to accept AGPL for Firecrawl's `/extract`.

**For document understanding**, the DocTags-style end-to-end VLM has displaced the multi-stage pipeline for anyone with a GPU, and saturation of OmniDocBench at 94–96 means the practical axis of choice is license and footprint rather than accuracy. Docling (MIT, ~58k stars, actively maintained, MLX-native) is the default. Qwen3-VL-8B is the best single generalist. MinerU2.5-Pro and GLM-OCR top the accuracy charts. olmOCR-2-7B dominates English-volume economics. PaddleOCR-VL-1.5 and Granite-Docling-258M deliver 94.5 OmniDocBench in 4 GB VRAM. No single winner means the right answer depends on the hardware you own and the license terms your legal team will accept — but every serious contender is now Apache-2.0 or MIT, which is the deeper change this category has undergone since 2024.
