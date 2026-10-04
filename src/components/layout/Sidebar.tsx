'use client';

import React from 'react';
import {
  LayoutDashboardIcon,
  FileTextIcon,
  SearchIcon,
  ScaleIcon,
  ShieldCheckIcon,
  XIcon,
} from '@/components/ui/Icons';

export type ActiveTab = 'dashboard' | 'documents' | 'research' | 'compare';

interface SidebarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  documentCount?: number;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({
  activeTab,
  onTabChange,
  documentCount = 0,
  isOpenMobile = false,
  onCloseMobile,
}: SidebarProps) {
  const navItems = [
    {
      id: 'dashboard' as ActiveTab,
      label: 'Overview',
      icon: LayoutDashboardIcon,
      badge: null,
    },
    {
      id: 'documents' as ActiveTab,
      label: 'Documents',
      icon: FileTextIcon,
      badge: documentCount > 0 ? documentCount : null,
    },
    {
      id: 'research' as ActiveTab,
      label: 'AI Research',
      icon: SearchIcon,
      badge: null,
    },
    {
      id: 'compare' as ActiveTab,
      label: 'Compare',
      icon: ScaleIcon,
      badge: null,
    },
  ];

  return (
    <>
      {/* Mobile backdrop overlay */}
      {isOpenMobile && (
        <div
          className="modal-backdrop mobile-only"
          style={{ zIndex: 45 }}
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`sidebar-container ${isOpenMobile ? 'mobile-open' : ''}`}
        aria-label="Application Sidebar"
      >
        {/* Brand Header */}
        <div className="sidebar-header">
          <div className="flex items-center gap-2.5">
            <div className="sidebar-brand-icon">
              §
            </div>
            <div>
              <div className="sidebar-brand-title">
                Lexicon AI
              </div>
              <div className="sidebar-brand-subtitle">
                Contract Intelligence
              </div>
            </div>
          </div>

          {/* Close button on mobile */}
          {onCloseMobile && (
            <button
              type="button"
              className="btn btn-ghost btn-sm mobile-only"
              onClick={onCloseMobile}
              aria-label="Close menu"
              style={{ padding: '6px', height: '32px', width: '32px' }}
            >
              <XIcon size={18} />
            </button>
          )}
        </div>

        {/* Navigation Group */}
        <div className="sidebar-nav">
          <div className="sidebar-section-label">Workspace</div>

          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    onTabChange(item.id);
                    if (onCloseMobile) onCloseMobile();
                  }}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon
                    size={18}
                    style={{
                      color: isActive ? 'var(--primary-blue)' : 'var(--text-secondary)',
                      flexShrink: 0,
                    }}
                  />
                  <span>
                    {item.label}
                  </span>
                  {item.badge !== null && (
                    <span className="sidebar-badge">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-verification-card">
            <ShieldCheckIcon size={16} style={{ color: 'var(--primary-blue)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                Grounded Citations
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                Zero-hallucination quotes
              </div>
            </div>
          </div>

          {/* Engine Health */}
          <div className="flex items-center justify-between px-1" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span className="flex items-center gap-1.5">
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#10B981',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Gemini 3.5 Flash</span>
            </span>
            <span style={{ fontWeight: 500 }}>v1.0</span>
          </div>
        </div>
      </aside>
    </>
  );
}
