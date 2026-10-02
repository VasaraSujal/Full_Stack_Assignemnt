'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DocumentDetail, CitationItem, fetchDocumentDetail } from '@/lib/api-client';
import {
  FileTextIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
  AlertTriangleIcon,
  ShieldCheckIcon,
} from '@/components/ui/Icons';

interface DocumentViewerProps {
  documentId: string;
  activeCitation?: CitationItem | null;
  onClose?: () => void;
}

export function DocumentViewer({
  documentId,
  activeCitation,
  onClose,
}: DocumentViewerProps) {
  const [docDetail, setDocDetail] = useState<DocumentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const highlightRef = useRef<HTMLElement | null>(null);

  // Load document details
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetchDocumentDetail(documentId)
      .then((data) => {
        if (isMounted) {
          setDocDetail(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load document details');
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [documentId]);

  // Navigate to citation page when activeCitation changes
  useEffect(() => {
    if (activeCitation?.pageNumber && activeCitation.pageNumber > 0) {
      setCurrentPage(activeCitation.pageNumber);
    }
  }, [activeCitation]);

  // Scroll active highlight into view
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentPage, activeCitation, docDetail]);

  const activePage = useMemo(() => {
    if (!docDetail || !docDetail.pages || docDetail.pages.length === 0) return null;
    return docDetail.pages.find((p) => p.pageNumber === currentPage) || docDetail.pages[0];
  }, [docDetail, currentPage]);

  const totalPages = docDetail?.pages?.length || 1;

  // Render page text with citation highlight
  const renderHighlightedText = (text: string) => {
    if (
      !activeCitation ||
      !activeCitation.quotedText ||
      activeCitation.verificationStatus === 'REFUTED' ||
      activeCitation.verificationStatus === 'UNVERIFIED'
    ) {
      return <span>{text}</span>;
    }

    const quote = activeCitation.quotedText.trim();
    if (!quote || quote.length < 3) {
      return <span>{text}</span>;
    }

    // 1. If exact pageOffsets are provided in authoritative metadata and match within page bounds
    const pageOffsets = activeCitation.locationMetadata?.pageOffsets;
    if (
      pageOffsets &&
      pageOffsets.start >= 0 &&
      pageOffsets.end > pageOffsets.start &&
      pageOffsets.end <= text.length
    ) {
      const before = text.slice(0, pageOffsets.start);
      const matched = text.slice(pageOffsets.start, pageOffsets.end);
      const after = text.slice(pageOffsets.end);

      return (
        <>
          <span>{before}</span>
          <mark
            ref={(el) => {
              highlightRef.current = el;
            }}
            className="citation-highlight active citation-pulse"
            title={`Authoritative Verified Citation (Offsets [${pageOffsets.start}-${pageOffsets.end}])`}
          >
            {matched}
          </mark>
          <span>{after}</span>
        </>
      );
    }

    // 2. Direct exact or case-insensitive search
    const lowerText = text.toLowerCase();
    const lowerQuote = quote.toLowerCase();
    let matchIdx = lowerText.indexOf(lowerQuote);
    let matchedLen = quote.length;

    // 3. Normalized whitespace / multiline fallback match
    if (matchIdx === -1) {
      const words = quote
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (words.length > 1) {
        const pattern = new RegExp(words.join('\\s+'), 'i');
        const regMatch = pattern.exec(text);
        if (regMatch) {
          matchIdx = regMatch.index;
          matchedLen = regMatch[0].length;
        }
      }
    }

    if (matchIdx === -1) {
      return <span>{text}</span>;
    }

    const before = text.slice(0, matchIdx);
    const matched = text.slice(matchIdx, matchIdx + matchedLen);
    const after = text.slice(matchIdx + matchedLen);

    return (
      <>
        <span>{before}</span>
        <mark
          ref={(el) => {
            highlightRef.current = el;
          }}
          className="citation-highlight active citation-pulse"
          title={`Verified Citation: "${quote}"`}
        >
          {matched}
        </mark>
        <span>{after}</span>
      </>
    );
  };

  if (isLoading) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3" style={{ padding: '48px 20px' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            border: '2px solid var(--border-default)',
            borderTopColor: 'var(--primary-blue)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          Loading authoritative contract text...
        </div>
      </div>
    );
  }

  if (error || !docDetail) {
    return (
      <div className="card flex flex-col items-center gap-3" style={{ padding: '48px 24px', textAlign: 'center' }}>
        <AlertTriangleIcon size={28} style={{ color: 'var(--status-refuted-text)' }} />
        <div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>
            Failed to Load Contract
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {error || 'Document could not be retrieved from storage.'}
          </p>
        </div>
        {onClose && (
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={onClose}>
            Back to Documents
          </button>
        )}
      </div>
    );
  }

  const isPdf = docDetail.mimeType.includes('pdf');

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Top Document Header Bar */}
      <div className="workspace-action-row flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
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
          <div className="min-w-0">
            <h2
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={docDetail.originalFilename}
            >
              {docDetail.originalFilename}
            </h2>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1px' }}>
              {totalPages} page{totalPages === 1 ? '' : 's'} · {docDetail.counts.chunks} chunks indexed
            </div>
          </div>
        </div>

        {/* Page Navigator & Close */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div
            className="flex items-center gap-1.5 p-1 rounded-md"
            style={{
              backgroundColor: 'var(--surface-secondary)',
              border: '1px solid var(--border-default)',
            }}
          >
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              aria-label="Previous Page"
              style={{ height: '28px', padding: '0 8px' }}
            >
              <ChevronLeftIcon size={15} />
              <span>Prev</span>
            </button>

            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', padding: '0 8px' }}>
              Page {currentPage} of {totalPages}
            </span>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next Page"
              style={{ height: '28px', padding: '0 8px' }}
            >
              <span>Next</span>
              <ChevronRightIcon size={15} />
            </button>
          </div>

          {onClose && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              title="Close viewer"
              style={{ height: '36px' }}
            >
              <XIcon size={15} />
              <span>Close Viewer</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Active Citation Inspector Banner */}
      {activeCitation && (
        <div
          className="card p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
          style={{
            backgroundColor: 'var(--status-verified-bg)',
            borderColor: 'var(--status-verified-border)',
          }}
        >
          <div className="flex items-center gap-3">
            <ShieldCheckIcon size={20} style={{ color: 'var(--status-verified-text)', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--status-verified-text)' }}>
                Authoritative Citation Inspector
              </div>
              <p style={{ fontSize: '0.8125rem', color: '#047857', marginTop: '1px' }}>
                Highlighted passage matches verified ground-truth text chunk on Page {currentPage}.
              </p>
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#047857', fontFamily: 'monospace', maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Quote: &ldquo;{activeCitation.quotedText}&rdquo;
          </div>
        </div>
      )}

      {/* 3. Document Page Reader Body */}
      <div
        className="card"
        style={{
          padding: '28px 32px',
          backgroundColor: '#FFFFFF',
          minHeight: '520px',
          maxHeight: 'calc(100vh - 190px)',
          overflowY: 'auto',
          fontSize: '0.9375rem',
          lineHeight: '1.75',
          fontFamily: "'Inter', sans-serif",
          whiteSpace: 'pre-wrap',
          color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {activePage && activePage.extractedText ? (
          renderHighlightedText(activePage.extractedText)
        ) : (
          <div style={{ padding: '48px 24px', textAlign: 'center' }} className="text-muted text-sm">
            No extractable text found on Page {currentPage}.
          </div>
        )}
      </div>
    </div>
  );
}
