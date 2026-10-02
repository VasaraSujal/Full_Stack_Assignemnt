import { CitationVerificationStatus, ChangeCategory, SignificanceCategory } from '@prisma/client';
import { CitationLocationMetadata } from './citation-verifier';

export type ComparisonSignificance = 'HIGH' | 'MEDIUM' | 'LOW';

export type ComparisonCategory =
  | 'PAYMENT'
  | 'TERM'
  | 'TERMINATION'
  | 'LIABILITY'
  | 'INDEMNIFICATION'
  | 'CONFIDENTIALITY'
  | 'INTELLECTUAL_PROPERTY'
  | 'OBLIGATIONS'
  | 'WARRANTIES'
  | 'GOVERNING_LAW'
  | 'DISPUTE_RESOLUTION'
  | 'DATA_PROTECTION'
  | 'NOTICE'
  | 'OTHER';

export interface DocumentQuoteCandidate {
  documentId: string;
  quote: string;
  pageNumber?: number;
}

export interface GeminiComparisonChangeCandidate {
  category: string;
  description: string;
  significance: string;
  documentA: DocumentQuoteCandidate;
  documentB: DocumentQuoteCandidate;
  confidence?: number;
}

export interface GeminiComparisonStructuredResponse {
  summary: string;
  changes: GeminiComparisonChangeCandidate[];
  limitations?: string[];
  hasSufficientEvidence?: boolean;
}

export interface VerifiedDocumentQuoteEvidence {
  documentId: string;
  documentName?: string;
  quote: string;
  pageNumber: number | null;
  verificationStatus: CitationVerificationStatus;
  locationMetadata: CitationLocationMetadata | null;
}

export interface VerifiedComparisonChange {
  id?: string;
  category: ComparisonCategory;
  changeCategoryEnum: ChangeCategory;
  description: string;
  significance: ComparisonSignificance;
  significanceEnum: SignificanceCategory;
  verificationStatus: CitationVerificationStatus;
  documentA: VerifiedDocumentQuoteEvidence;
  documentB: VerifiedDocumentQuoteEvidence;
  confidence: number;
}

export interface ComparisonVerificationSummary {
  totalChanges: number;
  verifiedCount: number;
  partialCount: number;
  unverifiedCount: number;
  refutedCount: number;
  allVerified: boolean;
}

export interface ContractComparisonResult {
  summary: string;
  documentA: {
    id: string;
    originalFilename: string;
  };
  documentB: {
    id: string;
    originalFilename: string;
  };
  changes: VerifiedComparisonChange[];
  verificationSummary: ComparisonVerificationSummary;
  limitations: string[];
  hasSufficientEvidence: boolean;
  model: string;
}
