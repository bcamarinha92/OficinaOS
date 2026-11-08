import type { JobStatusType } from "@shared/constants/job-statuses";

export interface PlannedCustomer {
  address: string | null;
  city: string | null;
  createdAt: Date | null;
  email: string | null;
  key: string;
  legacyIds: number[];
  name: string;
  notes: string | null;
  phone: string;
  taxId: string | null;
}

export interface PlannedJob {
  brand: string;
  category: string;
  conditionNotes: string | null;
  createdAt: Date | null;
  customerKey: string;
  deliveredAt: Date | null;
  depositAmount: number | null;
  externalRef: string;
  holdReason: string | null;
  jobCode: string;
  legacyStatusLabel: string;
  model: string;
  note: string | null;
  price: number | null;
  reportedProblem: string;
  status: JobStatusType;
}

export interface PlanStats {
  customers: number;
  deliveredWithDate: number;
  depositTotal: number;
  invalidEmails: number;
  invalidPhones: number;
  jobs: number;
  jobsByStatus: Record<string, number>;
  jobsWithPrice: number;
  largestGroup: number;
  legacyCustomers: number;
  legacyStatuses: Record<string, number>;
  mergedGroups: number;
  mergedLegacyCustomers: number;
  missingProblem: number;
  orphanCustomersCreated: number;
  orphanJobs: number;
  priceTotal: number;
  renamedCodes: number;
  /** Customers who share a phone with someone else and lost it. */
  sharedPhoneSplits: number;
}

export interface MigrationPlan {
  customers: PlannedCustomer[];
  jobs: PlannedJob[];
  stats: PlanStats;
}

export function emptyStats(): PlanStats {
  return {
    customers: 0,
    deliveredWithDate: 0,
    depositTotal: 0,
    invalidEmails: 0,
    invalidPhones: 0,
    jobs: 0,
    jobsByStatus: {},
    jobsWithPrice: 0,
    largestGroup: 0,
    legacyCustomers: 0,
    legacyStatuses: {},
    mergedGroups: 0,
    mergedLegacyCustomers: 0,
    missingProblem: 0,
    orphanCustomersCreated: 0,
    orphanJobs: 0,
    priceTotal: 0,
    renamedCodes: 0,
    sharedPhoneSplits: 0,
  };
}
