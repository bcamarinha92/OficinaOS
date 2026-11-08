/**
 * Writes a MigrationPlan into the OficinaOS database.
 *
 * Idempotent: a job whose externalRef (FB-<id>) is already present is
 * skipped, and an existing customer with the same phone is reused (see
 * load-customers.ts). Each job is written in one transaction, so a crash
 * never leaves half a job; re-running finishes the rest. Nothing here sends
 * notifications or touches the legacy MySQL.
 */
import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@generated/client";
import { AuditAction, RepairCategory } from "@generated/client";
import { Role } from "@shared/constants/roles";
import { type CustomerLoadResult, loadCustomers } from "./load-customers";
import { EXTERNAL_REF_PREFIX } from "./plan";
import { safeFailure } from "./safe-error";
import type { MigrationPlan, PlannedJob } from "./types";

export const IMPORT_USERNAME = "fixbook-import";
export const HISTORY_REPAIR_NAME = "Reparação (histórico)";
export const WORKFLOW_PREFIX = "FixBook: ";

export interface LoadResult extends CustomerLoadResult {
  brandsCreated: number;
  devicesCreated: number;
  jobCodesRenamed: number;
  jobsCreated: number;
  jobsSkipped: number;
}

type Progress = (done: number, total: number) => void;

function required<T>(map: Map<string, T>, key: string, what: string): T {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Migração inconsistente: ${what} em falta.`);
  }
  return value;
}

/** Inactive, password-less author for every migrated note and audit row. */
async function ensureImportUser(prisma: PrismaClient): Promise<string> {
  const user = await prisma.user.upsert({
    where: { username: IMPORT_USERNAME },
    update: {},
    create: {
      email: `${IMPORT_USERNAME}@oficinaos.local`,
      isActive: false,
      name: "FixBook (importação)",
      role: Role.FRONT_DESK,
      username: IMPORT_USERNAME,
    },
    select: { id: true },
  });
  return user.id;
}

async function ensureWorkflowStates(
  prisma: PrismaClient,
  labels: string[]
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const label of new Set(labels)) {
    const name = `${WORKFLOW_PREFIX}${label}`;
    const state = await prisma.workflowState.upsert({
      where: { entityType_name: { entityType: "JOB", name } },
      update: {},
      create: { entityType: "JOB", name },
      select: { id: true },
    });
    ids.set(label, state.id);
  }
  return ids;
}

/** Brand/device lookups by case-insensitive name, created on demand. */
async function deviceResolver(prisma: PrismaClient, result: LoadResult) {
  const brands = new Map(
    (await prisma.brand.findMany()).map((b) => [b.name.toLowerCase(), b.id])
  );
  const devices = new Map(
    (await prisma.device.findMany()).map((d) => [
      `${d.brandId}|${d.model.toLowerCase()}`,
      d.id,
    ])
  );

  return async (job: PlannedJob): Promise<string> => {
    let brandId = brands.get(job.brand.toLowerCase());
    if (!brandId) {
      brandId = (await prisma.brand.create({ data: { name: job.brand } })).id;
      brands.set(job.brand.toLowerCase(), brandId);
      result.brandsCreated += 1;
    }
    const key = `${brandId}|${job.model.toLowerCase()}`;
    let deviceId = devices.get(key);
    if (!deviceId) {
      deviceId = (
        await prisma.device.create({
          data: { brandId, category: job.category, model: job.model },
        })
      ).id;
      devices.set(key, deviceId);
      result.devicesCreated += 1;
    }
    return deviceId;
  };
}

interface JobContext {
  customerId: string;
  deviceId: string;
  jobCode: string;
  stateId: string;
  userId: string;
}

function auditRows(
  jobId: string,
  job: PlannedJob,
  ctx: JobContext,
  createdAt: Date
): Prisma.AuditLogCreateManyInput[] {
  const rows: Prisma.AuditLogCreateManyInput[] = [
    {
      action: AuditAction.JOB_CREATED,
      createdAt,
      jobId,
      toValue: ctx.jobCode,
      userId: ctx.userId,
    },
  ];
  if (job.deliveredAt) {
    rows.push({
      action: AuditAction.STATUS_CHANGED,
      createdAt: job.deliveredAt,
      jobId,
      toValue: "DELIVERED",
      userId: ctx.userId,
    });
  }
  return rows;
}

async function createJob(
  prisma: PrismaClient,
  job: PlannedJob,
  ctx: JobContext
): Promise<void> {
  const createdAt = job.createdAt ?? new Date();
  const author = { createdAt, createdById: ctx.userId };
  await prisma.$transaction(async (tx) => {
    const created = await tx.job.create({
      data: {
        accessCode: crypto.randomBytes(8).toString("hex"),
        conditionNotes: job.conditionNotes,
        createdAt,
        createdById: ctx.userId,
        customerId: ctx.customerId,
        depositAmount: job.depositAmount,
        deviceId: ctx.deviceId,
        externalRef: job.externalRef,
        holdReason: job.holdReason,
        jobCode: ctx.jobCode,
        reportedProblem: job.reportedProblem,
        status: job.status,
        updatedAt: job.deliveredAt ?? createdAt,
        notes: job.note
          ? { create: [{ ...author, content: job.note }] }
          : undefined,
        repairs: job.price
          ? {
              create: [
                {
                  ...author,
                  category: RepairCategory.OTHER,
                  price: job.price,
                  repairName: HISTORY_REPAIR_NAME,
                },
              ],
            }
          : undefined,
      },
      select: { id: true },
    });
    await tx.auditLog.createMany({
      data: auditRows(created.id, job, ctx, createdAt),
    });
    await tx.recordWorkflow.create({
      data: { entityId: created.id, entityType: "JOB", stateId: ctx.stateId },
    });
  });
}

/** Legacy code, or a suffixed one when OficinaOS already uses it. */
function freeCode(code: string, taken: Set<string>): string {
  let candidate = code;
  for (let n = 1; taken.has(candidate); n++) {
    candidate = `${code}-FB${n > 1 ? n : ""}`;
  }
  taken.add(candidate);
  return candidate;
}

async function existingJobKeys(prisma: PrismaClient) {
  const jobs = await prisma.job.findMany({
    select: { externalRef: true, jobCode: true },
  });
  const migrated = new Set<string>();
  for (const { externalRef } of jobs) {
    if (externalRef?.startsWith(EXTERNAL_REF_PREFIX)) {
      migrated.add(externalRef);
    }
  }
  return { migrated, takenCodes: new Set(jobs.map((j) => j.jobCode)) };
}

function emptyResult(): LoadResult {
  return {
    brandsCreated: 0,
    customersCreated: 0,
    customersFilled: 0,
    customersNotesAppended: 0,
    customersReused: 0,
    devicesCreated: 0,
    jobCodesRenamed: 0,
    jobsCreated: 0,
    jobsSkipped: 0,
  };
}

export async function loadPlan(
  prisma: PrismaClient,
  plan: MigrationPlan,
  onProgress?: Progress
): Promise<LoadResult> {
  const result = emptyResult();
  const userId = await ensureImportUser(prisma);
  const states = await ensureWorkflowStates(
    prisma,
    plan.jobs.map((j) => j.legacyStatusLabel)
  );
  const customerIds = await loadCustomers(prisma, plan.customers, result);
  const resolveDevice = await deviceResolver(prisma, result);
  const { migrated, takenCodes } = await existingJobKeys(prisma);

  for (const [index, job] of plan.jobs.entries()) {
    onProgress?.(index, plan.jobs.length);
    if (migrated.has(job.externalRef)) {
      result.jobsSkipped += 1;
      continue;
    }
    const jobCode = freeCode(job.jobCode, takenCodes);
    result.jobCodesRenamed += jobCode === job.jobCode ? 0 : 1;
    try {
      await createJob(prisma, job, {
        customerId: required(customerIds, job.customerKey, "cliente"),
        deviceId: await resolveDevice(job),
        jobCode,
        stateId: required(states, job.legacyStatusLabel, "estado"),
        userId,
      });
    } catch (error) {
      throw safeFailure(`Falha na reparação ${job.externalRef}`, error);
    }
    result.jobsCreated += 1;
  }
  onProgress?.(plan.jobs.length, plan.jobs.length);
  return result;
}
