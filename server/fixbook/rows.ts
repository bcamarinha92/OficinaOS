/** Small readers for FixBook dump values (always text or null). */

const SPACES_RE = /\s+/g;
const DIACRITICS_RE = /\p{Diacritic}/gu;

export const text = (value: string | null | undefined) => (value ?? "").trim();

export const toNumber = (value: string | null | undefined) =>
  Number.parseFloat(text(value)) || 0;

export const nonEmpty = (values: string[]) => values.filter(Boolean);

export const lastOf = (values: string[]) => nonEmpty(values).at(-1) ?? null;

/** Positive integer id of a FixBook row; anything else is unusable. */
export function legacyId(
  value: string | null | undefined,
  table: string
): number {
  const id = Number(text(value));
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Linha de "${table}" com id inválido.`);
  }
  return id;
}

/** Name comparison key: case, accents and extra spaces ignored. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .replace(SPACES_RE, " ")
    .trim()
    .toLowerCase();
}
