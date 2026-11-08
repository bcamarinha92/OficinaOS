/**
 * FixBook (hdt_prod) conventions and how they map onto OficinaOS:
 * status codes, device categories, hex-encoded custom fields and naive
 * Europe/Lisbon datetimes.
 */
import type { JobStatusType } from "@shared/constants/job-statuses";

export const FIXBOOK_TIMEZONE = "Europe/Lisbon";

export interface MappedStatus {
  holdReason: string | null;
  /** FixBook's own label (pt), kept as a tracking state. */
  label: string;
  status: JobStatusType;
}

/** FixBook `oggetti.status` → OficinaOS status (agreed with the shop). */
const STATUS_MAP: Record<string, MappedStatus> = {
  "0": { holdReason: null, label: "Entregue", status: "DELIVERED" },
  "1": { holdReason: null, label: "Em Reparação", status: "IN_REPAIR" },
  "2": { holdReason: null, label: "Para Entrega", status: "DONE" },
  "3": {
    holdReason: "Pendente cliente",
    label: "Pendente Cliente",
    status: "ON_HOLD",
  },
  "5": { holdReason: null, label: "Recusado", status: "CANCELLED" },
  "6": {
    holdReason: null,
    label: "Pendente Peças",
    status: "WAITING_FOR_PARTS",
  },
  "7": { holdReason: null, label: "Sem Reparação", status: "DONE" },
  "8": { holdReason: "Externo", label: "Externo", status: "ON_HOLD" },
  "9": { holdReason: null, label: "Diagnóstico", status: "INTAKE" },
  "10": {
    holdReason: null,
    label: "Encomendar",
    status: "WAITING_FOR_PARTS",
  },
};

/** FixBook status 7: finished without a repair (the device goes back). */
export const STATUS_NOT_REPAIRED = "7";

export function mapStatus(code: string | null): MappedStatus {
  const key = (code ?? "").trim();
  return (
    STATUS_MAP[key] ?? {
      holdReason: null,
      label: `Desconhecido (${key})`,
      status: "INTAKE",
    }
  );
}

/** FixBook category (shop-defined list) → OficinaOS device category. */
const CATEGORY_MAP: Record<string, string> = {
  desktop: "desktop",
  gps: "gps",
  portatil: "laptop",
  smartphone: "phone",
  tablet: "tablet",
};

const DIACRITICS_RE = /\p{Diacritic}/gu;

export function mapCategory(legacy: string | null): string {
  const key = (legacy ?? "")
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .trim()
    .toLowerCase();
  return CATEGORY_MAP[key] ?? "other";
}

const HEX_RE = /^(?:[0-9a-f]{2})+$/i;

/**
 * `oggetti.custom_field` is JSON keyed by the hex-encoded field name
 * ({"44616e6f73": "…"} is "Danos"). Returns name → trimmed value, without
 * empty values.
 */
export function decodeCustomFields(raw: string | null): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const text = String(value ?? "").trim();
    if (!text) {
      continue;
    }
    const name = HEX_RE.test(key) ? Buffer.from(key, "hex").toString() : key;
    out[name] = text;
  }
  return out;
}

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/;

const lisbonParts = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: FIXBOOK_TIMEZONE,
  year: "numeric",
});

/** Lisbon wall-clock time of `instant`, expressed as if it were UTC. */
function wallClockAsUtc(instant: number): number {
  const parts = Object.fromEntries(
    lisbonParts.formatToParts(instant).map((p) => [p.type, p.value])
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
}

/** Parsed parts of a naive datetime, or null when it is not a real date. */
function calendarParts(raw: string | null): number[] | null {
  const match = DATETIME_RE.exec((raw ?? "").trim());
  if (!match) {
    return null;
  }
  const [y, mo, d, h, mi, s] = match.slice(1).map((v) => Number(v ?? 0));
  const parts = [y, mo, d, h, mi, s] as number[];
  const asUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC silently rolls 2024-02-31 into March; a real date round-trips.
  const roundTrips =
    asUtc.getUTCFullYear() === y &&
    asUtc.getUTCMonth() === mo - 1 &&
    asUtc.getUTCDate() === d &&
    asUtc.getUTCHours() === h &&
    asUtc.getUTCMinutes() === mi &&
    asUtc.getUTCSeconds() === s;
  return y > 0 && roundTrips ? parts : null;
}

/**
 * FixBook stores naive local datetimes ("2024-07-15 10:00:00", Lisbon).
 * Returns the matching instant, or null for empty/zero/impossible values.
 * In the spring-forward gap the time moves forward an hour; in the
 * fall-back overlap the second (winter-time) occurrence is used.
 */
export function lisbonToUtc(raw: string | null): Date | null {
  const parts = calendarParts(raw);
  if (!parts) {
    return null;
  }
  const [y, mo, d, h, mi, s] = parts as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes settle the offset, including around DST changes.
  let guess = asUtc;
  for (let pass = 0; pass < 2; pass++) {
    guess = asUtc - (wallClockAsUtc(guess) - guess);
  }
  return new Date(guess);
}
