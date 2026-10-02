# Lexicon AI — Assignment Submission Materials & Deliverables

This document contains the complete deliverables for the Full Stack AI Role assignment submission, including the **Half-Page Technical Note**, **3–5 Minute Demo Video Script & Plan**, and **Application Visual Tour**.

---

## 1. Half-Page Technical Note

### Architecture & Data Flow
Lexicon AI is built on **Next.js 15 (App Router, Node.js runtime)**, **PostgreSQL on Supabase**, and **Google Gemini 2.5 Flash**. Ingested contracts (PDF and DOCX) are validated against magic byte signatures, stored in private Supabase Storage, and parsed page-by-page. A deterministic sliding-window chunking engine slices extracted text into ~1,500-character segments with 200-character overlaps, persisting exact character offsets and parent page numbers in PostgreSQL inside an atomic database transaction.

### Retrieval & Multi-Round Agentic Tools
For standard Q&A, a bounded keyword and quoted-phrase ranking algorithm retrieves high-relevance chunks strictly isolated to documents attached to the active session. For complex investigations, **Agentic Research** employs multi-round autonomous tool execution (`search_document`, `get_section`, `list_clauses`), streaming tool calls, intermediate results, and reasoning tokens via Server-Sent Events (SSE) with strict round limits (`MAX_ROUNDS = 5`) and loop guards.

### Authoritative Citation Verification & Coordinate Mapping
To eliminate hallucinations, **model-generated claims are never trusted directly**. Candidate citations are dispatched through a post-generation verification engine:
1. Verifies that the cited document is attached to the current conversation session.
2. Queries the authoritative stored text from `DocumentPage` and `DocumentChunk` records.
3. Executes exact substring searches and normalized index maps (mapping whitespace, smart quotes, and punctuation back to raw character indices).
4. Translates chunk coordinates to absolute page offsets `[startOffset, endOffset]` and highlights verbatim excerpts in the interactive document viewer with pulse animations.
5. Classifies citations into `VERIFIED`, `PARTIAL` (>=70% overlap paraphrase), `REFUTED` (fabricated quotation), or `UNVERIFIED` (foreign document).

### Dual-Sided Contract Version Comparison
Comparison across contract versions requires **dual-sided quote verification**. The engine extracts clause differences across categories (e.g., Liability, Payment, Termination, Indemnification), verifying that quotations from both Document A and Document B exist verbatim in their respective source files before tagging the difference as verified.

### Operational Limitations & Future Work
- **OCR Limitation**: Scanned, image-only PDFs with no embedded text layer are not supported and fail gracefully with a descriptive error. Future enhancements will integrate an asynchronous Tesseract/DocTR OCR worker pipeline.
- **Inference vs. Fact**: Verified citations guarantee the exact presence and coordinates of quoted text; surrounding legal synthesis remains AI-assisted interpretation.

---

## 2. 3–5 Minute Demo Video Script & Walkthrough Plan

| Timestamp | Screen / Workflow | Narrator Script & Actions |
| :--- | :--- | :--- |
| **0:00 – 0:45** | **Dashboard Overview** | *"Welcome to Lexicon AI. Traditional legal LLM assistants often hallucinate clauses or invent citation page numbers. Lexicon AI provides a production-grade contract intelligence engine with post-generation citation verification against authoritative stored records."* Show KPI metrics, recent contracts, and quick action cards. |
| **0:45 – 1:30** | **Document Ingestion & Viewer** | *"Let's navigate to the Contract Repository and upload a standard PDF or DOCX agreement. The ingestion pipeline validates magic byte signatures, uploads to private storage, extracts text page-by-page, and indexes deterministic chunks."* Open document in Document Viewer; demonstrate page navigation and character analytics. |
| **1:30 – 2:45** | **Grounded Q&A & Citation Highlight** | *"Now let's ask a specific legal query: 'What are the payment terms and late fee penalties?'. Gemini synthesizes an answer grounded strictly in retrieved chunks. Notice the green VERIFIED CITATION chip. Clicking the citation immediately opens the Document Viewer, jumps to Page 1, and highlights the exact verbatim excerpt with character-level accuracy."* |
| **2:45 – 3:45** | **Agentic Research with Real Tool Activity** | *"For multi-clause discovery, switch to Agentic Research and ask: 'Analyze liability limits, indemnification, and governing law across all attached agreements.' Observe the live SSE stream: the model autonomously calls `search_document`, `list_clauses`, and `get_section` with real ms timings, presenting verified multi-document evidence."* Demonstrate the 'Stop Generation' interruption button. |
| **3:45 – 4:30** | **Contract Version Comparison** | *"Under Compare Contracts, select two contract versions (e.g. Agreement v1 vs. Agreement v2). Lexicon AI computes similarity scores, categorizes differences by risk significance (HIGH/MEDIUM/LOW), and verifies dual-sided quotation evidence from both documents."* |
| **4:30 – 5:00** | **Integrity Guarantees & Summary** | *"If a query asks for non-existent terms or if a quotation cannot be located, Lexicon AI reports insufficient evidence rather than fabricating citations. Scanned image-only PDFs without text layers fail gracefully. Thank you for exploring Lexicon AI."* |

---

## 3. Application Visual Tour & Screen Catalog

1. **Contract Dashboard Overview (`/`)**:
   - 4-column metric cards (Active Contracts, Indexed Chunks, Research Sessions, Verified Citations).
   - Recent Documents list with direct View / Research actions.
   - Quick Workflow triggers.
2. **Contract Repository (`/documents`)**:
   - Filterable search bar and bulk selection action banner.
   - Contract table with status badges (`Indexed`, `Processing`, `Failed`), page/chunk statistics, and delete confirmation modal.
3. **Authoritative Document Viewer (`/documents/[id]`)**:
   - Paper-like 920px reading surface with page-by-page controls (`Page X of Y`).
   - Citation highlight pulse animation anchored to exact character offsets.
   - Authoritative location metadata banner.
4. **Legal Research Workspace (`/research`)**:
   - Mode switcher: **Agentic Research** vs **Standard Q&A**.
   - Session history panel with attached contract pills.
   - Real-time SSE streaming timeline with tool execution duration.
   - Interactive citation chips navigating directly to source passages.
5. **Contract Comparison Workspace (`/compare`)**:
   - 2-to-5 document selector with active constraint checks.
   - Comparison synthesis overview with similarity score and high-risk counter.
   - Dual-sided excerpt comparison cards with Document A and Document B quote verification.
