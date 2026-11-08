/**
 * Turns the FixBook tables into a migration plan: customers (see
 * plan-customers.ts) and one job per `oggetti` row with OficinaOS
 * statuses, devices, notes and money. Pure — no database access — so the
 * whole mapping is unit-tested and a dry run can print it.
 */
import { splitBrandModel } from "./brands";
import type { DumpRow } from "./dump-parser";
import {
  decodeCustomFields,
  lisbonToUtc,
  mapCategory,
  mapStatus,
  STATUS_NOT_REPAIRED,
} from "./legacy";
import { orphanCustomerKey, planCustomers } from "./plan-customers";
import { legacyId, nonEmpty, text, toNumber } from "./rows";
import {
  emptyStats,
  type MigrationPlan,
  type PlannedJob,
  type PlanStats,
} from "./types";

/** Prefix of Job.externalRef for migrated rows — the idempotency key. */
export const EXTERNAL_REF_PREFIX = "FB-";
export const MISSING_PROBLEM = "Sem descrição (FixBook)";
const CONDITION_FIELD = "Danos";

function uniqueCode(code: string, used: Set<string>, stats: PlanStats) {
  let candidate = code;
  for (let n = 2; used.has(candidate); n++) {
    candidate = `${code}-${n}`;
  }
  if (candidate !== code) {
    stats.renamedCodes += 1;
  }
  used.add(candidate);
  return candidate;
}

function jobNote(row: DumpRow, extraFields: [string, string][]) {
  const lines = nonEmpty([
    text(row.Commenti),
    text(row.Pezzo) && `Peça: ${text(row.Pezzo)}`,
    text(row.Tipo) === "1" ? "Encomenda (FixBook)" : "",
    text(row.status) === STATUS_NOT_REPAIRED ? "Sem reparação (FixBook)" : "",
    ...extraFields.map(([name, value]) => `${name}: ${value}`),
  ]);
  return lines.length > 0 ? lines.join("\n") : null;
}

function planJob(row: DumpRow, customerKey: string, code: string): PlannedJob {
  const mapped = mapStatus(row.status ?? null);
  const fields = decodeCustomFields(row.custom_field ?? null);
  const { [CONDITION_FIELD]: condition, ...others } = fields;
  const { brand, model } = splitBrandModel(text(row.Modello));
  const price = toNumber(row.Prezzo);
  const deposit = toNumber(row.Anticipo);
  return {
    brand,
    category: mapCategory(row.Categoria ?? null),
    conditionNotes: condition ?? null,
    createdAt: lisbonToUtc(row.dataApertura ?? null),
    customerKey,
    deliveredAt:
      mapped.status === "DELIVERED"
        ? lisbonToUtc(row.dataChiusura ?? null)
        : null,
    depositAmount: deposit > 0 ? deposit : null,
    externalRef: `${EXTERNAL_REF_PREFIX}${legacyId(row.ID, "oggetti")}`,
    holdReason: mapped.holdReason,
    jobCode: code,
    legacyStatusLabel: mapped.label,
    model,
    note: jobNote(row, Object.entries(others)),
    price: price > 0 ? price : null,
    reportedProblem: text(row.Guasto) || MISSING_PROBLEM,
    status: mapped.status,
  };
}

function countJob(job: PlannedJob, stats: PlanStats) {
  stats.jobs += 1;
  stats.jobsByStatus[job.status] = (stats.jobsByStatus[job.status] ?? 0) + 1;
  stats.legacyStatuses[job.legacyStatusLabel] =
    (stats.legacyStatuses[job.legacyStatusLabel] ?? 0) + 1;
  stats.priceTotal += job.price ?? 0;
  stats.depositTotal += job.depositAmount ?? 0;
  stats.jobsWithPrice += job.price ? 1 : 0;
  stats.deliveredWithDate += job.deliveredAt ? 1 : 0;
  stats.missingProblem += job.reportedProblem === MISSING_PROBLEM ? 1 : 0;
}

export function buildMigrationPlan(
  clients: DumpRow[],
  jobs: DumpRow[]
): MigrationPlan {
  const stats = emptyStats();
  stats.legacyCustomers = clients.length;
  const index = planCustomers(clients, stats);

  const usedCodes = new Set<string>();
  const planned: PlannedJob[] = [];
  const ordered = [...jobs].sort((a, b) => toNumber(a.ID) - toNumber(b.ID));
  for (const row of ordered) {
    let key = index.keyByClientId.get(toNumber(row.ID_Nominativo));
    if (!key) {
      stats.orphanJobs += 1;
      key = orphanCustomerKey(row, index, stats);
    }
    const code = uniqueCode(
      text(row.codice) || `FB${legacyId(row.ID, "oggetti")}`,
      usedCodes,
      stats
    );
    const job = planJob(row, key, code);
    countJob(job, stats);
    planned.push(job);
  }

  stats.customers = index.byKey.size;
  return { customers: [...index.byKey.values()], jobs: planned, stats };
}
