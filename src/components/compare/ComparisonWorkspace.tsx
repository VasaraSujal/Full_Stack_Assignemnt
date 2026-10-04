'use client';

import React, { useState } from 'react';
import {
  DocumentItem,
  ComparisonResult,
  CitationItem,
  runComparison,
} from '@/lib/api-client';
import {
  ScaleIcon,
  FileTextIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  SparklesIcon,
  ShieldCheckIcon,
  LayersIcon,
} from '@/components/ui/Icons';

interface ComparisonWorkspaceProps {
  initialDocumentIds?: string[];
  documents: DocumentItem[];
  onInspectCitation: (citation: CitationItem) => void;
}

export function ComparisonWorkspace({
  initialDocumentIds = [],
  documents,
  onInspectCitation,
}: ComparisonWorkspaceProps) {
  const completedDocs = documents.filter((d) => d.status === 'COMPLETED');

  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(
    new Set(initialDocumentIds.length >= 2 ? initialDocumentIds.slice(0, 2) : completedDocs.slice(0, 2).map((d) => d.id))
  );
  const [focusQuestion, setFocusQuestion] = useState('');
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [significanceFilter, setSignificanceFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const toggleDocSelection = (id: string) => {
    const updated = new Set(selectedDocIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      if (updated.size >= 5) return;
      updated.add(id);
    }
    setSelectedDocIds(updated);
  };

  const handleRunCompare = async () => {
    if (selectedDocIds.size < 2) return;
    setIsComparing(true);
    setError(null);

    try {
      const result = await runComparison(
        Array.from(selectedDocIds),
        focusQuestion.trim() || undefined
      );
      setComparisonResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Comparison failed.');
    } finally {
      setIsComparing(false);
    }
  };

  // Filtered changes
  const filteredChanges = comparisonResult?.changes.filter((c) => {
    if (significanceFilter !== 'ALL' && c.significance !== significanceFilter) return false;
    if (categoryFilter !== 'ALL' && c.category !== categoryFilter) return false;
    return true;
  }) || [];

  const availableCategories = Array.from(
    new Set(comparisonResult?.changes.map((c) => c.category) || [])
  );

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Contract Selection & Configuration Card */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header">
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Contract Comparison
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Select 2 to 5 agreements to analyze clause variations, risk modifications, and textual differences.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary flex-shrink-0"
            disabled={selectedDocIds.size < 2 || isComparing}
            onClick={handleRunCompare}
          >
            <ScaleIcon size={15} />
            <span className="desktop-only">{isComparing ? 'Comparing...' : `Compare Contracts (${selectedDocIds.size})`}</span>
            <span className="mobile-only">{isComparing ? 'Comparing...' : `Compare (${selectedDocIds.size})`}</span>
          </button>
        </div>

        <div style={{ padding: '18px 20px' }} className="flex flex-col gap-4">
          {/* Document Multi-Selection Chips */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Select Contracts to Compare ({completedDocs.length} available · select 2 to 5):
              </span>
              <span style={{ fontSize: '0.75rem', color: selectedDocIds.size < 2 ? 'var(--status-partial-text)' : 'var(--status-verified-text)', fontWeight: 600 }}>
                {selectedDocIds.size} of 5 selected {selectedDocIds.size < 2 ? '(minimum 2 required)' : ''}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {completedDocs.length === 0 ? (
                <div className="text-sm text-muted p-3 bg-subtle rounded w-full">
                  No indexed contracts available. Upload at least 2 agreements to compare.
                </div>
              ) : (
                completedDocs.map((doc) => {
                  const isSelected = selectedDocIds.has(doc.id);
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => toggleDocSelection(doc.id)}
                      className="btn btn-sm"
                      style={{
                        backgroundColor: isSelected ? 'var(--primary-blue-subtle)' : 'var(--surface-primary)',
                        borderColor: isSelected ? 'var(--primary-blue)' : 'var(--border-default)',
                        color: isSelected ? 'var(--primary-blue)' : 'var(--text-primary)',
                        fontWeight: isSelected ? 600 : 500,
                        padding: '6px 12px',
                        height: '34px',
                        fontSize: '0.8125rem',
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{isSelected ? '✓' : '+'}</span>
                      <FileTextIcon size={14} />
                      <span>{doc.originalFilename}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Optional Topic Focus Filter */}
          <div className="flex items-center gap-3 pt-3 border-t">
            <div style={{ flex: 1 }}>
              <input
                type="text"
                placeholder="Optional: Focus comparison on a topic (e.g. 'indemnification caps', 'liability limits', 'governing law')..."
                value={focusQuestion}
                onChange={(e) => setFocusQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRunCompare();
                }}
                style={{ height: '40px', fontSize: '0.875rem' }}
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: 'var(--status-refuted-bg)',
            border: '1px solid var(--status-refuted-border)',
            color: 'var(--status-refuted-text)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangleIcon size={16} />
          <span><strong>Error:</strong> {error}</span>
        </div>
      )}

      {/* 2. Loading State */}
      {isComparing && (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div className="flex flex-col items-center gap-3">
            <div
              style={{
                width: '32px',
                height: '32px',
                border: '3px solid var(--border-default)',
                borderTopColor: 'var(--primary-blue)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Analyzing Clause Differences...
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Aligning legal provisions, deriving verbatim quotes, and validating coordinate citations across selected contracts.
            </p>
          </div>
        </div>
      )}

      {/* 3. Informative Initial Guided State (When No Comparison Run Yet) */}
      {!comparisonResult && !isComparing && (
        <div className="card" style={{ padding: '24px 28px' }}>
          <div className="flex items-center gap-2.5 mb-4">
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--primary-blue-subtle)',
                color: 'var(--primary-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SparklesIcon size={16} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                How Clause Comparison Works
              </h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Deterministic cross-document difference engine with zero-hallucination citation verification.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div
              style={{
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--surface-secondary)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div className="flex items-center gap-2 mb-1.5" style={{ color: 'var(--primary-blue)', fontWeight: 600, fontSize: '0.875rem' }}>
                <LayersIcon size={16} />
                <span>1. Semantic Alignment</span>
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Clauses from different contracts are automatically grouped by legal subject matter, such as Confidentiality, Liability Caps, and Termination.
              </p>
            </div>

            <div
              style={{
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--surface-secondary)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div className="flex items-center gap-2 mb-1.5" style={{ color: 'var(--status-verified-text)', fontWeight: 600, fontSize: '0.875rem' }}>
                <ShieldCheckIcon size={16} />
                <span>2. Dual Quote Verification</span>
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Every identified difference quotes verbatim source text from each contract. Quotes are checked against database pages before display.
              </p>
            </div>

            <div
              style={{
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--surface-secondary)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div className="flex items-center gap-2 mb-1.5" style={{ color: '#D97706', fontWeight: 600, fontSize: '0.875rem' }}>
                <ScaleIcon size={16} />
                <span>3. Risk Classification</span>
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Each change is scored as High, Medium, or Low significance so counsel can immediately pinpoint material business risks.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4. Comparison Results */}
      {comparisonResult && !isComparing && (
        <div className="flex flex-col gap-4">
          {/* Executive Summary Card */}
          <div
            className="card"
            style={{
              padding: '18px 22px',
              borderLeft: '4px solid var(--primary-blue)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-blue)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Executive Comparison Summary
              </span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                {comparisonResult.changes.length} textual differences detected
              </span>
            </div>
            <p style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap', fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
              {comparisonResult.summary}
            </p>
          </div>

          {/* Filter Toolbar */}
          <div className="workspace-action-row flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Significance:
              </span>
              {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sig) => (
                <button
                  key={sig}
                  type="button"
                  onClick={() => setSignificanceFilter(sig)}
                  className={`status-pill ${
                    significanceFilter === sig
                      ? sig === 'HIGH'
                        ? 'status-high'
                        : sig === 'MEDIUM'
                        ? 'status-partial'
                        : 'status-verified'
                      : 'status-unverified'
                  }`}
                  style={{ cursor: 'pointer', padding: '4px 10px', fontSize: '0.8125rem' }}
                >
                  {sig}
                </button>
              ))}
            </div>

            {availableCategories.length > 1 && (
              <div className="flex items-center gap-2">
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Category:
                </span>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{
                    height: '32px',
                    padding: '0 10px',
                    fontSize: '0.8125rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    backgroundColor: 'var(--surface-primary)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="ALL">All Categories ({comparisonResult.changes.length})</option>
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Clause Difference Cards */}
          <div className="flex flex-col gap-3">
            {filteredChanges.length === 0 ? (
              <div className="card" style={{ padding: '36px 20px', textAlign: 'center' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No differences match active filter criteria.</span>
              </div>
            ) : (
              filteredChanges.map((change, idx) => {
                const isHigh = change.significance === 'HIGH';
                const isMed = change.significance === 'MEDIUM';
                return (
                  <div
                    key={idx}
                    className="card"
                    style={{
                      padding: '16px 20px',
                      borderLeft: `4px solid ${isHigh ? '#DC2626' : isMed ? '#D97706' : '#10B981'}`,
                    }}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 'var(--radius-xs)',
                              backgroundColor: isHigh ? 'var(--status-refuted-bg)' : isMed ? 'var(--status-partial-bg)' : 'var(--status-verified-bg)',
                              color: isHigh ? 'var(--status-refuted-text)' : isMed ? 'var(--status-partial-text)' : 'var(--status-verified-text)',
                              border: `1px solid ${isHigh ? 'var(--status-refuted-border)' : isMed ? 'var(--status-partial-border)' : 'var(--status-verified-border)'}`,
                              textTransform: 'uppercase',
                            }}
                          >
                            {change.significance} RISK
                          </span>
                          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {change.category}
                          </span>
                        </div>
                      </div>

                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: '1.55' }}>
                        {change.description}
                      </p>

                      {/* Source Quotes Side by Side */}
                      <div className="pt-2.5 border-t flex flex-col gap-2">
                        <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Authoritative Source Passages
                        </div>
                        <div className="compare-quotes-grid">
                          {/* Doc A */}
                          {change.documentA && change.documentA.quote && (
                            <div
                              className="p-3 rounded-lg border flex flex-col justify-between gap-2"
                              style={{
                                backgroundColor: 'var(--surface-secondary)',
                                borderColor: 'var(--border-default)',
                              }}
                            >
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.75rem' }}>
                                📄 {change.documentA.documentName || 'Document A'} {change.documentA.pageNumber ? `(p.${change.documentA.pageNumber})` : ''}
                              </div>
                              <blockquote style={{ fontStyle: 'italic', color: 'var(--text-secondary)', lineHeight: '1.45', fontSize: '0.8125rem' }}>
                                &ldquo;{change.documentA.quote}&rdquo;
                              </blockquote>
                              <button
                                type="button"
                                onClick={() =>
                                  onInspectCitation({
                                    documentId: change.documentA.documentId,
                                    documentName: change.documentA.documentName,
                                    quotedText: change.documentA.quote,
                                    pageNumber: change.documentA.pageNumber,
                                    verificationStatus: change.documentA.verificationStatus as 'VERIFIED' | 'PARTIAL' | 'REFUTED' | 'UNVERIFIED',
                                    locationMetadata: change.documentA.locationMetadata,
                                  })
                                }
                                className="status-pill status-verified"
                                style={{ cursor: 'pointer', alignSelf: 'flex-start', padding: '3px 8px', fontSize: '0.75rem' }}
                              >
                                <CheckCircleIcon size={12} />
                                <span>Inspect Quote A</span>
                              </button>
                            </div>
                          )}

                          {/* Doc B */}
                          {change.documentB && change.documentB.quote && (
                            <div
                              className="p-3 rounded-lg border flex flex-col justify-between gap-2"
                              style={{
                                backgroundColor: 'var(--surface-secondary)',
                                borderColor: 'var(--border-default)',
                              }}
                            >
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.75rem' }}>
                                📄 {change.documentB.documentName || 'Document B'} {change.documentB.pageNumber ? `(p.${change.documentB.pageNumber})` : ''}
                              </div>
                              <blockquote style={{ fontStyle: 'italic', color: 'var(--text-secondary)', lineHeight: '1.45', fontSize: '0.8125rem' }}>
                                &ldquo;{change.documentB.quote}&rdquo;
                              </blockquote>
                              <button
                                type="button"
                                onClick={() =>
                                  onInspectCitation({
                                    documentId: change.documentB.documentId,
                                    documentName: change.documentB.documentName,
                                    quotedText: change.documentB.quote,
                                    pageNumber: change.documentB.pageNumber,
                                    verificationStatus: change.documentB.verificationStatus as 'VERIFIED' | 'PARTIAL' | 'REFUTED' | 'UNVERIFIED',
                                    locationMetadata: change.documentB.locationMetadata,
                                  })
                                }
                                className="status-pill status-verified"
                                style={{ cursor: 'pointer', alignSelf: 'flex-start', padding: '3px 8px', fontSize: '0.75rem' }}
                              >
                                <CheckCircleIcon size={12} />
                                <span>Inspect Quote B</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
