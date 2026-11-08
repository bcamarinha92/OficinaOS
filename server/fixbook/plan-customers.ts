/**
 * FixBook customer cards → planned OficinaOS customers.
 *
 * Cards are merged only when they share a phone AND the same name (case,
 * accents and spacing ignored). OficinaOS allows one customer per phone, so
 * when different people share a number the person on the most recent card
 * keeps it; the others get a unique placeholder and the number in their
 * notes. Invalid or filler numbers never merge anything.
 */
import type { DumpRow } from "./dump-parser";
import { lisbonToUtc } from "./legacy";
import { phoneMatchKey } from "./phone-key";
import { lastOf, legacyId, nameKey, nonEmpty, text, toNumber } from "./rows";
import type { PlannedCustomer, PlanStats } from "./types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ORPHAN_NOTE =
  "Criado na migração: a ficha de cliente já não existia no FixBook.";

/** How a customer holds its phone in OficinaOS. */
type PhoneRole = "owner" | "shared" | "invalid";

interface Identity {
  key: string;
  note: string | null;
  phone: string;
}

const fullName = (row: DumpRow) =>
  `${text(row.nome)} ${text(row.cognome)}`.trim();

function identityFor(
  role: PhoneRole,
  raw: string,
  placeholder: string,
  name: string,
  stats: PlanStats
): Identity {
  const phoneKey = phoneMatchKey(raw);
  if (role === "owner" && phoneKey) {
    return { key: phoneKey, note: null, phone: raw };
  }
  if (role === "shared" && phoneKey) {
    stats.sharedPhoneSplits += 1;
    return {
      key: `partilhado:${phoneKey}:${nameKey(name)}`,
      note: `Telefone partilhado com outra ficha: ${raw}`,
      phone: placeholder,
    };
  }
  stats.invalidPhones += 1;
  return {
    key: `sem-telefone:${placeholder}`,
    note: raw ? `Telefone antigo (inválido): ${raw}` : null,
    phone: placeholder,
  };
}

function byDateThenId(a: DumpRow, b: DumpRow) {
  return (
    text(a.data).localeCompare(text(b.data)) || toNumber(a.id) - toNumber(b.id)
  );
}

function mergeCards(
  rows: DumpRow[],
  role: PhoneRole,
  stats: PlanStats
): PlannedCustomer {
  const sorted = [...rows].sort(byDateThenId);
  const latest = sorted.at(-1) as DumpRow;
  const ids = sorted.map((r) => legacyId(r.id, "clienti"));
  const firstId = ids[0] ?? 0;
  const name =
    lastOf(sorted.map(fullName)) ?? `Cliente FixBook ${String(firstId)}`;
  const identity = identityFor(
    role,
    text(latest.telefono),
    `sem-telefone-FB${firstId}`,
    name,
    stats
  );
  const emails = nonEmpty(sorted.map((r) => text(r.email)));
  const invalid = [...new Set(emails.filter((e) => !EMAIL_RE.test(e)))];
  stats.invalidEmails += invalid.length;

  const notes = [
    ...new Set(nonEmpty(sorted.map((r) => text(r.commenti)))),
    ...invalid.map((e) => `Email antigo (inválido): ${e}`),
    ...(identity.note ? [identity.note] : []),
  ];
  if (ids.length > 1) {
    notes.push(
      `Fundido de ${ids.length} fichas do FixBook (n.º ${ids.join(", ")}).`
    );
  }
  return {
    address: lastOf(sorted.map((r) => text(r.indirizzo))),
    city: lastOf(sorted.map((r) => text(r.citta))),
    createdAt: lisbonToUtc(sorted[0]?.data ?? null),
    email: emails.filter((e) => EMAIL_RE.test(e)).at(-1) ?? null,
    key: identity.key,
    legacyIds: ids,
    name,
    notes: notes.length > 0 ? notes.join("\n") : null,
    phone: identity.phone,
    taxId: lastOf(sorted.map((r) => text(r.vat) || text(r.cf))),
  };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

export interface CustomerIndex {
  byKey: Map<string, PlannedCustomer>;
  keyByClientId: Map<number, string>;
}

export function planCustomers(
  clients: DumpRow[],
  stats: PlanStats
): CustomerIndex {
  const index: CustomerIndex = { byKey: new Map(), keyByClientId: new Map() };
  const byPhone = groupBy(
    clients,
    (row) =>
      phoneMatchKey(text(row.telefono)) ??
      `sem-telefone:${legacyId(row.id, "clienti")}`
  );
  for (const [phoneGroup, rows] of byPhone) {
    const hasPhone = !phoneGroup.startsWith("sem-telefone:");
    const latest = [...rows].sort(byDateThenId).at(-1) as DumpRow;
    const ownerName = nameKey(fullName(latest));
    for (const [name, sameName] of groupBy(rows, (r) => nameKey(fullName(r)))) {
      let role: PhoneRole = "invalid";
      if (hasPhone) {
        role = name === ownerName ? "owner" : "shared";
      }
      const customer = mergeCards(sameName, role, stats);
      stats.largestGroup = Math.max(stats.largestGroup, sameName.length);
      if (sameName.length > 1) {
        stats.mergedGroups += 1;
        stats.mergedLegacyCustomers += sameName.length;
      }
      index.byKey.set(customer.key, customer);
      for (const id of customer.legacyIds) {
        index.keyByClientId.set(id, customer.key);
      }
    }
  }
  return index;
}

/**
 * Customer key for a job whose card was deleted in FixBook: the phone's
 * owner when the name matches, otherwise its own customer (created once
 * per phone + name).
 */
export function orphanCustomerKey(
  row: DumpRow,
  index: CustomerIndex,
  stats: PlanStats
): string {
  const id = legacyId(row.ID, "oggetti");
  const raw = text(row.Telefono);
  const name = text(row.Nominativo) || `Cliente FixBook (reparação ${id})`;
  const phoneKey = phoneMatchKey(raw);
  const owner = phoneKey ? index.byKey.get(phoneKey) : undefined;
  if (owner && nameKey(owner.name) === nameKey(name)) {
    return owner.key;
  }
  const sharedKey = phoneKey ? `partilhado:${phoneKey}:${nameKey(name)}` : "";
  const known = index.byKey.get(sharedKey);
  if (known) {
    return known.key;
  }
  // Nobody holds the number yet → the orphan becomes its owner.
  let role: PhoneRole = "invalid";
  if (phoneKey) {
    role = owner ? "shared" : "owner";
  }
  const identity = identityFor(role, raw, `sem-telefone-R${id}`, name, stats);
  index.byKey.set(identity.key, {
    address: null,
    city: null,
    createdAt: lisbonToUtc(row.dataApertura ?? null),
    email: null,
    key: identity.key,
    legacyIds: [],
    name,
    notes: [ORPHAN_NOTE, ...(identity.note ? [identity.note] : [])].join("\n"),
    phone: identity.phone,
    taxId: null,
  });
  stats.orphanCustomersCreated += 1;
  return identity.key;
}
