/**
 * Minimal reader for `mysqldump` output (FixBook's MySQL database). Reads
 * the column names from each CREATE TABLE and the rows from the extended
 * INSERT statements, without a MySQL server — the migration works from a
 * dump file so the legacy database is never touched.
 *
 * Values come back as their literal text (numbers included) or null; the
 * caller converts types. Only the escapes mysqldump emits are decoded.
 */

export type DumpRow = Record<string, string | null>;
export type DumpTables = Record<string, DumpRow[]>;

const CREATE_RE = /^CREATE TABLE `([^`]+)` \(\n([\s\S]*?)\n\)/gm;
const COLUMN_RE = /^\s*`([^`]+)`\s/;
const INSERT_RE =
  /^(?:INSERT(?: IGNORE)?|REPLACE) INTO `([^`]+)`(?: \(([^)]*)\))? VALUES /gm;
const CRLF_RE = /\r\n/g;
const BACKTICK_RE = /`/g;
const UNQUOTED_RE = /[^,)]+/y;

const ESCAPES: Record<string, string> = {
  "0": "\0",
  b: "\b",
  n: "\n",
  r: "\r",
  t: "\t",
  Z: "\x1a",
};

function readColumns(dump: string): Map<string, string[]> {
  const columns = new Map<string, string[]>();
  for (const match of dump.matchAll(CREATE_RE)) {
    const [, table, body] = match;
    if (!(table && body)) {
      continue;
    }
    const names: string[] = [];
    for (const line of body.split("\n")) {
      const col = COLUMN_RE.exec(line);
      if (col?.[1]) {
        names.push(col[1]);
      }
    }
    columns.set(table, names);
  }
  return columns;
}

/** Reads one quoted string starting at `start` (the opening quote). */
function readString(dump: string, start: number): [string, number] {
  let out = "";
  let i = start + 1;
  while (i < dump.length) {
    const ch = dump[i];
    if (ch === "\\") {
      const next = dump[i + 1] ?? "";
      out += ESCAPES[next] ?? next;
      i += 2;
    } else if (ch === "'") {
      if (dump[i + 1] === "'") {
        out += "'";
        i += 2;
      } else {
        return [out, i + 1];
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  throw new Error("Dump inválido: texto entre aspas sem fim.");
}

/** Reads `(…),(…);` starting at `start`; returns the rows and the end. */
function readValues(
  dump: string,
  start: number
): [(string | null)[][], number] {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let i = start;
  while (i < dump.length) {
    const ch = dump[i];
    if (ch === "(") {
      row = [];
      i += 1;
    } else if (ch === "'") {
      const [value, next] = readString(dump, i);
      row.push(value);
      i = next;
    } else if (ch === ")") {
      rows.push(row);
      i += 1;
    } else if (ch === ";") {
      return [rows, i + 1];
    } else if (ch === "," || ch === " " || ch === "\n" || ch === "\r") {
      i += 1;
    } else {
      UNQUOTED_RE.lastIndex = i;
      const token = UNQUOTED_RE.exec(dump)?.[0] ?? "";
      if (!token) {
        throw new Error(`Dump inválido perto da posição ${i}.`);
      }
      row.push(token === "NULL" ? null : token.trim());
      i += token.length;
    }
  }
  throw new Error("Dump inválido: INSERT sem ';' final.");
}

/** Column list of `INSERT … (\`a\`, \`b\`) VALUES`, if present. */
function insertColumns(list: string | undefined): string[] | null {
  if (!list) {
    return null;
  }
  return list.split(",").map((c) => c.replace(BACKTICK_RE, "").trim());
}

function toRow(table: string, names: string[], values: (string | null)[]) {
  if (values.length !== names.length) {
    throw new Error(
      `Linha de "${table}" com ${values.length} valores; esperava ${names.length}.`
    );
  }
  const row: DumpRow = {};
  names.forEach((name, index) => {
    row[name] = values[index] ?? null;
  });
  return row;
}

export function parseMysqlDump(raw: string, tables: string[]): DumpTables {
  const dump = raw.replace(CRLF_RE, "\n");
  const wanted = new Set(tables);
  const columns = readColumns(dump);
  const result: DumpTables = {};
  for (const table of tables) {
    if (!columns.has(table)) {
      throw new Error(`Tabela "${table}" não encontrada no dump.`);
    }
    result[table] = [];
  }

  for (const match of dump.matchAll(INSERT_RE)) {
    const table = match[1] ?? "";
    if (!wanted.has(table)) {
      continue;
    }
    const names = insertColumns(match[2]) ?? columns.get(table) ?? [];
    const [rows] = readValues(dump, match.index + match[0].length);
    for (const values of rows) {
      result[table]?.push(toRow(table, names, values));
    }
  }
  return result;
}
