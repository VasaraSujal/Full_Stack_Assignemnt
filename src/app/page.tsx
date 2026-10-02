'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar, ActiveTab } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { DashboardOverview } from '@/components/dashboard/DashboardOverview';
import { DocumentLibrary } from '@/components/documents/DocumentLibrary';
import { DocumentViewer } from '@/components/viewer/DocumentViewer';
import { ResearchWorkspace } from '@/components/research/ResearchWorkspace';
import { ComparisonWorkspace } from '@/components/compare/ComparisonWorkspace';
import { UploadModal } from '@/components/documents/UploadModal';
import {
  DocumentItem,
  ConversationItem,
  CitationItem,
  fetchDocuments,
  fetchConversations,
} from '@/lib/api-client';

export default function AppMainPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(true);

  // Selected document for Document Viewer
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<CitationItem | null>(null);

  // Cross-tab selection states
  const [researchDocIds, setResearchDocIds] = useState<string[]>([]);
  const [compareDocIds, setCompareDocIds] = useState<string[]>([]);

  // Modals & Mobile sidebar state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Load initial data
  useEffect(() => {
    let isMounted = true;

    async function initData() {
      setIsLoadingDocs(true);
      try {
        const [docs, convs] = await Promise.all([
          fetchDocuments().catch(() => []),
          fetchConversations().catch(() => []),
        ]);
        if (isMounted) {
          setDocuments(docs);
          setConversations(convs);
        }
      } catch (err) {
        console.error('Error initializing workspace data:', err);
      } finally {
        if (isMounted) {
          setIsLoadingDocs(false);
        }
      }
    }

    initData();

    return () => {
      isMounted = false;
    };
  }, []);

  const refreshDocuments = async () => {
    setIsLoadingDocs(true);
    try {
      const docs = await fetchDocuments();
      setDocuments(docs);
    } catch (err) {
      console.error('Error refreshing documents:', err);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const handleViewDocument = (doc: DocumentItem) => {
    setViewingDocId(doc.id);
    setActiveCitation(null);
  };

  const handleInspectCitation = (citation: CitationItem) => {
    setActiveCitation(citation);
    setViewingDocId(citation.documentId);
  };

  const handleStartResearch = (docIds: string[]) => {
    setResearchDocIds(docIds);
    setActiveTab('research');
    setViewingDocId(null);
  };

  const handleStartCompare = (docIds: string[]) => {
    setCompareDocIds(docIds);
    setActiveTab('compare');
    setViewingDocId(null);
  };

  return (
    <div className="dashboard-shell">
      {/* Persistent Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setViewingDocId(null);
        }}
        documentCount={documents.length}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content Pane */}
      <div className="dashboard-main">
        {/* Top Header */}
        <Header
          activeTab={activeTab}
          isViewingDoc={Boolean(viewingDocId)}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onOpenUpload={() => setIsUploadOpen(true)}
          onNavigateTab={(tab) => {
            setActiveTab(tab);
            setViewingDocId(null);
          }}
        />

        {/* Dynamic Workspace Body */}
        <main className="dashboard-body">
          {viewingDocId ? (
            <DocumentViewer
              documentId={viewingDocId}
              activeCitation={activeCitation}
              onClose={() => setViewingDocId(null)}
            />
          ) : (
            <>
              {/* Tab 1: Dashboard Overview */}
              {activeTab === 'dashboard' && (
                <DashboardOverview
                  documents={documents}
                  conversations={conversations}
                  isLoading={isLoadingDocs}
                  onOpenUpload={() => setIsUploadOpen(true)}
                  onNavigateTab={(tab) => {
                    setActiveTab(tab);
                    setViewingDocId(null);
                  }}
                  onViewDocument={handleViewDocument}
                  onStartResearch={handleStartResearch}
                />
              )}

              {/* Tab 2: Document Repository */}
              {activeTab === 'documents' && (
                <DocumentLibrary
                  documents={documents}
                  isLoading={isLoadingDocs}
                  onRefresh={refreshDocuments}
                  onViewDocument={handleViewDocument}
                  onStartResearch={handleStartResearch}
                  onStartCompare={handleStartCompare}
                />
              )}

              {/* Tab 3: Legal Research Workspace */}
              {activeTab === 'research' && (
                <ResearchWorkspace
                  initialDocumentIds={researchDocIds}
                  documents={documents}
                  onInspectCitation={handleInspectCitation}
                />
              )}

              {/* Tab 4: Contract Comparison */}
              {activeTab === 'compare' && (
                <ComparisonWorkspace
                  initialDocumentIds={compareDocIds}
                  documents={documents}
                  onInspectCitation={handleInspectCitation}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Global Upload Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadSuccess={(newDoc) => {
          refreshDocuments();
          handleViewDocument(newDoc);
        }}
      />
    </div>
  );
}
