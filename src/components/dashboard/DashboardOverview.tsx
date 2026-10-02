'use client';

import React from 'react';
import { DocumentItem, ConversationItem } from '@/lib/api-client';
import {
  FileTextIcon,
  SearchIcon,
  ScaleIcon,
  PlusIcon,
  EyeIcon,
  ArrowRightIcon,
  SparklesIcon,
  LayersIcon,
  UploadCloudIcon,
  ShieldCheckIcon,
} from '@/components/ui/Icons';

interface DashboardOverviewProps {
  documents: DocumentItem[];
  conversations: ConversationItem[];
  isLoading: boolean;
  onOpenUpload: () => void;
  onNavigateTab: (tab: 'documents' | 'research' | 'compare') => void;
  onViewDocument: (doc: DocumentItem) => void;
  onStartResearch: (docIds: string[]) => void;
}

export function DashboardOverview({
  documents,
  conversations,
  isLoading,
  onOpenUpload,
  onNavigateTab,
  onViewDocument,
  onStartResearch,
}: DashboardOverviewProps) {
  const completedDocs = documents.filter((d) => d.status === 'COMPLETED');
  const totalChunks = documents.reduce((acc, d) => acc + (d.chunksCount || 0), 0);
  const totalPages = documents.reduce((acc, d) => acc + (d.pagesCount || 0), 0);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString: string): string => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Restrained Welcome Banner (No Giant Purple Gradients) */}
      <div className="welcome-card-clean">
        <div className="flex items-center gap-3.5">
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--primary-blue-subtle)',
              border: '1px solid var(--primary-blue-border)',
              color: 'var(--primary-blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.25rem',
              flexShrink: 0,
            }}
          >
            §
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.25 }}>
                Contract Intelligence Studio
              </h2>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--primary-blue)',
                  backgroundColor: 'var(--primary-blue-subtle)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--primary-blue-border)',
                }}
              >
                Zero Hallucination
              </span>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Deterministic chunking, multi-document research, clause comparison, and verified citations.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          <button type="button" className="btn btn-secondary" onClick={() => onNavigateTab('research')}>
            <SearchIcon size={15} />
            <span>AI Research</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={onOpenUpload}>
            <PlusIcon size={15} />
            <span>Upload Agreement</span>
          </button>
        </div>
      </div>

      {/* 2. 4-Column Metric Cards */}
      <div className="metrics-grid-dense">
        <div className="stat-card-compact" onClick={() => onNavigateTab('documents')}>
          <div>
            <div className="stat-label-compact">Total Contracts</div>
            <div className="stat-value-compact">{documents.length}</div>
            <div className="stat-subtext-compact">{completedDocs.length} indexed & ready</div>
          </div>
          <div
            className="stat-icon-wrapper"
            style={{
              backgroundColor: '#EFF6FF',
              color: '#2563EB',
            }}
          >
            <FileTextIcon size={20} />
          </div>
        </div>

        <div className="stat-card-compact" onClick={() => onNavigateTab('documents')}>
          <div>
            <div className="stat-label-compact">Extracted Pages</div>
            <div className="stat-value-compact">{totalPages}</div>
            <div className="stat-subtext-compact">Deterministic coordinates</div>
          </div>
          <div
            className="stat-icon-wrapper"
            style={{
              backgroundColor: '#ECFDF5',
              color: '#059669',
            }}
          >
            <LayersIcon size={20} />
          </div>
        </div>

        <div className="stat-card-compact" onClick={() => onNavigateTab('documents')}>
          <div>
            <div className="stat-label-compact">Semantic Chunks</div>
            <div className="stat-value-compact">{totalChunks}</div>
            <div className="stat-subtext-compact">1,500-char bounded windows</div>
          </div>
          <div
            className="stat-icon-wrapper"
            style={{
              backgroundColor: '#F5F3FF',
              color: '#7C3AED',
            }}
          >
            <SparklesIcon size={20} />
          </div>
        </div>

        <div className="stat-card-compact" onClick={() => onNavigateTab('research')}>
          <div>
            <div className="stat-label-compact">Research Sessions</div>
            <div className="stat-value-compact">{conversations.length}</div>
            <div className="stat-subtext-compact">Agentic & grounded Q&A</div>
          </div>
          <div
            className="stat-icon-wrapper"
            style={{
              backgroundColor: '#FFFBEB',
              color: '#D97706',
            }}
          >
            <SearchIcon size={20} />
          </div>
        </div>
      </div>

      {/* 3. Main Content: Recent Contracts Table + Quick Actions */}
      <div className="dashboard-grid-compact">
        {/* Left Column: Recent Contracts Table */}
        <div className="card flex flex-col" style={{ overflow: 'hidden' }}>
          <div className="card-header">
            <div className="flex items-center gap-2.5">
              <FileTextIcon size={16} style={{ color: 'var(--primary-blue)' }} />
              <span className="card-title">
                Recent Contracts ({documents.length})
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onNavigateTab('documents')}
            >
              <span>View All Documents</span>
              <ArrowRightIcon size={13} />
            </button>
          </div>

          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted">
              Loading contract library...
            </div>
          ) : documents.length === 0 ? (
            <div style={{ padding: '48px 24px' }} className="text-center flex flex-col items-center gap-3">
              <UploadCloudIcon size={32} style={{ color: 'var(--text-light)' }} />
              <div>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>No contracts uploaded yet</div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>Upload PDF or DOCX agreements to begin deterministic analysis.</p>
              </div>
              <button type="button" className="btn btn-primary btn-sm mt-2" onClick={onOpenUpload}>
                <PlusIcon size={14} />
                <span>Upload First Contract</span>
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table-dense">
                <thead>
                  <tr>
                    <th>Contract Name</th>
                    <th>Type</th>
                    <th>Pages / Chunks</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.slice(0, 6).map((doc) => {
                    const isPdf = doc.mimeType.includes('pdf');
                    return (
                      <tr key={doc.id}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: isPdf ? '#FEF2F2' : '#EFF6FF',
                                color: isPdf ? '#DC2626' : '#2563EB',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <FileTextIcon size={16} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  fontSize: '0.875rem',
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: '200px',
                                }}
                                title={doc.originalFilename}
                              >
                                {doc.originalFilename}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                {formatFileSize(doc.fileSize)} · {formatDate(doc.createdAt)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 'var(--radius-xs)',
                              backgroundColor: isPdf ? '#FEF2F2' : '#EFF6FF',
                              color: isPdf ? '#991B1B' : '#1E40AF',
                              border: `1px solid ${isPdf ? '#FECACA' : '#BFDBFE'}`,
                            }}
                          >
                            {isPdf ? 'PDF' : 'DOCX'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                          {doc.status === 'COMPLETED' ? (
                            <span>
                              <strong>{doc.pagesCount}</strong> pp · {doc.chunksCount} chk
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {doc.status === 'COMPLETED' && (
                            <span className="status-pill status-verified">✓ Ready</span>
                          )}
                          {doc.status === 'PROCESSING' && (
                            <span className="status-pill status-partial">⏳ Processing</span>
                          )}
                          {doc.status === 'FAILED' && (
                            <span className="status-pill status-refuted" title={doc.processingError || ''}>
                              ✕ Failed
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onViewDocument(doc)}
                              title="View authoritative contract text"
                            >
                              <EyeIcon size={13} />
                              <span>View</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={doc.status !== 'COMPLETED'}
                              onClick={() => onStartResearch([doc.id])}
                              title="Start AI research on this agreement"
                            >
                              <SearchIcon size={13} />
                              <span>Ask</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Quick Actions & Verification */}
        <div className="flex flex-col gap-4">
          {/* Quick Actions Panel */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-header">
              <span className="card-title">
                Quick Actions
              </span>
            </div>
            <div style={{ padding: '12px' }} className="flex flex-col gap-2">
              {[
                {
                  label: 'Multi-Contract Research',
                  desc: 'Autonomous agent with verified quotes',
                  icon: <SparklesIcon size={16} />,
                  iconBg: 'var(--primary-blue-subtle)',
                  iconColor: 'var(--primary-blue)',
                  onClick: () => onNavigateTab('research'),
                },
                {
                  label: 'Contract Comparison',
                  desc: 'Clause-by-clause diff analysis',
                  icon: <ScaleIcon size={16} />,
                  iconBg: '#F5F3FF',
                  iconColor: '#7C3AED',
                  onClick: () => onNavigateTab('compare'),
                },
                {
                  label: 'Upload Agreement',
                  desc: 'PDF or DOCX up to 150+ pages',
                  icon: <PlusIcon size={16} />,
                  iconBg: '#ECFDF5',
                  iconColor: '#059669',
                  onClick: onOpenUpload,
                },
              ].map((action, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={action.onClick}
                  className="flex items-center justify-between w-full text-left"
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-default)',
                    backgroundColor: 'var(--surface-primary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--surface-secondary)';
                    e.currentTarget.style.borderColor = 'var(--primary-blue-border)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--surface-primary)';
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: action.iconBg,
                        color: action.iconColor,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {action.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {action.label}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                        {action.desc}
                      </div>
                    </div>
                  </div>
                  <ArrowRightIcon size={14} style={{ color: 'var(--text-light)' }} />
                </button>
              ))}
            </div>
          </div>

          {/* Verification Status Card */}
          <div
            className="card"
            style={{ padding: '16px 18px' }}
          >
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--status-verified-bg)',
                  color: 'var(--status-verified-text)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ShieldCheckIcon size={16} />
              </div>
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Citation Verification
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--status-verified-text)', fontWeight: 600 }}>
                  Active & Grounded
                </div>
              </div>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.45, marginTop: '8px' }}>
              All citations undergo dual database verification. LLM page offsets and extracted passages are automatically validated against authoritative text.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
