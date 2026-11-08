/**
 * After a load: compares what the plan promised with what the database
 * holds for this plan's jobs (their externalRefs). Counts and euro totals
 * only — no personal data — so the report can be shared and kept. Valid
 * right after a load: later edits in OficinaOS (status, prices) show up as
 * differences, by design.
 */
import type { JobStatus, PrismaClient } from "@generated/client";
import { AuditAction } from "@generated/client";
import { normalizePhone } from "@shared/utils/phone";
import { HISTORY_REPAIR_NAME } from "./load";
import type { MigrationPlan } from "./types";

export interface VerificationRow {
  actual: number;
  expected: number;
  metric: string;
  ok: boolean;
}

const CENT = 0.005;

function row(metric: string, expected: number, actual: number) {
  return { actual, expected, metric, ok: Math.abs(expected - actual) < CENT };
}

export async function verifyMigration(
  prisma: PrismaClient,
  plan: MigrationPlan
): Promise<VerificationRow[]> {
  const migrated = {
    externalRef: { in: plan.jobs.map((j) => j.externalRef) },
  };
  const [jobs, byStatus, repairs, deposits, delivered, customers] =
    await Promise.all([
      prisma.job.count({ where: migrated }),
      prisma.job.groupBy({
        by: ["status"],
        where: migrated,
        _count: { _all: true },
      }),
      prisma.jobRepair.aggregate({
        where: { job: migrated, repairName: HISTORY_REPAIR_NAME },
        _count: { _all: true },
        _sum: { price: true },
      }),
      prisma.job.aggregate({
        where: migrated,
        _sum: { depositAmount: true },
      }),
      prisma.auditLog.count({
        where: {
          action: AuditAction.STATUS_CHANGED,
          job: migrated,
          toValue: "DELIVERED",
        },
      }),
      prisma.customer.findMany({ select: { phone: true } }),
    ]);

  const phones = new Set(customers.map((c) => normalizePhone(c.phone)));
  const present = plan.customers.filter((c) =>
    phones.has(normalizePhone(c.phone))
  ).length;
  const statusCounts = new Map<string, number>(
    byStatus.map((s: { status: JobStatus; _count: { _all: number } }) => [
      s.status,
      s._count._all,
    ])
  );

  return [
    row("clientes presentes", plan.customers.length, present),
    row("reparações migradas", plan.stats.jobs, jobs),
    ...Object.entries(plan.stats.jobsByStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) =>
        row(`estado ${status}`, count, statusCounts.get(status) ?? 0)
      ),
    row("reparações com preço", plan.stats.jobsWithPrice, repairs._count._all),
    row(
      "total de preços (€)",
      plan.stats.priceTotal,
      repairs._sum.price?.toNumber() ?? 0
    ),
    row(
      "total de sinais (€)",
      plan.stats.depositTotal,
      deposits._sum.depositAmount?.toNumber() ?? 0
    ),
    row("entregas com data", plan.stats.deliveredWithDate, delivered),
  ];
}
