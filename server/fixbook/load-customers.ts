/**
 * Customers of a MigrationPlan → OficinaOS. A planned customer whose phone
 * identifies an existing row (same digits, +351 or not) reuses it: empty
 * fields are filled, and legacy notes are appended below the staff's own —
 * nothing already there is overwritten.
 */
import type { Prisma, PrismaClient } from "@generated/client";
import { phoneMatchKey } from "./phone-key";
import { safeFailure } from "./safe-error";
import type { PlannedCustomer } from "./types";

/** Separates staff notes from the notes brought over from FixBook. */
export const NOTES_SEPARATOR = "\n— FixBook —\n";

export interface CustomerLoadResult {
  customersCreated: number;
  customersFilled: number;
  customersNotesAppended: number;
  customersReused: number;
}

type FillField = "address" | "city" | "email" | "taxId";
const FILLABLE: FillField[] = ["address", "city", "email", "taxId"];

interface ExistingCustomer {
  address: string | null;
  city: string | null;
  email: string | null;
  id: string;
  notes: string | null;
  phone: string;
  taxId: string | null;
}

/** Placeholder or invalid phones only ever match the exact same text. */
function matchKey(phone: string): string {
  return phoneMatchKey(phone) ?? `exact:${phone}`;
}

function reuseData(
  existing: ExistingCustomer,
  planned: PlannedCustomer
): { appended: boolean; data: Prisma.CustomerUpdateInput } {
  const data: Prisma.CustomerUpdateInput = {};
  for (const field of FILLABLE) {
    if (!existing[field] && planned[field]) {
      data[field] = planned[field];
    }
  }
  let appended = false;
  if (planned.notes && !existing.notes?.includes(planned.notes)) {
    data.notes = existing.notes
      ? `${existing.notes}${NOTES_SEPARATOR}${planned.notes}`
      : planned.notes;
    appended = Boolean(existing.notes);
  }
  return { appended, data };
}

async function createCustomer(
  prisma: PrismaClient,
  planned: PlannedCustomer
): Promise<ExistingCustomer> {
  return await prisma.customer.create({
    data: {
      address: planned.address,
      city: planned.city,
      email: planned.email,
      name: planned.name,
      notes: planned.notes,
      phone: planned.phone,
      taxId: planned.taxId,
      ...(planned.createdAt ? { createdAt: planned.createdAt } : {}),
    },
    select: CUSTOMER_SELECT,
  });
}

const CUSTOMER_SELECT = {
  address: true,
  city: true,
  email: true,
  id: true,
  notes: true,
  phone: true,
  taxId: true,
} as const;

export async function loadCustomers(
  prisma: PrismaClient,
  customers: PlannedCustomer[],
  result: CustomerLoadResult
): Promise<Map<string, string>> {
  const existing = await prisma.customer.findMany({ select: CUSTOMER_SELECT });
  const byKey = new Map(existing.map((c) => [matchKey(c.phone), c]));
  const ids = new Map<string, string>();

  for (const [index, planned] of customers.entries()) {
    const key = matchKey(planned.phone);
    try {
      const match = byKey.get(key);
      if (match) {
        result.customersReused += 1;
        const { appended, data } = reuseData(match, planned);
        if (Object.keys(data).length > 0) {
          const updated = await prisma.customer.update({
            data,
            select: CUSTOMER_SELECT,
            where: { id: match.id },
          });
          byKey.set(key, updated);
          result.customersFilled += 1;
          result.customersNotesAppended += appended ? 1 : 0;
        }
        ids.set(planned.key, match.id);
        continue;
      }
      const created = await createCustomer(prisma, planned);
      byKey.set(key, created);
      result.customersCreated += 1;
      ids.set(planned.key, created.id);
    } catch (error) {
      throw safeFailure(`Falha no cliente n.º ${index + 1} do plano`, error);
    }
  }
  return ids;
}
