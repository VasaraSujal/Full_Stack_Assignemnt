'use client';

import React from 'react';
import { ActiveTab } from './Sidebar';
import { MenuIcon, PlusIcon, ShieldCheckIcon } from '@/components/ui/Icons';

interface HeaderProps {
  activeTab: ActiveTab;
  isViewingDoc: boolean;
  onOpenMobileMenu: () => void;
  onOpenUpload: () => void;
  onNavigateTab: (tab: ActiveTab) => void;
}

export function Header({
  activeTab,
  isViewingDoc,
  onOpenMobileMenu,
  onOpenUpload,
}: HeaderProps) {
  const getHeaderInfo = () => {
    if (isViewingDoc) {
      return {
        title: 'Document Viewer',
        badge: 'Authoritative Text',
      };
    }
    switch (activeTab) {
      case 'dashboard':
        return {
          title: 'Overview',
          badge: 'Workspace',
        };
      case 'documents':
        return {
          title: 'Document Repository',
          badge: 'Indexed Files',
        };
      case 'research':
        return {
          title: 'AI Legal Research',
          badge: 'Multi-Contract Grounding',
        };
      case 'compare':
        return {
          title: 'Contract Comparison',
          badge: 'Clause Diff Engine',
        };
      default:
        return {
          title: 'Lexicon AI',
          badge: 'Contract Studio',
        };
    }
  };

  const { title, badge } = getHeaderInfo();

  return (
    <header className="dashboard-header">
      <div className="header-title-group">
        {/* Mobile Menu Toggle Button */}
        <button
          type="button"
          className="btn btn-secondary btn-sm mobile-only"
          onClick={onOpenMobileMenu}
          aria-label="Open sidebar navigation"
          style={{ padding: '6px 10px', height: '34px' }}
        >
          <MenuIcon size={18} />
        </button>

        <div className="flex items-center gap-2.5 min-w-0">
          <h1 className="header-title">
            {title}
          </h1>
          <span className="header-badge desktop-only">
            {badge}
          </span>
        </div>
      </div>

      {/* Right Actions & Live Status Bar */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="header-status-pill desktop-only">
          <span className="flex items-center gap-1.5">
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: '#10B981',
                display: 'inline-block',
              }}
            />
            <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Gemini 3.5 Flash</strong>
          </span>
          <span style={{ color: 'var(--border-strong)', margin: '0 2px' }}>·</span>
          <span className="flex items-center gap-1" style={{ color: 'var(--status-verified-text)', fontWeight: 500 }}>
            <ShieldCheckIcon size={14} style={{ color: 'var(--primary-blue)' }} />
            <span>Verified Grounding</span>
          </span>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onOpenUpload}
        >
          <PlusIcon size={15} />
          <span className="desktop-only">Upload Contract</span>
          <span className="mobile-only">Upload</span>
        </button>
      </div>
    </header>
  );
}
