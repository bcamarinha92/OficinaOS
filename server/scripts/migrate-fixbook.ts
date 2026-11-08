/**
 * migrate-fixbook — imports the FixBook (hdt_prod) repair panel into
 * OficinaOS from a `mysqldump` file. The legacy MySQL is never contacted.
 *
 *   bun run migrate-fixbook -- --dump hdt.sql             → dry run: plan
 *                                                           and counts only
 *   bun run migrate-fixbook -- --dump hdt.sql --confirm   → write into
 *                                                           DATABASE_URL
 *
 * Re-running is safe: jobs already migrated (externalRef FB-<id>) are
 * skipped and customers are matched by phone. Output is counts and euro
 * totals only — never names, phones or notes — and the exit code is 1 when
 * the post-load verification does not match the plan.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnv } from "../config/env.js";
import { parseMysqlDump } from "../fixbook/dump-parser.js";
import { loadPlan } from "../fixbook/load.js";
import { buildMigrationPlan } from "../fixbook/plan.js";
import type { MigrationPlan } from "../fixbook/types.js";
import { verifyMigration } from "../fixbook/verify.js";

const PROGRESS_EVERY = 250;
const REPLACEMENT_CHAR = "\uFFFD";

/** Database name only — never the URL, which carries credentials. */
function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace("/", "") || "(sem nome)";
  } catch {
    return "(desconhecida)";
  }
}

function printPlan(plan: MigrationPlan) {
  const s = plan.stats;
  console.log("Plano de migração (FixBook → OficinaOS)");
  console.log(
    `  Clientes: ${s.legacyCustomers} fichas → ${s.customers} clientes`
  );
  console.log(
    `    fundidos: ${s.mergedLegacyCustomers} fichas em ${s.mergedGroups} grupos`
  );
  console.log(
    `    criados a partir de reparações órfãs: ${s.orphanCustomersCreated}`
  );
  console.log(
    `    emails inválidos movidos para notas: ${s.invalidEmails}; telefones inválidos: ${s.invalidPhones}; maior grupo fundido: ${s.largestGroup} fichas`
  );
  console.log(
    `    telefone partilhado com outra pessoa (fica nas notas): ${s.sharedPhoneSplits}`
  );
  console.log(`  Reparações: ${s.jobs} (órfãs de cliente: ${s.orphanJobs})`);
  for (const [status, count] of Object.entries(s.jobsByStatus).sort()) {
    console.log(`    ${status}: ${count}`);
  }
  console.log("    estados originais:");
  for (const [label, count] of Object.entries(s.legacyStatuses).sort()) {
    console.log(`      ${label}: ${count}`);
  }
  console.log(
    `    com preço: ${s.jobsWithPrice} (total ${s.priceTotal.toFixed(2)} €); sinais: ${s.depositTotal.toFixed(2)} €`
  );
  console.log(
    `    entregues com data: ${s.deliveredWithDate}; códigos renomeados: ${s.renamedCodes}; sem avaria: ${s.missingProblem}`
  );
}

export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      confirm: { type: "boolean", default: false },
      dump: { type: "string" },
    },
  });
  if (!values.dump) {
    throw new Error("Indica o ficheiro: --dump <caminho do mysqldump>.");
  }

  const dump = await readFile(values.dump, "utf8");
  if (dump.includes(REPLACEMENT_CHAR)) {
    console.warn(
      "Aviso: o dump não é UTF-8 válido — exporta com --default-character-set=utf8mb4."
    );
  }
  const tables = parseMysqlDump(dump, ["clienti", "oggetti"]);
  const plan = buildMigrationPlan(tables.clienti ?? [], tables.oggetti ?? []);
  printPlan(plan);

  if (!values.confirm) {
    console.log("\nSimulação: nada foi escrito. Usa --confirm para migrar.");
    return;
  }

  const env = loadEnv();
  console.log(`\nA escrever na base "${databaseName(env.DATABASE_URL)}"…`);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    const result = await loadPlan(prisma, plan, (done, total) => {
      if (done % PROGRESS_EVERY === 0 || done === total) {
        console.log(`  … ${done}/${total} reparações`);
      }
    });
    console.log("\nCarregamento:", JSON.stringify(result));

    const rows = await verifyMigration(prisma, plan);
    console.log("\nVerificação:");
    for (const r of rows) {
      console.log(
        `  ${r.ok ? "OK " : "ERRO"} ${r.metric}: esperado ${r.expected}, obtido ${r.actual}`
      );
    }
    if (rows.some((r) => !r.ok)) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    // Only our own messages: Prisma errors can embed the row being written.
    const safe =
      error instanceof Error && !error.name.startsWith("Prisma")
        ? error.message
        : "Erro da base de dados.";
    console.error(safe);
    process.exitCode = 1;
  });
}
