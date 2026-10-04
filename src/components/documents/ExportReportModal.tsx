'use client';

import React, { useState } from 'react';
import { exportContractReport, ExportReportOptions } from '@/lib/api-client';
import {
  FileTextIcon,
  XIcon,
  DownloadIcon,
  AlertTriangleIcon,
  ShieldCheckIcon,
} from '@/components/ui/Icons';

interface ExportReportModalProps {
  documentId: string;
  documentTitle: string;
  isCompleted?: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export function ExportReportModal({
  documentId,
  documentTitle,
  isCompleted = true,
  isOpen,
  onClose,
}: ExportReportModalProps) {
  const [selectedSections, setSelectedSections] = useState<
    Array<'summary' | 'risks' | 'obligations' | 'citations'>
  >(['summary', 'risks', 'obligations', 'citations']);
  const [selectedLanguage, setSelectedLanguage] = useState<'source' | 'en'>('source');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successFilename, setSuccessFilename] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleSection = (section: 'summary' | 'risks' | 'obligations' | 'citations') => {
    setSelectedSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]
    );
    setErrorMessage(null);
  };

  const handleGenerate = async () => {
    if (selectedSections.length === 0) {
      setErrorMessage('Please select at least one report section to include in the PDF export.');
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setSuccessFilename(null);

    try {
      const options: ExportReportOptions = {
        sections: selectedSections,
        language: selectedLanguage,
      };

      const { blob, filename } = await exportContractReport(documentId, options);

      // Trigger native browser file download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSuccessFilename(filename);
      // Auto-close modal after brief feedback
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate contract report.';
      setErrorMessage(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isGenerating) onClose();
      }}
    >
      <div
        className="card modal-dialog"
        style={{
          width: '100%',
          maxWidth: '540px',
          maxHeight: '92vh',
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid var(--border-default, #E2E8F0)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-default, #E2E8F0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--surface-secondary, #F8FAFC)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#EFF6FF',
                color: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileTextIcon size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>
                Generate Contract Review Report
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748B)', marginTop: '1px' }}>
                Downloadable PDF with authoritative citation verification
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isGenerating}
            style={{ width: '32px', height: '32px', padding: 0 }}
            aria-label="Close modal"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Target Document Identity */}
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: '#F8FAFC',
              borderRadius: '8px',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                Selected Document
              </div>
              <div
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#0F172A',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: '1px',
                }}
                title={documentTitle}
              >
                {documentTitle}
              </div>
            </div>
            <span
              className="status-pill status-verified"
              style={{ fontSize: '0.75rem', padding: '2px 8px', flexShrink: 0 }}
            >
              {isCompleted ? '✓ Indexed' : 'Processing'}
            </span>
          </div>

          {/* Section Selector Checkboxes */}
          <div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>
              Report Sections to Include
            </div>
            <div className="export-sections-grid">
              {[
                {
                  id: 'summary' as const,
                  label: 'Document Summary',
                  desc: 'Executive purpose, parties & key scope',
                },
                {
                  id: 'risks' as const,
                  label: 'Identified Risks',
                  desc: 'Risk severity, exposure & clause links',
                },
                {
                  id: 'obligations' as const,
                  label: 'Obligations',
                  desc: 'Contractual requirements & timelines',
                },
                {
                  id: 'citations' as const,
                  label: 'Verified Citations',
                  desc: 'Exact verbatim source quotations',
                },
              ].map((sec) => {
                const isSelected = selectedSections.includes(sec.id);
                return (
                  <label
                    key={sec.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: `1px solid ${isSelected ? '#93C5FD' : '#E2E8F0'}`,
                      backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                      cursor: isGenerating ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isGenerating}
                      onChange={() => toggleSection(sec.id)}
                      style={{ marginTop: '3px', cursor: 'pointer' }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F172A' }}>
                        {sec.label}
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: '#64748B', marginTop: '2px', lineHeight: 1.3 }}>
                        {sec.desc}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Language Selector */}
          <div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F172A', marginBottom: '6px' }}>
              Report Language Format
            </div>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as 'source' | 'en')}
              disabled={isGenerating}
              className="input"
              style={{
                width: '100%',
                fontSize: '0.8125rem',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                backgroundColor: '#FFFFFF',
              }}
            >
              <option value="source">Source Language (Default — Preserves Arabic RTL / English)</option>
              <option value="en">English (Standard Global Reference)</option>
            </select>
            <p style={{ fontSize: '0.6875rem', color: '#64748B', marginTop: '4px' }}>
              *Arabic contracts automatically preserve right-to-left layout and classical Naskh typography.
            </p>
          </div>

          {/* Mandatory Human Review Disclaimer Reminder */}
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: '#FFFBEB',
              borderRadius: '8px',
              border: '1px solid #FDE68A',
              fontSize: '0.75rem',
              color: '#92400E',
              lineHeight: 1.4,
            }}
          >
            <strong>Note:</strong> AI-generated legal interpretations require human review. All citations are
            verified against verbatim contract offsets.
          </div>

          {/* Status / Error Notifications */}
          {errorMessage && (
            <div
              className="flex items-center gap-2 p-3 rounded-md"
              style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: '0.8125rem' }}
            >
              <AlertTriangleIcon size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {successFilename && (
            <div
              className="flex items-center gap-2 p-3 rounded-md"
              style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534', fontSize: '0.8125rem' }}
            >
              <ShieldCheckIcon size={16} />
              <span>Report downloaded successfully: <strong>{successFilename}</strong></span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-default, #E2E8F0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            flexWrap: 'wrap',
            backgroundColor: 'var(--surface-secondary, #F8FAFC)',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            disabled={isGenerating}
            style={{ height: '36px' }}
          >
            Cancel
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm flex items-center gap-2"
            onClick={handleGenerate}
            disabled={isGenerating || selectedSections.length === 0}
            style={{ height: '36px', minWidth: '170px', justifyContent: 'center' }}
          >
            {isGenerating ? (
              <>
                <span className="spinner" style={{ width: '14px', height: '14px' }} />
                <span>Preparing report…</span>
              </>
            ) : (
              <>
                <DownloadIcon size={15} />
                <span>Generate PDF Report</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
