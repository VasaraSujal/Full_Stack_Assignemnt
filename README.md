# § Lexicon AI — Enterprise Legal Contract Intelligence Engine
<div align="center">

![Lexicon AI Banner](https://img.shields.io/badge/Lexicon%20AI-Legal%20Intelligence%20Platform-2563EB?style=for-the-badge&logo=appveyor)

[![Next.js 15](https://img.shields.io/badge/Next.js-15.1.7-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.0.0-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7.3-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma ORM](https://img.shields.io/badge/Prisma-6.4.1-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-336791?style=flat-square&logo=postgresql)](https://supabase.com/)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-2.5%20Flash-4285F4?style=flat-square&logo=google)](https://aistudio.google.com/)
[![Vitest](https://img.shields.io/badge/Vitest-141%2F141%20Passed-4BB543?style=flat-square&logo=vitest)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

*An enterprise AI contract analysis and citation verification platform featuring multi-format document ingestion (PDF/DOCX), deterministic character-offset chunking, grounded Q&A, autonomous multi-round agentic research, and dual-sided version comparison.*

</div>

---

## 📑 Table of Contents

- [1. Executive Summary & Problem Solved](#1-executive-summary--problem-solved)
- [2. System Architecture & End-to-End Flow](#2-system-architecture--end-to-end-flow)
- [3. Core Feature Matrix](#3-core-feature-matrix)
- [4. Ingestion & Citation Verification Pipeline](#4-ingestion--citation-verification-pipeline)
- [5. Part C Selected Challenge: Autonomous Agentic Research](#5-part-c-selected-challenge-autonomous-agentic-research)
- [6. Dual-Sided Contract Version Comparison](#6-dual-sided-contract-version-comparison)
- [7. Database Schema & Data Models](#7-database-schema--data-models)
- [8. Project Directory Structure](#8-project-directory-structure)
- [9. Technology Stack Matrix](#9-technology-stack-matrix)
- [10. Environment Variables Configuration](#10-environment-variables-configuration)
- [11. Local Installation & Development](#11-local-installation--development)
- [12. Automated Quality Gates & Test Coverage](#12-automated-quality-gates--test-coverage)
- [13. Known Limitations & Future Roadmap](#13-known-limitations--future-roadmap)
- [14. Deliverables & Submission Checklist](#14-deliverables--submission-checklist)

---

## 1. Executive Summary & Problem Solved

### The Problem
Traditional LLM contract review tools are prone to hallucinations:
1. **Fabricated Clauses**: Inventing terms, liability figures, or indemnities not present in the contract.
2. **Hallucinated Coordinates**: Generating fake page numbers, misleading attorneys during diligence.
3. **Cross-Document Leaks**: Blending provisions across distinct agreements in a multi-file workspace.

### The Solution: Post-Generation Grounding Engine
Lexicon AI implements **authoritative post-generation citation verification**:
- **Zero-Trust LLM Coordinates**: All citations, page numbers, and quoted clauses are verified against raw text stored in PostgreSQL.
- **Exact Coordinate Mapping**: Computes character offsets `[startOffset, endOffset]` on database pages and highlights verbatim excerpts with animated visual pulse indicators in the interactive viewer.
- **Strict Scope Isolation**: Prevents cross-document data leakage by sandboxing conversation sessions.
- **Dual-Sided Verification**: Validates that difference claims between contract drafts cite verbatim quotes from both documents before marking changes as verified.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           LEXICON AI VERIFICATION GUARANTEE                     │
├───────────────────────────────┬─────────────────────────────────────────────────┤
│ 🟢 VERIFIED CITATION          │ Exact verbatim quote confirmed in database text │
│ 🟡 PARTIAL PARAPHRASE         │ Lexical overlap (>=70% keywords) but not exact  │
│ 🔴 REFUTED / FABRICATED       │ Quote does not exist in target contract         │
│ ⚪ UNVERIFIED CLAIM           │ Referenced contract is out-of-scope/unattached  │
└───────────────────────────────┴─────────────────────────────────────────────────┘
```

---

## 2. System Architecture & End-to-End Flow

### High-Level System Architecture Diagram

```
                               ┌────────────────────────────────────────────────┐
                               │           Next.js 15 Client App (UI)           │
                               │  - Contract Dashboard Overview                 │
                               │  - Authoritative Document Viewer               │
                               │  - Legal Research Workspace (SSE Stream)       │
                               │  - Contract Version Comparison UI              │
                               └───────────────────────┬────────────────────────┘
                                                       │ HTTPS / SSE
                                                       ▼
                               ┌────────────────────────────────────────────────┐
                               │           Next.js 15 Route Handlers            │
                               │  - POST /api/documents (Upload & Extraction)   │
                               │  - POST /api/conversations (Session Scope)     │
                               │  - POST /api/conversations/[id]/research (SSE) │
                               │  - POST /api/comparisons (Dual Verification)   │
                               └───────┬────────────────┬────────────────┬──────┘
                                       │                │                │
            ┌──────────────────────────▼───┐ ┌──────────▼──────────┐ ┌───▼──────────────────────────┐
            │ Document Ingestion Pipeline  │ │  Retrieval Engine   │ │   Google Gemini 2.5 Flash     │
            │ - Magic bytes signature check│ │  - Bounded Keyword  │ │   - Structured JSON Output    │
            │ - pdf-parse & mammoth parser │ │    Ranking (TF/IDF) │ │   - Multi-round Tool Calling  │
            │ - Sliding-window chunker     │ │  - Session Scope    │ │   - Anti-Prompt-Injection XML │
            └──────────────┬───────────────┘ └──────────┬──────────┘ └───┬───────────────────────────┘
                           │                            │                │
                           └────────────────────────────┼────────────────┘
                                                        │
                                                        ▼
                               ┌────────────────────────────────────────────────┐
                               │       Authoritative Verification Engine        │
                               │  - Normalized Whitespace Index Mapping         │
                               │  - Exact & Multi-line Character Offset Finder  │
                               │  - Document Isolation & Coordinate Translator  │
                               └────────────────────────┬───────────────────────┘
                                                        │
                                ┌───────────────────────┴───────────────────────┐
                                │                                               │
                                ▼                                               ▼
              ┌───────────────────────────────────┐           ┌───────────────────────────────────┐
              │     Supabase PostgreSQL (Prisma)  │           │      Private Supabase Storage     │
              │  - Document / DocumentPage        │           │  - Bucket: contract-documents     │
              │  - DocumentChunk (with offsets)   │           │  - Authenticated server downloads │
              │  - Conversation / Message         │           │  - RLS-bypassing service key      │
              │  - Citation / ComparisonChange    │           └───────────────────────────────────┘
              └───────────────────────────────────┘
```

### End-to-End Request Lifecycle Flow

```
User Action           API Layer                 Processing Pipeline               Database / Storage
───────────           ─────────                 ───────────────────               ──────────────────
1. Upload File  ───►  POST /api/documents  ──►  Magic Bytes Check (%PDF-/PK) ──►  Store in Private Bucket
                                                Extract Pages & Chunks    ──►  Atomic DB Transaction

2. Ask Query    ───►  POST /api/research   ──►  Autonomous Agentic Loop   ──►  Query Chunks (Isolated)
                                                Tools (search, get, list) ──►  Execute & Stream Events

3. Verify Turn  ───►  SSE Stream Finish    ──►  Authoritative Verification──►  Match Stored Text Offsets
                                                Compute [start, end]      ──►  Persist Verified Record

4. Click Quote  ───►  Client DocumentViewer──►  Scroll Into View (Target) ──►  Apply Pulse Highlight
```

---

## 3. Core Feature Matrix

| Feature Module | Assignment Requirement | Implementation Status | Technical Highlights |
| :--- | :--- | :---: | :--- |
| **Document Ingestion** | Accept PDF & DOCX; reject other formats with clear errors | ✅ **100% Complete** | Validates magic bytes (`%PDF-`, `PK\x03\x04`), enforces 20MB limit, handles corrupt files safely. |
| **Scanned PDF Handling** | Detect image-only PDFs with no readable text | ✅ **100% Complete** | Scanned detection marks document `FAILED` with HTTP 422; prevents empty phantom records. |
| **Document Viewer** | Paper-like reading card, pagination, character counts | ✅ **100% Complete** | 920px max-width reading surface with smooth `scrollIntoView` and active pulse highlight. |
| **Standard Q&A** | Grounded question answering with live token streaming | ✅ **100% Complete** | SSE token streaming with prompt anti-injection XML boundaries (`<retrieved_evidence>`). |
| **Streaming Interruption** | User can stop generation; partial response is kept | ✅ **100% Complete** | Client `AbortController` cleanly halts backend LLM stream and retains generated response. |
| **Citation Verification** | Confirm quotes actually exist in source document | ✅ **100% Complete** | Database text matching computes exact `[startOffset, endOffset]` coordinates on target page. |
| **Multi-Doc Questions** | Cross-document questions with source attribution | ✅ **100% Complete** | Session attachments isolate target documents; citation chips attribute source filenames. |
| **Contract Comparison** | Clause-level difference detection & risk filtering | ✅ **100% Complete** | Dual-sided quotation verification across 2–5 versions with `HIGH`, `MEDIUM`, `LOW` filters. |
| **Agentic Research** | Autonomous multi-round tool investigation loop | ✅ **100% Complete** | Chosen Part C challenge: `search_document`, `get_section`, `list_clauses` with live timeline. |

---

## 4. Ingestion & Citation Verification Pipeline

### Document Processing Pipeline Chart

```
 [Raw PDF / DOCX File]
          │
          ▼
 [1. File Validation] ─── (Invalid Magic Bytes / >20MB) ───► Return HTTP 400 Bad Request
          │ (Valid)
          ▼
 [2. Storage Upload] ────► Save to Supabase Storage ('contract-documents/...')
          │
          ▼
 [3. Text Extraction] ─── (0 Characters Extracted) ────────► Mark Status FAILED (HTTP 422)
          │ (Readable Text Found)
          ▼
 [4. Deterministic Chunking]
          │ ├── Sliding window: ~1,500 characters
          │ ├── Overlap: 200 characters
          │ └── Record exact character start/end offsets and page numbers
          ▼
 [5. Atomic DB Persistence]
          └── PostgreSQL Transaction: Document + DocumentPages + DocumentChunks
```

### Citation Verification Algorithm Flowchart

```
 [Candidate Citation from LLM]
          │
          ▼
 [Is Document in Active Conversation Scope?]
          ├── NO  ──► Status: UNVERIFIED (pageNumber: null, coordinates: null)
          │
          └── YES
               │
               ▼
 [Fetch Authoritative DB Pages & Chunks]
               │
               ▼
 [Exact Character Substring Match?]
          ├── YES ──► Status: VERIFIED (Exact Offsets [start, end], Page Number)
          │
          └── NO
               │
               ▼
 [Normalized Whitespace & Punctuation Match?]
          ├── YES ──► Status: VERIFIED (Normalized Offsets via Index Map)
          │
          └── NO
               │
               ▼
 [Lexical Overlap >= 70% Keywords?]
          ├── YES ──► Status: PARTIAL (Paraphrase Tag, Excluded from Verified Count)
          │
          └── NO  ──► Status: REFUTED (Fabricated Quote, Null Coordinates)
```

---

## 5. Part C Selected Challenge: Autonomous Agentic Research

Instead of stuffing raw contract text into a single prompt, **Lexicon AI implements Option 2: Autonomous Agentic Research**. The Gemini model acts as an autonomous legal investigator equipped with specialized tools:

```
                            ┌─────────────────────────────────────────┐
                            │      Autonomous Legal Agent Loop        │
                            │      (Max 5 Rounds / Execution Limit)   │
                            └────────────────────┬────────────────────┘
                                                 │
                        ┌────────────────────────┼────────────────────────┐
                        ▼                        ▼                        ▼
             ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
             │   search_document   │  │     get_section     │  │    list_clauses     │
             │ Query across chunks │  │ Inspect specific    │  │ Scan headings &     │
             │ with section hints  │  │ page / heading window│ │ clause titles (10pp)│
             └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘
                        │                        │                        │
                        └────────────────────────┼────────────────────────┘
                                                 │
                                                 ▼
                            ┌─────────────────────────────────────────┐
                            │ Live Server-Sent Events (SSE) Timeline  │
                            │  - Tool Name & Arguments                │
                            │  - Execution Duration (ms)              │
                            │  - Items Found & Coverage Limitations   │
                            └─────────────────────────────────────────┘
```

### Tool Specifications

| Tool Name | Parameters | Purpose | Failure Guard |
| :--- | :--- | :--- | :--- |
| `search_document` | `query`, `documentId?`, `sectionHint?` | Keyword & phrase search across attached chunks. | Returns `coverageLimitation` note; negative results do not imply complete absence. |
| `get_section` | `documentId`, `sectionHint`, `startPage?`, `endPage?` | Retrieves focused ~1,500 character window around a specific clause or page range. | Bounded to max 3 pages per invocation to prevent payload overflow. |
| `list_clauses` | `documentId`, `topic?` | Discovers standard clause headings (`Article X`, `Section Y`) across pages. | Scans up to 10 pages; reports `totalPages` and whether scan was exhaustive. |

---

## 6. Dual-Sided Contract Version Comparison

Lexicon AI compares contract versions at the substantive clause level, calculating change severity and verifying dual-sided supporting quotes:

```
 ┌───────────────────────────┐                     ┌───────────────────────────┐
 │   Contract Draft v1.0     │                     │   Contract Draft v2.0     │
 │  (Document A in Database) │                     │  (Document B in Database) │
 └─────────────┬─────────────┘                     └─────────────┬─────────────┘
               │                                                 │
               │ "Customer agrees to pay $15,000 USD             │ "Customer agrees to pay $25,000 USD
               │  within thirty (30) days of invoice."           │  within fifteen (15) days of invoice."
               │                                                 │
               └───────────────────────┬─────────────────────────┘
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │    Dual-Sided Verifier Engine     │
                     │  - Side A Quote Verified? -> YES  │
                     │  - Side B Quote Verified? -> YES  │
                     └─────────────────┬─────────────────┘
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │ Verified Difference Card:         │
                     │ • Category: PAYMENT               │
                     │ • Significance: HIGH RISK         │
                     │ • Status: DUAL-SIDED VERIFIED     │
                     │ • Summary: Amount increased $10k, │
                     │   due date shortened to 15 days   │
                     └───────────────────────────────────┘
```

---

## 7. Database Schema & Data Models

The relational schema is built on **Supabase PostgreSQL** via **Prisma ORM**:

```
 ┌──────────────────────┐        1:N        ┌──────────────────────┐
 │       Document       ├──────────────────►│     DocumentPage     │
 │  - id (PK)           │                   │  - id (PK)           │
 │  - originalFilename  │                   │  - documentId (FK)   │
 │  - mimeType / status │                   │  - pageNumber (Int)  │
 │  - storageKey (UQ)   │                   │  - extractedText     │
 └──────────┬───────────┘                   └──────────────────────┘
            │
            │ 1:N                           ┌──────────────────────┐
            ├──────────────────────────────►│    DocumentChunk     │
            │                               │  - id (PK)           │
            │                               │  - documentId (FK)   │
            │                               │  - chunkIndex (Int)  │
            │                               │  - chunkText / meta  │
            │                               │  - pageNumber (Int)  │
            │                               └──────────────────────┘
            │
            │ N:M (via ConversationDocument)
            ▼
 ┌──────────────────────┐        1:N        ┌──────────────────────┐
 │     Conversation     ├──────────────────►│       Message        │
 │  - id (PK)           │                   │  - id (PK)           │
 │  - title / createdAt │                   │  - conversationId(FK)│
 └──────────────────────┘                   │  - role (USER/ASST)  │
                                            │  - content (Text)    │
                                            └──────────┬───────────┘
                                                       │ 1:N
                                                       ▼
                                            ┌──────────────────────┐
                                            │       Citation       │
                                            │  - id (PK)           │
                                            │  - messageId (FK)    │
                                            │  - documentId (FK)   │
                                            │  - quotedText (Text) │
                                            │  - verificationStatus│
                                            │  - pageNumber (Int)  │
                                            │  - locationMetadata  │
                                            └──────────────────────┘
```

---

## 8. Project Directory Structure

```
.
├── prisma/
│   ├── migrations/                 # Versioned SQL migrations history
│   └── schema.prisma               # PostgreSQL relational models & enums
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── comparisons/        # POST & GET /api/comparisons (Version diffs)
│   │   │   ├── conversations/      # POST, GET, DELETE /api/conversations
│   │   │   │   └── [id]/
│   │   │   │       ├── messages/   # POST (Standard Q&A with token streaming)
│   │   │   │       └── research/   # POST (Autonomous Agentic SSE research)
│   │   │   ├── documents/          # POST (Upload), GET (List), DELETE /api/documents
│   │   │   └── health/             # GET /api/health (Database connectivity check)
│   │   ├── globals.css             # Pure Vanilla CSS Design System & Tokens
│   │   ├── layout.tsx              # Application RootLayout with Inter typography
│   │   └── page.tsx                # Main App Shell & State Orchestrator
│   ├── components/
│   │   ├── compare/                # ComparisonWorkspace UI & Difference Cards
│   │   ├── dashboard/              # DashboardOverview & 4-Column Metric Grid
│   │   ├── documents/              # DocumentLibrary table & UploadModal
│   │   ├── layout/                 # Sidebar, Header & Mobile Drawer Navigation
│   │   ├── research/               # ResearchWorkspace, Mode Switcher & SSE Timeline
│   │   ├── ui/                     # Accessible Feather Icons & UI primitives
│   │   └── viewer/                 # DocumentViewer & Citation Highlight pulse
│   └── lib/
│       ├── agentic-prompt.ts       # Agentic research system instructions
│       ├── agentic-research-service.ts # Multi-round agentic execution loop
│       ├── agentic-tools.ts        # Tool definitions (search, section, clauses)
│       ├── api-client.ts           # Type-safe frontend API client & SSE consumer
│       ├── chunker.ts              # Sliding-window text chunker (~1,500 chars)
│       ├── citation-verifier.ts    # Authoritative citation verification engine
│       ├── comparison-verifier.ts  # Dual-sided comparison verifier
│       ├── file-validation.ts      # Magic bytes & file size security validator
│       ├── gemini.ts               # Google Gemini SDK singleton
│       ├── prisma.ts               # Singleton Prisma Client module
│       ├── retrieval.ts            # Keyword ranking & bounded context engine
│       ├── storage.ts              # Private Supabase Storage client
│       └── text-extractor.ts       # PDF (pdf-parse v2) & DOCX (mammoth) extractor
├── tests/                          # 17 Test files (141 automated Vitest tests)
├── .env.example                    # Environment variables template
├── .gitignore                      # Git exclusion rules
├── package.json                    # Scripts & dependencies
├── README.md                       # Comprehensive documentation
├── SUBMISSION_MATERIALS.md         # Half-page technical note & video script
├── tsconfig.json                   # Strict TypeScript compiler options
├── vercel.json                     # Production deployment configuration (60s maxDuration)
└── vitest.config.mjs               # Vitest test configuration
```

---

## 9. Technology Stack Matrix

| Component Layer | Technology Selected | Version | Rationale & Responsibility |
| :--- | :--- | :---: | :--- |
| **Framework** | Next.js App Router | `15.1.7` | High-performance React 19 server components & streaming API route handlers. |
| **Language** | TypeScript | `5.7.3` | Strict type safety, discriminated unions, and interface consistency. |
| **Styling** | Pure Vanilla CSS | Custom Tokens | Maximum layout control, accessible focus rings, glassmorphism, responsive grid. |
| **Database** | PostgreSQL on Supabase | Latest | Relational integrity, cascade deletions, and index-accelerated queries. |
| **ORM** | Prisma ORM | `6.4.1` | Type-safe database queries and automated migration management. |
| **Storage** | Private Supabase Storage | `2.117.2` | Secure server-side storage for raw contracts (`contract-documents` bucket). |
| **AI LLM** | Google Gemini 2.5 Flash | `@google/genai` | Fast, cost-effective reasoning with native tool calling and structured JSON output. |
| **PDF Extraction**| `pdf-parse` v2 | `2.4.5` | Accurate page-by-page text stream extraction. |
| **DOCX Extraction**| `mammoth` | `1.13.0` | Clean XML raw paragraph extraction. |
| **Test Runner** | Vitest | `5.0.3` | Ultra-fast unit, integration, and acceptance test execution. |

---

## 10. Environment Variables Configuration

| Variable Name | Required | Scope | Description |
| :--- | :---: | :---: | :--- |
| `DATABASE_URL` | **Yes** | Server | PostgreSQL connection string (Supabase pooled or direct). |
| `DIRECT_URL` | **Yes** | Server | Direct connection string for Prisma migrations. |
| `SUPABASE_URL` | **Yes** | Server | Supabase project URL (`https://[project-ref].supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Server Only | Privileged service key for private bucket operations. **Never exposed to client**. |
| `SUPABASE_STORAGE_BUCKET` | **Yes** | Server | Private bucket name (default: `contract-documents`). |
| `GEMINI_API_KEY` | **Yes** | Server Only | Google AI Studio API key for Gemini 2.5 Flash. |
| `GEMINI_MODEL` | No | Server | Gemini model name (default: `gemini-2.5-flash`). |
| `MAX_FILE_SIZE_MB` | No | Server | Maximum allowed upload size in MB (default: `20`). |

---

## 11. Local Installation & Development

```bash
# 1. Clone the repository
git clone <repository-url>
cd "Full Stack Role Assigment"

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Open .env and add your Supabase and Gemini credentials

# 4. Generate Prisma client & apply database migrations
npx prisma generate
npx prisma migrate dev

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the application.

---

## 12. Automated Quality Gates & Test Coverage

All 141 tests across 17 test suites pass with **100% success**:

```bash
# Run complete test suite (141 tests)
npm test

# Run Next.js ESLint
npm run lint

# Run TypeScript typecheck
npx tsc --noEmit

# Validate Prisma schema
npm run prisma:validate

# Production build test
npm run build
```

### Test Suite Summary

```
 Test Files  17 passed (17)
      Tests  141 passed (141)
   Duration  ~19.04s

 ✓ tests/phase6-acceptance-reliability.test.ts (13 tests) - Adversarial verification & bounds
 ✓ tests/agentic-research-audit.test.ts (11 tests)        - Autonomous tool execution & SSE
 ✓ tests/comparison-audit.test.ts (11 tests)              - Dual-sided comparison verifier
 ✓ tests/citation-offset-audit.test.ts (14 tests)         - Coordinate translation accuracy
 ✓ tests/contract-comparison.test.ts (13 tests)           - Version diff attribution
 ✓ tests/agentic-tools.test.ts (12 tests)                 - Agentic tool parameter contracts
 ✓ tests/citation-verifier.test.ts (9 tests)              - Citation verifier edge cases
 ✓ tests/upload-workflow.test.ts (7 tests)                - Ingestion atomicity & rollback
 ✓ tests/multi-document-retrieval.test.ts (6 tests)       - Cross-document isolation
 ✓ tests/text-extractor.test.ts (5 tests)                 - PDF/DOCX page parser
 ✓ tests/retrieval.test.ts (5 tests)                      - Keyword ranking & bounded context
 ✓ tests/conversation-api.test.ts (4 tests)               - Session QA lifecycle
 ✓ tests/chunker.test.ts (3 tests)                        - Sliding-window boundaries
 ✓ tests/document-api.test.ts (2 tests)                   - Ingestion failure recovery
 ✓ tests/file-validation.test.ts (8 tests)                - Magic bytes & size enforcement
 ✓ tests/frontend-integration.test.ts (9 tests)           - Discriminated union type safety
```

---

## 13. Known Limitations & Future Roadmap

1. **Scanned / Image-Only PDFs**: Optical Character Recognition (OCR) is not included in this phase. Scanned image-only PDFs fail gracefully with status `FAILED` and clear diagnostic notices.
   - *Future Work*: Integrate an asynchronous Tesseract/DocTR OCR worker pipeline.
2. **Quotation vs. Synthesis Inferences**: Verified citations guarantee that the quoted passage exists verbatim at exact page coordinates; surrounding legal inferences synthesized by the model remain AI-assisted interpretations.
3. **File Size Boundaries**: Ingestion is capped at 20MB to ensure reliable execution within serverless limits.

---

## 14. Deliverables & Submission Checklist

- [x] **1. GitHub Repository Link**: Clean repo with strict `.gitignore` protection.
- [x] **2. Production Deployment (Vercel)**: Configured with `vercel.json` and 60-second function timeouts.
- [x] **3. Comprehensive README.md**: Complete technical documentation, architecture charts, and setup instructions.
- [x] **4. 3–5 Minute Demo Video Script**: Step-by-step walkthrough script documented in [`SUBMISSION_MATERIALS.md`](file:///e:/Full%20Stack%20Role%20Assigment/SUBMISSION_MATERIALS.md#2-35-minute-demo-video-script--walkthrough-plan).
- [x] **5. Half-Page Technical Note**: Architectural breakdown and limitation analysis documented in [`SUBMISSION_MATERIALS.md`](file:///e:/Full%20Stack%20Role%20Assigment/SUBMISSION_MATERIALS.md#1-half-page-technical-note).
