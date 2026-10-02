'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ConversationItem,
  ConversationDetail,
  CitationItem,
  DocumentItem,
  fetchConversations,
  createConversation,
  fetchConversationDetail,
  streamChatMessage,
  streamAgenticResearch,
  AgenticToolEvent,
} from '@/lib/api-client';
import {
  SearchIcon,
  SparklesIcon,
  FileTextIcon,
  PlusIcon,
  SendIcon,
  StopCircleIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  XCircleIcon,
  WrenchIcon,
  ClockIcon,
  LayersIcon,
  XIcon,
  ShieldCheckIcon,
} from '@/components/ui/Icons';

export interface AgenticExecutionMetrics {
  totalRounds?: number;
  totalToolCalls?: number;
  totalDurationMs?: number;
  totalRetrievalMs?: number;
  roundDurations?: Array<{ round: number; durationMs: number }>;
  toolExecutionBreakdown?: Array<{
    toolName: string;
    durationMs: number;
    itemsFound: number;
  }>;
}

interface ResearchWorkspaceProps {
  initialDocumentIds?: string[];
  documents: DocumentItem[];
  onInspectCitation: (citation: CitationItem) => void;
}

export function ResearchWorkspace({
  initialDocumentIds = [],
  documents,
  onInspectCitation,
}: ResearchWorkspaceProps) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<ConversationDetail | null>(null);
  const [isLoadingConv, setIsLoadingConv] = useState(false);

  // Mode: standard vs agentic
  const [researchMode, setResearchMode] = useState<'agentic' | 'standard'>('agentic');

  // Input & Streaming State
  const [inputQuestion, setInputQuestion] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedAnswer, setStreamedAnswer] = useState('');
  const [streamedStatus, setStreamedStatus] = useState<string | null>(null);
  const [streamedToolEvents, setStreamedToolEvents] = useState<AgenticToolEvent[]>([]);
  const [streamedCitations, setStreamedCitations] = useState<CitationItem[]>([]);
  const [streamedLimitations, setStreamedLimitations] = useState<string[]>([]);
  const [streamedMetrics, setStreamedMetrics] = useState<AgenticExecutionMetrics | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  // New Conversation Modal / Document Selector
  const [isNewConvOpen, setIsNewConvOpen] = useState(false);
  const [selectedDocIdsForNewConv, setSelectedDocIdsForNewConv] = useState<Set<string>>(
    new Set(initialDocumentIds)
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const QUICK_PROMPT_CARDS = [
    {
      title: 'Indemnification & Liability',
      desc: 'Verify liability caps and indemnification exclusions.',
      prompt: 'What are the indemnification obligations and liability caps across attached contracts?',
      icon: '🛡️',
      tag: 'Risk',
    },
    {
      title: 'Termination & Cure',
      desc: 'Notice periods, breach triggers, post-termination clauses.',
      prompt: 'Summarize termination notice periods and cure remedies across attached contracts.',
      icon: '⏱️',
      tag: 'Obligations',
    },
    {
      title: 'Restrictive Covenants & IP',
      desc: 'Non-compete, non-solicitation, IP ownership.',
      prompt: 'Are there any non-compete, exclusivity, or non-solicitation restrictions?',
      icon: '🔒',
      tag: 'Covenants',
    },
    {
      title: 'Governing Law & Disputes',
      desc: 'Dispute resolution, arbitration, governing laws.',
      prompt: 'What governing law, dispute resolution, and arbitration rules apply?',
      icon: '⚖️',
      tag: 'Jurisdiction',
    },
  ];

  // 1. Load conversations list
  useEffect(() => {
    fetchConversations()
      .then((list) => {
        setConversations(list);
        if (list.length > 0 && !activeConvId) {
          setActiveConvId(list[0].id);
        }
      })
      .catch(() => {
        // Ignore
      });
  }, []);

  // 2. Load active conversation details
  useEffect(() => {
    let isMounted = true;
    if (!activeConvId) {
      setActiveConv(null);
      return;
    }

    setIsLoadingConv(true);
    fetchConversationDetail(activeConvId)
      .then((detail) => {
        if (isMounted) {
          setActiveConv(detail);
          setIsLoadingConv(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsLoadingConv(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeConvId]);

  // 3. Handle initialDocumentIds auto-conversation creation if provided
  useEffect(() => {
    if (initialDocumentIds.length > 0 && documents.length > 0) {
      const completedIds = initialDocumentIds.filter((id) =>
        documents.some((d) => d.id === id && d.status === 'COMPLETED')
      );
      if (completedIds.length > 0) {
        createConversation(completedIds).then((newConv) => {
          setConversations((prev) => [newConv, ...prev]);
          setActiveConvId(newConv.id);
        });
      }
    }
  }, [initialDocumentIds, documents]);

  // Scroll internal chat container ONLY without scrolling the page or window
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [activeConv?.messages, streamedAnswer, streamedToolEvents]);

  // Stop Generation / SSE
  const handleStopStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamedStatus('Research interrupted by user.');
    }
  };

  // Submit Question Handler
  const handleSendQuestion = async (e?: React.FormEvent, customPrompt?: string) => {
    if (e) e.preventDefault();
    const promptToSend = (customPrompt || inputQuestion).trim();
    if (!promptToSend || isStreaming) return;

    let convId = activeConvId;

    // If no active session, automatically create one with all completed documents
    if (!convId) {
      const completedIds = documents.filter((d) => d.status === 'COMPLETED').map((d) => d.id);
      if (completedIds.length === 0) {
        setStreamError('Please upload and index at least one contract before asking research questions.');
        return;
      }
      try {
        const newConv = await createConversation(completedIds);
        setConversations((prev) => [newConv, ...prev]);
        setActiveConvId(newConv.id);
        convId = newConv.id;
      } catch (err: unknown) {
        setStreamError(err instanceof Error ? err.message : 'Failed to initialize session.');
        return;
      }
    }

    setInputQuestion('');
    setStreamError(null);
    setIsStreaming(true);
    setStreamedAnswer('');
    setStreamedStatus('Initializing investigation...');
    setStreamedToolEvents([]);
    setStreamedCitations([]);
    setStreamedLimitations([]);
    setStreamedMetrics(null);

    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    if (researchMode === 'agentic') {
      try {
        await streamAgenticResearch(
          convId,
          promptToSend,
          {
            onStatus(stage, message) {
              setStreamedStatus(`[${stage.toUpperCase()}] ${message}`);
            },
            onToolStart(tool, description, args, round) {
              setStreamedToolEvents((prev) => [
                ...prev,
                {
                  tool,
                  description,
                  args,
                  round,
                  status: 'running',
                },
              ]);
            },
            onToolResult(tool, summary, itemsFound, durationMs) {
              setStreamedToolEvents((prev) => {
                const updated = [...prev];
                const lastIdx = updated.findLastIndex((ev) => ev.tool === tool);
                if (lastIdx !== -1) {
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    summary,
                    itemsFound,
                    durationMs,
                    status: 'completed',
                  };
                }
                return updated;
              });
            },
            onCitations(data) {
              setStreamedStatus('Synthesizing grounded analysis...');
              setStreamedCitations(data.citations || []);
              setStreamedLimitations(data.limitations || []);
            },
            onToken(token) {
              setStreamedAnswer((prev) => prev + token);
            },
            onDone(doneData) {
              setIsStreaming(false);
              setStreamedStatus(null);
              setStreamedMetrics((doneData.metrics as AgenticExecutionMetrics) || null);
              if (convId) {
                fetchConversationDetail(convId).then(setActiveConv);
              }
            },
            onError(err) {
              setIsStreaming(false);
              setStreamError(err);
              setStreamedStatus(null);
            },
          },
          abortCtrl.signal
        );
      } catch (err: unknown) {
        setIsStreaming(false);
        if (!abortCtrl.signal.aborted) {
          setStreamError(err instanceof Error ? err.message : 'Research stream failed.');
        }
      }
    } else {
      // Standard Q&A mode
      try {
        await streamChatMessage(
          convId,
          promptToSend,
          {
            onStatus(stage, message) {
              setStreamedStatus(`[${stage.toUpperCase()}] ${message}`);
            },
            onToken(token) {
              setStreamedAnswer((prev) => prev + token);
            },
            onCitations(citations) {
              setStreamedCitations(citations);
            },
            onDone() {
              setIsStreaming(false);
              setStreamedStatus(null);
              if (convId) {
                fetchConversationDetail(convId).then(setActiveConv);
              }
            },
            onError(err) {
              setIsStreaming(false);
              setStreamError(err);
              setStreamedStatus(null);
            },
          },
          abortCtrl.signal
        );
      } catch (err: unknown) {
        setIsStreaming(false);
        if (!abortCtrl.signal.aborted) {
          setStreamError(err instanceof Error ? err.message : 'Q&A stream failed.');
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendQuestion();
    }
  };

  const handleCreateNewConversation = async () => {
    const docIds = Array.from(selectedDocIdsForNewConv);
    if (docIds.length === 0) return;
    try {
      const conv = await createConversation(docIds);
      setConversations((prev) => [conv, ...prev]);
      setActiveConvId(conv.id);
      setIsNewConvOpen(false);
    } catch {
      // Ignore
    }
  };

  const completedDocs = documents.filter((d) => d.status === 'COMPLETED');

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100vh - var(--header-height) - 48px)', maxHeight: 'calc(100vh - var(--header-height) - 48px)' }}>
      {/* 1. Control Toolbar */}
      <div className="workspace-action-row flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--primary-blue-subtle)',
              border: '1px solid var(--primary-blue-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary-blue)',
              flexShrink: 0,
            }}
          >
            <SparklesIcon size={16} />
          </div>
          <div className="min-w-0">
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {activeConv?.title || 'Legal Research Studio'}
            </span>
            <span className="desktop-only" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
              {activeConv ? `${activeConv.documents.length} contract${activeConv.documents.length === 1 ? '' : 's'} linked` : 'Multi-contract deterministic reasoning'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          {/* Mode Switcher */}
          <div
            className="flex items-center"
            style={{
              backgroundColor: 'var(--surface-secondary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: '3px',
              gap: '2px',
            }}
          >
            <button
              type="button"
              className={`btn btn-sm ${researchMode === 'agentic' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setResearchMode('agentic')}
              title="Multi-round autonomous investigation"
              style={{
                height: '30px',
                padding: '0 12px',
                fontSize: '0.8125rem',
                fontWeight: researchMode === 'agentic' ? 600 : 500,
              }}
            >
              <SparklesIcon size={13} />
              <span>Agentic</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm ${researchMode === 'standard' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setResearchMode('standard')}
              title="Direct grounded retrieval"
              style={{
                height: '30px',
                padding: '0 12px',
                fontSize: '0.8125rem',
                fontWeight: researchMode === 'standard' ? 600 : 500,
              }}
            >
              <SearchIcon size={13} />
              <span>Standard</span>
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setSelectedDocIdsForNewConv(new Set(completedDocs.map((d) => d.id)));
              setIsNewConvOpen(true);
            }}
            style={{ height: '36px' }}
          >
            <PlusIcon size={14} />
            <span>New Research</span>
          </button>
        </div>
      </div>

      {/* 2. Main Two-Panel Workspace */}
      <div className="flex flex-1 gap-4 min-h-0 items-stretch">
        {/* Left Sessions Sidebar */}
        <div
          className="card flex flex-col hidden md:flex"
          style={{ width: '260px', flexShrink: 0, overflow: 'hidden' }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ backgroundColor: 'var(--surface-secondary)' }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Sessions ({conversations.length})
            </span>
          </div>

          <div className="flex-1 p-2 flex flex-col gap-1.5 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted" style={{ lineHeight: 1.5 }}>
                No past sessions yet. Click <strong>+ New Research</strong> or ask a question to begin.
              </div>
            ) : (
              conversations.map((c) => {
                const isActive = c.id === activeConvId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveConvId(c.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid',
                      borderColor: isActive ? 'var(--primary-blue-border)' : 'transparent',
                      backgroundColor: isActive ? 'var(--primary-blue-subtle)' : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'var(--surface-secondary)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.875rem',
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? 'var(--primary-blue)' : 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        width: '100%',
                      }}
                    >
                      {c.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {c.documents?.length || 0} contract{c.documents?.length === 1 ? '' : 's'}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Attached Documents in Active Session */}
          {activeConv && activeConv.documents.length > 0 && (
            <div className="p-3 border-t flex flex-col gap-1.5 bg-subtle" style={{ maxHeight: '160px', overflowY: 'auto' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                Attached Contracts ({activeConv.documents.length})
              </div>
              {activeConv.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded"
                  style={{
                    backgroundColor: 'var(--surface-primary)',
                    fontSize: '0.75rem',
                    border: '1px solid var(--border-default)',
                  }}
                >
                  <FileTextIcon size={13} style={{ color: 'var(--primary-blue)', flexShrink: 0 }} />
                  <span
                    style={{
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--text-primary)',
                    }}
                    title={doc.originalFilename}
                  >
                    {doc.originalFilename}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Conversation Panel */}
        <div className="card flex-1 flex flex-col justify-between min-w-0 overflow-hidden">
          {/* Scrollable Conversation History */}
          <div
            ref={chatScrollRef}
            className="p-5 flex-1 flex flex-col gap-4 overflow-y-auto"
            style={{ backgroundColor: 'var(--surface-secondary)' }}
          >
            {isLoadingConv ? (
              <div className="p-8 text-center text-muted text-sm font-medium">
                Loading session transcript...
              </div>
            ) : !activeConv || activeConv.messages.length === 0 ? (
              /* Welcome Launchpad */
              <div className="flex flex-col gap-4 my-auto max-w-2xl mx-auto w-full">
                {/* Intro Card */}
                <div
                  className="p-4 rounded-lg border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  style={{
                    backgroundColor: 'var(--surface-primary)',
                    borderColor: 'var(--border-default)',
                    boxShadow: 'var(--shadow-card)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--primary-blue-subtle)',
                        border: '1px solid var(--primary-blue-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--primary-blue)',
                        flexShrink: 0,
                      }}
                    >
                      <ShieldCheckIcon size={20} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Legal Research Studio
                      </h3>
                      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        Autonomous agentic investigation with deterministic character-level verification.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="status-pill status-verified">✓ Multi-Tool</span>
                    <span className="status-pill status-verified">✓ Grounded</span>
                  </div>
                </div>

                {/* 2x2 Quick Query Suggestions */}
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                    Quick Research Queries
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
                    {QUICK_PROMPT_CARDS.map((card, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSendQuestion(undefined, card.prompt)}
                        className="text-left rounded-lg border flex flex-col justify-between gap-2"
                        style={{
                          padding: '14px 16px',
                          backgroundColor: 'var(--surface-primary)',
                          borderColor: 'var(--border-default)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          boxShadow: 'var(--shadow-card)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--primary-blue-subtle)';
                          e.currentTarget.style.borderColor = 'var(--primary-blue-border)';
                          e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--surface-primary)';
                          e.currentTarget.style.borderColor = 'var(--border-default)';
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span style={{ fontSize: '1.25rem' }}>{card.icon}</span>
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              color: 'var(--primary-blue)',
                              backgroundColor: 'var(--primary-blue-subtle)',
                              padding: '2px 7px',
                              borderRadius: 'var(--radius-xs)',
                              textTransform: 'uppercase',
                            }}
                          >
                            {card.tag}
                          </span>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                            {card.title}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.4 }}>
                            {card.desc}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Attached Documents in Context */}
                {activeConv && activeConv.documents.length > 0 && (
                  <div
                    className="p-3 rounded-lg border flex items-center justify-between"
                    style={{ backgroundColor: 'var(--surface-primary)', borderColor: 'var(--border-default)' }}
                  >
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      Scope: <strong>{activeConv.documents.length}</strong> contract(s)
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {activeConv.documents.map((d) => (
                        <span
                          key={d.id}
                          className="px-2.5 py-1 rounded border text-xs font-medium"
                          style={{
                            backgroundColor: 'var(--surface-secondary)',
                            borderColor: 'var(--border-default)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          📄 {d.originalFilename}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              activeConv.messages.map((msg) => {
                const isUser = msg.role === 'USER';
                return (
                  <div
                    key={msg.id}
                    className="flex flex-col gap-1"
                    style={{
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                      maxWidth: isUser ? '85%' : '100%',
                      width: isUser ? 'auto' : '100%',
                    }}
                  >
                    <div
                      style={{
                        padding: '14px 18px',
                        borderRadius: 'var(--radius-lg)',
                        backgroundColor: isUser ? 'var(--primary-blue)' : 'var(--surface-primary)',
                        color: isUser ? '#FFFFFF' : 'var(--text-primary)',
                        fontSize: '0.9375rem',
                        lineHeight: '1.6',
                        border: isUser ? 'none' : '1px solid var(--border-default)',
                        boxShadow: 'var(--shadow-card)',
                      }}
                    >
                      <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>

                      {/* Verified Citations Pills */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div
                          className="mt-3 pt-2.5 border-t flex flex-col gap-2"
                          style={{ borderColor: isUser ? 'rgba(255,255,255,0.2)' : 'var(--border-default)' }}
                        >
                          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: isUser ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)', letterSpacing: '0.04em' }}>
                            VERIFIED CITATIONS ({msg.citations.length})
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {msg.citations.map((cit, idx) => {
                              const isVerified = cit.verificationStatus === 'VERIFIED';
                              const isPartial = cit.verificationStatus === 'PARTIAL';
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => onInspectCitation(cit)}
                                  className={`status-pill ${
                                    isVerified
                                      ? 'status-verified'
                                      : isPartial
                                      ? 'status-partial'
                                      : 'status-refuted'
                                  }`}
                                  style={{ cursor: 'pointer', textAlign: 'left', padding: '4px 10px', fontSize: '0.8125rem' }}
                                  title={`Inspect quotation (Page ${cit.pageNumber || 'N/A'})`}
                                >
                                  {isVerified ? <CheckCircleIcon size={13} /> : isPartial ? <AlertTriangleIcon size={13} /> : <XCircleIcon size={13} />}
                                  <span>{cit.documentName || 'Document'}</span>
                                  {cit.pageNumber && <span>· p.{cit.pageNumber}</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Live Streaming Response Box */}
            {isStreaming && (
              <div
                className="flex flex-col gap-3"
                style={{
                  padding: '16px 20px',
                  backgroundColor: 'var(--primary-blue-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--primary-blue-border)',
                }}
              >
                {streamedStatus && (
                  <div className="flex items-center gap-2.5" style={{ color: 'var(--primary-blue)', fontSize: '0.875rem', fontWeight: 600 }}>
                    <div
                      style={{
                        width: '14px',
                        height: '14px',
                        border: '2px solid var(--primary-blue-border)',
                        borderTopColor: 'var(--primary-blue)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }}
                    />
                    <span>{streamedStatus}</span>
                  </div>
                )}

                {/* Tool Events */}
                {streamedToolEvents.length > 0 && (
                  <div className="flex flex-col gap-1.5 pt-2 border-t" style={{ borderColor: 'var(--primary-blue-border)' }}>
                    <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
                      AGENT TOOL CALLS
                    </div>
                    {streamedToolEvents.map((toolEv, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-1.5 flex items-center justify-between rounded"
                        style={{
                          backgroundColor: 'var(--surface-primary)',
                          border: '1px solid var(--border-default)',
                          fontSize: '0.75rem',
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <WrenchIcon size={13} style={{ color: 'var(--primary-blue)' }} />
                          <strong style={{ color: 'var(--text-primary)' }}>{toolEv.tool}:</strong>
                          <span style={{ color: 'var(--text-secondary)' }}>{toolEv.description}</span>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                          {toolEv.durationMs !== undefined ? `${toolEv.durationMs}ms` : 'running...'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Streamed Answer Content */}
                {streamedAnswer && (
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: 'var(--text-primary)', fontSize: '0.9375rem', paddingTop: '4px' }}>
                    {streamedAnswer}
                  </div>
                )}

                {/* Streamed Citations */}
                {streamedCitations.length > 0 && (
                  <div className="pt-2 flex flex-wrap gap-2">
                    {streamedCitations.map((cit, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onInspectCitation(cit)}
                        className="status-pill status-verified"
                        style={{ cursor: 'pointer', padding: '4px 10px', fontSize: '0.8125rem' }}
                      >
                        <CheckCircleIcon size={13} />
                        <span>{cit.documentName || 'Document'} · p.{cit.pageNumber || 1}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Limitations */}
                {streamedLimitations.length > 0 && (
                  <div
                    className="p-2.5 flex items-center gap-2 rounded"
                    style={{
                      backgroundColor: 'var(--status-partial-bg)',
                      border: '1px solid var(--status-partial-border)',
                      color: 'var(--status-partial-text)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <AlertTriangleIcon size={15} />
                    <span><strong>Coverage note:</strong> {streamedLimitations.join(' ')}</span>
                  </div>
                )}

                {/* Execution Metrics */}
                {streamedMetrics && (
                  <div
                    className="p-2.5 flex items-center justify-between rounded"
                    style={{
                      backgroundColor: 'var(--surface-primary)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-secondary)',
                      fontSize: '0.75rem',
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <LayersIcon size={14} />
                      <span>
                        <strong>{streamedMetrics.totalRounds || 1}</strong> round(s) · <strong>{streamedMetrics.totalToolCalls || 0}</strong> calls
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ClockIcon size={14} />
                      <span>{streamedMetrics.totalDurationMs ? `${streamedMetrics.totalDurationMs}ms` : '—'}</span>
                    </span>
                  </div>
                )}

                {/* Stop Button */}
                <div className="flex justify-end pt-1">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleStopStream}>
                    <StopCircleIcon size={14} />
                    <span>Stop Generation</span>
                  </button>
                </div>
              </div>
            )}

            {streamError && (
              <div
                style={{
                  backgroundColor: 'var(--status-refuted-bg)',
                  border: '1px solid var(--status-refuted-border)',
                  color: 'var(--status-refuted-text)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangleIcon size={16} />
                <span><strong>Error:</strong> {streamError}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Pinned Question Composer */}
          <form
            onSubmit={(e) => handleSendQuestion(e)}
            className="p-3.5 border-t flex items-end gap-3"
            style={{ backgroundColor: 'var(--surface-primary)' }}
          >
            <div className="flex-1 relative">
              <textarea
                rows={2}
                placeholder={
                  researchMode === 'agentic'
                    ? 'Ask a legal research question across attached contracts... (Press Enter to send, Shift+Enter for new line)'
                    : 'Ask a direct question... (Press Enter to send)'
                }
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                style={{
                  resize: 'none',
                  lineHeight: '1.5',
                  padding: '10px 14px',
                  fontSize: '0.9375rem',
                  height: '64px',
                }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!inputQuestion.trim() || isStreaming}
              style={{ height: '64px', padding: '0 20px' }}
            >
              <SendIcon size={16} />
              <span>{isStreaming ? 'Searching...' : 'Send'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* 3. New Session Modal */}
      {isNewConvOpen && (
        <div className="modal-backdrop" onClick={() => setIsNewConvOpen(false)} role="dialog" aria-modal="true">
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  New Research Session
                </h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Select contracts to include in the research scope
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIsNewConvOpen(false)}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2.5" style={{ maxHeight: '360px', overflowY: 'auto' }}>
              {completedDocs.length === 0 ? (
                <div className="text-sm text-muted p-4 bg-subtle rounded text-center">
                  No indexed contracts available. Upload a contract first.
                </div>
              ) : (
                completedDocs.map((d) => (
                  <label
                    key={d.id}
                    className="flex items-center gap-3 p-3 rounded-lg border text-sm cursor-pointer"
                    style={{
                      borderColor: selectedDocIdsForNewConv.has(d.id)
                        ? 'var(--primary-blue)'
                        : 'var(--border-default)',
                      backgroundColor: selectedDocIdsForNewConv.has(d.id)
                        ? 'var(--primary-blue-subtle)'
                        : 'var(--surface-primary)',
                      fontSize: '0.875rem',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDocIdsForNewConv.has(d.id)}
                      onChange={() => {
                        const next = new Set(selectedDocIdsForNewConv);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        setSelectedDocIdsForNewConv(next);
                      }}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <FileTextIcon size={16} style={{ color: 'var(--primary-blue)' }} />
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
                      {d.originalFilename}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {d.pagesCount} pp
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="p-3.5 border-t flex justify-end gap-2.5" style={{ backgroundColor: 'var(--surface-secondary)' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsNewConvOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={selectedDocIdsForNewConv.size === 0}
                onClick={handleCreateNewConversation}
              >
                Create Session ({selectedDocIdsForNewConv.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
