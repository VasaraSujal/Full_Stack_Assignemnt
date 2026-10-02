'use client';

import React, { useState, useRef } from 'react';
import { uploadDocument, DocumentItem } from '@/lib/api-client';
import { UploadCloudIcon, XIcon, AlertTriangleIcon } from '@/components/ui/Icons';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (doc: DocumentItem) => void;
}

export function UploadModal({ isOpen, onClose, onUploadSuccess }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const validateClientFile = (selectedFile: File): string | null => {
    const validExtensions = ['.pdf', '.docx'];
    const lowerName = selectedFile.name.toLowerCase();
    const hasValidExt = validExtensions.some((ext) => lowerName.endsWith(ext));
    if (!hasValidExt) {
      return 'Only PDF (.pdf) and Word (.docx) documents are supported.';
    }

    const maxSizeBytes = 20 * 1024 * 1024; // 20 MB
    if (selectedFile.size > maxSizeBytes) {
      return `File size (${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB) exceeds 20 MB limit.`;
    }

    if (selectedFile.size === 0) {
      return 'The selected file is empty.';
    }

    return null;
  };

  const handleFileChange = (selected: File | null) => {
    setErrorMessage(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const err = validateClientFile(selected);
    if (err) {
      setErrorMessage(err);
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleUploadSubmit = async () => {
    if (!file) return;
    setIsUploading(true);
    setErrorMessage(null);

    try {
      const createdDoc = await uploadDocument(file);
      onUploadSuccess(createdDoc);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setErrorMessage(msg);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="card-header" style={{ padding: '16px 20px' }}>
          <div>
            <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Upload Contract Agreement
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              PDF or DOCX format (up to 20 MB, up to 150+ pages)
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isUploading}
            aria-label="Close"
            style={{ padding: '6px', height: '32px', width: '32px' }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex flex-col gap-4">
          {errorMessage && (
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
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? 'var(--primary-blue)' : 'var(--border-strong)'}`,
              backgroundColor: isDragging ? 'var(--primary-blue-subtle)' : 'var(--surface-secondary)',
              borderRadius: 'var(--radius-lg)',
              padding: '32px 20px',
              textAlign: 'center',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: 'none' }}
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              disabled={isUploading}
            />

            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--surface-primary)',
                border: '1px solid var(--border-default)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px auto',
                color: 'var(--primary-blue)',
                boxShadow: 'var(--shadow-xs)',
              }}
            >
              <UploadCloudIcon size={24} />
            </div>

            {file ? (
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9375rem', marginBottom: '4px' }}>
                  {file.name}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {(file.size / (1024 * 1024)).toFixed(2)} MB · Ready to process
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9375rem', marginBottom: '4px' }}>
                  Drag & drop contract here, or <span style={{ color: 'var(--primary-blue)', textDecoration: 'underline' }}>browse file</span>
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  Supports NDAs, MSAs, addenda, and commercial agreements
                </div>
              </div>
            )}
          </div>

          {/* Processing state indicator */}
          {isUploading && (
            <div
              className="flex items-center gap-3 p-3.5 rounded-lg"
              style={{
                backgroundColor: 'var(--primary-blue-subtle)',
                border: '1px solid var(--primary-blue-border)',
              }}
            >
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  border: '2px solid var(--primary-blue-border)',
                  borderTopColor: 'var(--primary-blue)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: '0.8125rem', color: 'var(--primary-blue)' }}>
                <strong>Ingesting contract:</strong> Extracting text, validating magic bytes, and indexing deterministic text chunks...
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t flex items-center justify-end gap-2.5" style={{ backgroundColor: 'var(--surface-secondary)' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            disabled={isUploading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleUploadSubmit}
            disabled={!file || isUploading}
          >
            {isUploading ? 'Processing...' : 'Upload & Process'}
          </button>
        </div>
      </div>
    </div>
  );
}
