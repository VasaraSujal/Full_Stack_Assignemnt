/**
 * Centralized API Client and Typed SSE Stream Consumers
 */

export interface DocumentItem {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  processingError?: string | null;
  createdAt: string;
  updatedAt: string;
  pagesCount: number;
  chunksCount: number;
  conversationsCount: number;
}

export interface DocumentPageDetail {
  id: string;
  pageNumber: number;
  characterCount: number;
  extractedText?: string;
}

export interface DocumentDetail {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  processingError?: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    pages: number;
    chunks: number;
    conversations: number;
  };
  pages: DocumentPageDetail[];
}

export interface CitationLocationMetadata {
  chunkId: string;
  chunkIndex: number;
  chunkOffsets: {
    start: number;
    end: number;
  };
  pageOffsets?: {
    start: number;
    end: number;
  };
  pageNumber: number | null;
  startPage?: number;
  endPage?: number;
  quoteLength: number;
  matchType: 'exact' | 'normalized' | 'partial' | 'unmatched';
  isMultiPage: boolean;
  confidenceScore: number;
  occurrencesInChunk: number;
}

export interface CitationItem {
  id?: string;
  documentId: string;
  documentName?: string;
  chunkId?: string;
  quotedText: string;
  verificationStatus: 'VERIFIED' | 'PARTIAL' | 'REFUTED' | 'UNVERIFIED';
  pageNumber: number | null;
  locationMetadata: CitationLocationMetadata | null;
  claim?: string;
}

export interface MessageItem {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  citations: CitationItem[];
  limitations?: string[];
  metrics?: {
    totalRounds?: number;
    totalToolCalls?: number;
    totalDurationMs?: number;
    totalRetrievalMs?: number;
    toolExecutionBreakdown?: Array<{
      toolName: string;
      durationMs: number;
      itemsFound: number;
    }>;
  };
}

export interface ConversationItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  documents: Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    status: string;
  }>;
  messagesCount: number;
}

export interface ConversationDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  documents: Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    status: string;
  }>;
  messages: MessageItem[];
}

export interface AgenticToolEvent {
  tool: string;
  description: string;
  args?: Record<string, unknown>;
  round?: number;
  summary?: string;
  itemsFound?: number;
  durationMs?: number;
  status: 'running' | 'completed' | 'failed';
}

export interface ComparisonChangeItem {
  id?: string;
  category: string;
  significance: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  verificationStatus: 'VERIFIED' | 'PARTIAL' | 'REFUTED' | 'UNVERIFIED';
  documentA: {
    documentId: string;
    documentName: string;
    quote: string;
    pageNumber: number | null;
    verificationStatus: string;
    locationMetadata: CitationLocationMetadata | null;
  };
  documentB: {
    documentId: string;
    documentName: string;
    quote: string;
    pageNumber: number | null;
    verificationStatus: string;
    locationMetadata: CitationLocationMetadata | null;
  };
}

export interface ComparisonResult {
  id?: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  sourceFilename: string;
  targetFilename: string;
  summary: string;
  similarityScore: number;
  totalChanges: number;
  criticalDifferences: number;
  changes: ComparisonChangeItem[];
  verificationSummary: {
    totalChanges: number;
    verifiedCount: number;
    partialCount: number;
    refutedCount: number;
    unverifiedCount: number;
    allVerified: boolean;
  };
  coverageSummary: {
    bothQuotedCount: number;
    oneSidedCount: number;
  };
}

export async function fetchDocuments(): Promise<DocumentItem[]> {
  try {
    const res = await fetch('/api/documents', { cache: 'no-store' });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Request failed with status ${res.status}`);
    }
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch documents');
    return data.documents || [];
  } catch (err) {
    console.error('Error fetching documents list:', err);
    throw err;
  }
}

export async function uploadDocument(file: File): Promise<DocumentItem> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/documents', {
    method: 'POST',
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Upload failed with status ${res.status}`);
  }
  return data.document;
}

