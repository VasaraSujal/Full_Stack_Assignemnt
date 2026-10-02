'use client';

import React, { useState, useMemo } from 'react';
import { DocumentItem, deleteDocument } from '@/lib/api-client';
import { UploadModal } from './UploadModal';
import {
  FileTextIcon,
  SearchIcon,
  ScaleIcon,
  EyeIcon,
  Trash2Icon,
  PlusIcon,
  UploadCloudIcon,
  AlertTriangleIcon,
  XIcon,
} from '@/components/ui/Icons';

interface DocumentLibraryProps {
  documents: DocumentItem[];
  isLoading: boolean;
  onRefresh: () => void;
  onViewDocument: (doc: DocumentItem) => void;
  onStartResearch: (docIds: string[]) => void;
  onStartCompare: (docIds: string[]) => void;
}

export function DocumentLibrary({
  documents,
  isLoading,
  onRefresh,
  onViewDocument,
  onStartResearch,
  onStartCompare,
}: DocumentLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<'ALL' | 'PDF' | 'DOCX'>('ALL');
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<DocumentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Filter documents by search query and format
  const filteredDocuments = useMemo(() => {
    let result = documents;
    if (formatFilter === 'PDF') {
      result = result.filter((d) => d.mimeType.includes('pdf'));
    } else if (formatFilter === 'DOCX') {
      result = result.filter((d) => !d.mimeType.includes('pdf'));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((d) => d.originalFilename.toLowerCase().includes(q));
    }
    return result;
  }, [documents, searchQuery, formatFilter]);

  const toggleSelectAll = () => {
    if (selectedDocIds.size === filteredDocuments.length) {
      setSelectedDocIds(new Set());
    } else {
      setSelectedDocIds(new Set(filteredDocuments.map((d) => d.id)));
    }
  };

  const toggleSelectDoc = (id: string) => {
    const updated = new Set(selectedDocIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedDocIds(updated);
  };

  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteDocument(docToDelete.id);
      setDocToDelete(null);
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete document';
      setDeleteError(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString: string): string => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  const completedSelectedCount = useMemo(() => {
    return documents.filter((d) => selectedDocIds.has(d.id) && d.status === 'COMPLETED').length;
  }, [documents, selectedDocIds]);

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Header Toolbar */}
      <div className="workspace-action-row flex-wrap">
        <div className="flex items-center gap-2">
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
            {(['ALL', 'PDF', 'DOCX'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`btn btn-sm ${formatFilter === f ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFormatFilter(f)}
                style={{
                  height: '30px',
                  padding: '0 12px',
                  fontSize: '0.8125rem',
                  fontWeight: formatFilter === f ? 600 : 500,
                }}
              >
                {f === 'ALL'
                  ? `All (${documents.length})`
                  : f === 'PDF'
                  ? `PDF (${documents.filter((d) => d.mimeType.includes('pdf')).length})`
                  : `DOCX (${documents.filter((d) => !d.mimeType.includes('pdf')).length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-1 justify-end">
          <div style={{ position: 'relative', maxWidth: '320px', width: '100%' }}>
            <span
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-light)',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <SearchIcon size={16} />
            </span>
            <input
              type="text"
              placeholder="Search contracts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                paddingLeft: '36px',
                paddingRight: '32px',
                height: '38px',
                fontSize: '0.875rem',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-light)',
                  cursor: 'pointer',
                  display: 'flex',
                  padding: '2px',
                }}
                aria-label="Clear search"
              >
                <XIcon size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary flex-shrink-0"
            onClick={() => setIsUploadOpen(true)}
          >
            <PlusIcon size={15} />
            <span>Upload Contract</span>
          </button>
        </div>
      </div>

      {/* 2. Bulk Action Banner */}
      {selectedDocIds.size > 0 && (
        <div
          className="workspace-action-row"
          style={{
            backgroundColor: 'var(--primary-blue-subtle)',
            borderColor: 'var(--primary-blue-border)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--primary-blue)' }}>
            {selectedDocIds.size} agreement{selectedDocIds.size === 1 ? '' : 's'} selected ({completedSelectedCount} ready)
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={completedSelectedCount === 0}
              onClick={() => onStartResearch(Array.from(selectedDocIds))}
            >
              <SearchIcon size={14} />
              <span>Research Selected ({completedSelectedCount})</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={completedSelectedCount < 2 || completedSelectedCount > 5}
              onClick={() => onStartCompare(Array.from(selectedDocIds))}
              title={
                completedSelectedCount < 2
                  ? 'Select 2 to 5 completed contracts'
                  : 'Compare selected contracts'
              }
            >
              <ScaleIcon size={14} />
              <span>Compare Selected ({completedSelectedCount})</span>
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedDocIds(new Set())}
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* 3. Main Document Table */}
      {isLoading ? (
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
            Loading contract repository...
          </div>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div className="flex flex-col items-center gap-3">
            <UploadCloudIcon size={32} style={{ color: 'var(--text-light)' }} />
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {searchQuery ? 'No matching contracts found' : 'No contracts uploaded yet'}
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', maxWidth: '420px', margin: '4px auto 0' }}>
                {searchQuery
                  ? `No agreements match your search "${searchQuery}". Try a different keyword or reset filters.`
                  : 'Upload PDF or DOCX legal agreements to enable deep multi-document research and clause comparisons.'}
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-sm mt-2" onClick={() => setIsUploadOpen(true)}>
              <PlusIcon size={14} />
              <span>Upload Contract</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table-dense">
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedDocIds.size === filteredDocuments.length && filteredDocuments.length > 0}
                    onChange={toggleSelectAll}
                    aria-label="Select all contracts"
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                </th>
                <th>Contract Name</th>
                <th>Type</th>
                <th>Pages / Chunks</th>
                <th>Status</th>
                <th>Upload Date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.map((doc) => {
                const isSelected = selectedDocIds.has(doc.id);
                const isPdf = doc.mimeType.includes('pdf');
                return (
                  <tr
                    key={doc.id}
                    style={{
                      backgroundColor: isSelected ? 'var(--primary-blue-subtle)' : undefined,
                    }}
                  >
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectDoc(doc.id)}
                        aria-label={`Select ${doc.originalFilename}`}
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                    </td>
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
                              color: 'var(--text-primary)',
                              fontSize: '0.875rem',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '320px',
                            }}
                            title={doc.originalFilename}
                          >
                            {doc.originalFilename}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                            {formatFileSize(doc.fileSize)}
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
                    <td style={{ fontSize: '0.8125rem' }}>
                      {doc.status === 'COMPLETED' ? (
                        <span style={{ color: 'var(--text-secondary)' }}>
                          <strong style={{ color: 'var(--text-primary)' }}>{doc.pagesCount}</strong> pp · {doc.chunksCount} chk
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      {doc.status === 'COMPLETED' && (
                        <span className="status-pill status-verified">✓ Indexed</span>
                      )}
                      {doc.status === 'PROCESSING' && (
                        <span className="status-pill status-partial">⏳ Processing</span>
                      )}
                      {doc.status === 'FAILED' && (
                        <span
                          className="status-pill status-refuted"
                          title={doc.processingError || 'Text extraction failed'}
                        >
                          ✕ Failed
                        </span>
                      )}
                      {doc.status === 'PENDING' && (
                        <span className="status-pill status-unverified">Pending</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {formatDate(doc.createdAt)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => onViewDocument(doc)}
                          title="View contract text"
                        >
                          <EyeIcon size={13} />
                          <span>View</span>
                        </button>

                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={doc.status !== 'COMPLETED'}
                          onClick={() => onStartResearch([doc.id])}
                          title="Start AI Research"
                        >
                          <SearchIcon size={13} />
                          <span>Research</span>
                        </button>

                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setDocToDelete(doc)}
                          title="Delete contract"
                          aria-label={`Delete ${doc.originalFilename}`}
                          style={{ padding: '0 8px', height: '32px' }}
                        >
                          <Trash2Icon size={14} />
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

      {/* 4. Delete Confirmation Dialog */}
      {docToDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setDocToDelete(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <div className="flex items-center gap-2" style={{ color: 'var(--status-refuted-text)' }}>
                <AlertTriangleIcon size={18} />
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Delete Contract
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDocToDelete(null)}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
                Are you sure you want to permanently delete <strong>{docToDelete.originalFilename}</strong>?
                All extracted pages, chunks, and cached citations will be permanently removed.
              </p>
              {deleteError && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--status-refuted-bg)',
                  border: '1px solid var(--status-refuted-border)',
                  color: 'var(--status-refuted-text)',
                  fontSize: '0.8125rem',
                }}>
                  {deleteError}
                </div>
              )}
            </div>
            <div className="p-3.5 border-t flex justify-end gap-2.5" style={{ backgroundColor: 'var(--surface-secondary)' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDocToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Contract'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Upload Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadSuccess={() => {
          onRefresh();
          setIsUploadOpen(false);
        }}
      />
    </div>
  );
}