export async function fetchDocumentDetail(id: string): Promise<DocumentDetail> {
  const res = await fetch(`/api/documents/${id}`, { cache: 'no-store' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch document');
  return data.document;
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to delete document');
}

// 2. Conversation APIs
export async function fetchConversations(): Promise<ConversationItem[]> {
  const res = await fetch('/api/conversations', { cache: 'no-store' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch conversations');
  return data.conversations || [];
}

export async function createConversation(
  documentIds: string[],
  title?: string
): Promise<ConversationItem> {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentIds, title }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to create conversation');
  return data.conversation;
}

export async function fetchConversationDetail(id: string): Promise<ConversationDetail> {
  const res = await fetch(`/api/conversations/${id}`, { cache: 'no-store' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch conversation');
  return data.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to delete conversation');
}

// 3. SSE Stream Consumer Helper
async function consumeSSEStream(
  url: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onEvent: (event: string, data: Record<string, unknown> | string) => void
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed with status ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const block of lines) {
      if (!block.trim()) continue;
      const eventLines = block.split('\n');
      let eventType = 'message';
      let dataString = '';

      for (const line of eventLines) {
        if (line.startsWith('event: ')) {
          eventType = line.replace('event: ', '').trim();
        } else if (line.startsWith('data: ')) {
          dataString = line.replace('data: ', '').trim();
        }
      }

      if (dataString) {
        try {
          const parsedData = JSON.parse(dataString);
          onEvent(eventType, parsedData);
        } catch {
          onEvent(eventType, dataString);
        }
      }
    }
  }
}

// 4. Standard Document Q&A Stream
export interface ChatStreamCallbacks {
  onStatus?: (stage: string, message: string) => void;
  onToken?: (token: string) => void;
  onCitations?: (citations: CitationItem[]) => void;
  onDone?: (doneData: { messageId: string; status: string }) => void;
  onError?: (error: string) => void;
}

export async function streamChatMessage(
  conversationId: string,
  content: string,
  callbacks: ChatStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  await consumeSSEStream(
    `/api/conversations/${conversationId}/messages`,
    { content },
    signal,
    (event, data) => {
      const obj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      switch (event) {
        case 'status':
          callbacks.onStatus?.(String(obj.stage || ''), String(obj.message || ''));
          break;
        case 'token':
          callbacks.onToken?.(String(obj.token || ''));
          break;
        case 'citations':
          callbacks.onCitations?.((obj.citations as CitationItem[]) || []);
          break;
        case 'done':
          callbacks.onDone?.({
            messageId: String(obj.messageId || ''),
            status: String(obj.status || ''),
          });
          break;
        case 'error':
          callbacks.onError?.(String(obj.error || 'Generation failed'));
          break;
      }
    }
  );
}

// 5. Agentic Research Stream
export interface AgenticStreamCallbacks {
  onStatus?: (stage: string, message: string) => void;
  onToolStart?: (tool: string, description: string, args: Record<string, unknown>, round: number) => void;
  onToolResult?: (tool: string, summary: string, itemsFound: number, durationMs: number) => void;
  onToken?: (token: string) => void;
  onCitations?: (data: {
    citations: CitationItem[];
    verificationSummary: Record<string, unknown>;
    limitations: string[];
    hasSufficientEvidence: boolean;
  }) => void;
  onDone?: (doneData: {
    messageId: string;
    status: string;
    metrics?: Record<string, unknown>;
  }) => void;
  onError?: (error: string) => void;
}

export async function streamAgenticResearch(
  conversationId: string,
  question: string,
  callbacks: AgenticStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  await consumeSSEStream(
    `/api/conversations/${conversationId}/research`,
    { question },
    signal,
    (event, data) => {
      const obj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      switch (event) {
        case 'status':
          callbacks.onStatus?.(String(obj.stage || ''), String(obj.message || ''));
          break;
        case 'tool_start':
          callbacks.onToolStart?.(
            String(obj.tool || ''),
            String(obj.description || ''),
            (obj.args as Record<string, unknown>) || {},
            typeof obj.round === 'number' ? obj.round : 1
          );
          break;
        case 'tool_result':
          callbacks.onToolResult?.(
            String(obj.tool || ''),
            String(obj.summary || ''),
            typeof obj.itemsFound === 'number' ? obj.itemsFound : 0,
            typeof obj.durationMs === 'number' ? obj.durationMs : 0
          );
          break;
        case 'citations':
          callbacks.onCitations?.({
            citations: (obj.citations as CitationItem[]) || [],
            verificationSummary: (obj.verificationSummary as Record<string, unknown>) || {},
            limitations: (obj.limitations as string[]) || [],
            hasSufficientEvidence: Boolean(obj.hasSufficientEvidence ?? true),
          });
          break;
        case 'token':
          callbacks.onToken?.(String(obj.token || ''));
          break;
        case 'done':
          callbacks.onDone?.({
            messageId: String(obj.messageId || ''),
            status: String(obj.status || ''),
            metrics: (obj.metrics as Record<string, unknown>) || undefined,
          });
          break;
        case 'error':
          callbacks.onError?.(String(obj.error || 'Agentic research failed'));
          break;
      }
    }
  );
}

// 6. Contract Comparison APIs
export async function runComparison(
  documentIds: string[],
  question?: string
): Promise<ComparisonResult> {
  const res = await fetch('/api/comparisons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentIds, question }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Comparison failed');
  return data.comparison;
}

// 7. Version History APIs
export async function fetchDocumentVersions(id: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`/api/documents/${id}/versions`, { cache: 'no-store' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch versions');
  return data.versions || [];
}

export async function assignDocumentVersion(
  id: string,
  versionGroup: string,
  versionLabel: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/documents/${id}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ versionGroup, versionLabel }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to assign version');
  return data.version;
}
