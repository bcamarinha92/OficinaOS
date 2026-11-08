/**
 * Integration test: a FixBook dump loaded into a real, temporary
 * PostgreSQL database (same harness as setup-concurrency.test.ts —
 * throwaway database, `prisma migrate deploy`, skipped when no PostgreSQL
 * is reachable; the CI `check` job always provides one).
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseMysqlDump } from "../dump-parser";
import { HISTORY_REPAIR_NAME, IMPORT_USERNAME, loadPlan } from "../load";
import { NOTES_SEPARATOR } from "../load-customers";
import { buildMigrationPlan } from "../plan";
import { verifyMigration } from "../verify";

const DB_NAME = `fixbook_it_${process.pid}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const baseUrl = process.env.DATABASE_URL as string;
const m = baseUrl.match(
  /^(postgresql:\/\/(?:[^/@:]+(?::[^/]*)?@)?[^/]+)\/([^?]+)(.*)$/
);
const adminUrl = m ? `${m[1]}/postgres${m[3] ?? ""}` : null;
const testDbUrl = m ? `${m[1]}/${DB_NAME}${m[3] ?? ""}` : null;

let serverReachable = false;
if (m && adminUrl) {
  const probe = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 3000,
  });
  try {
    await probe.connect();
    serverReachable = true;
  } catch (err) {
    console.warn(
      "[fixbook-it] no PostgreSQL reachable — tests will skip:",
      (err as Error).message
    );
  } finally {
    await probe.end().catch(() => {
      // best-effort probe teardown
    });
  }
}

const DUMP = `
CREATE TABLE \`clienti\` (
  \`id\` int(4) NOT NULL AUTO_INCREMENT,
  \`nome\` varchar(50) NOT NULL,
  \`cognome\` varchar(50) NOT NULL,
  \`telefono\` varchar(28) NOT NULL,
  \`indirizzo\` varchar(50) NOT NULL,
  \`citta\` varchar(255) NOT NULL,
  \`email\` varchar(50) NOT NULL,
  \`vat\` varchar(60) NOT NULL,
  \`cf\` varchar(60) NOT NULL,
  \`data\` date NOT NULL,
  \`commenti\` longtext NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`clienti\` VALUES (1,'Ana','Silva','912345678','Rua A 1','Faro','ana@mail.pt','','','2020-01-01',''),(2,'ANA','SILVA','912 345 678','','','','123456789','','2023-01-01','Paga a pronto'),(3,'Rui','Costa','961111111','','','','','','2021-06-01','');
CREATE TABLE \`oggetti\` (
  \`ID\` int(255) NOT NULL AUTO_INCREMENT,
  \`Nominativo\` varchar(255) NOT NULL,
  \`ID_Nominativo\` int(11) NOT NULL,
  \`Telefono\` varchar(255) NOT NULL,
  \`sms\` int(1) NOT NULL DEFAULT '0',
  \`Tipo\` int(1) NOT NULL,
  \`Guasto\` mediumtext NOT NULL,
  \`Categoria\` varchar(255) NOT NULL,
  \`Modello\` varchar(255) NOT NULL,
  \`Pezzo\` varchar(255) DEFAULT NULL,
  \`Anticipo\` int(11) NOT NULL,
  \`Prezzo\` int(255) NOT NULL,
  \`dataApertura\` datetime NOT NULL,
  \`dataChiusura\` datetime DEFAULT NULL,
  \`status\` int(1) NOT NULL DEFAULT '3',
  \`Commenti\` varchar(500) NOT NULL,
  \`codice\` varchar(20) NOT NULL,
  \`custom_field\` longtext NOT NULL,
  \`send_email\` int(11) NOT NULL,
  \`email\` text NOT NULL,
  PRIMARY KEY (\`ID\`)
) ENGINE=MyISAM;
INSERT INTO \`oggetti\` VALUES (10,'Ana Silva',1,'912345678',0,2,'Ecrã partido','Smartphone','Samsung A52',NULL,20,85,'2024-01-15 10:00:00','2024-01-20 18:00:00',0,'','CODE0010','{\\"44616e6f73\\":\\"Riscos\\"}',0,''),(11,'Rui Costa',3,'961111111',0,2,'Não liga','Portatil','HP 250 G7','Bateria',0,0,'2025-03-01 09:00:00',NULL,9,'Ligar antes','CODE0011','{}',0,''),(12,'Zé',99,'930000000',0,1,'Capa','Outro','Capa genérica',NULL,0,10,'2025-05-01 12:00:00',NULL,10,'','CODE0011','{}',0,'');
`;

let adminClient: Client | null = null;
let prisma: PrismaClient | null = null;

const run = async (command: string, args: string[]) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testDbUrl as string },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (c: Buffer) => (output += c.toString()));
  child.stderr?.on("data", (c: Buffer) => (output += c.toString()));
  const code = await new Promise<number>((resolve) => {
    child.on("close", resolve);
    child.on("error", () => resolve(-1));
  });
  return { code, output };
};

const db = (): PrismaClient => {
  if (!prisma) {
    throw new Error("integration prisma client missing — beforeAll failed?");
  }
  return prisma;
};

beforeAll(async () => {
  if (!(adminUrl && testDbUrl && serverReachable)) {
    return;
  }
  adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  await adminClient.query(`CREATE DATABASE "${DB_NAME}"`);
  const migrate = await run("bunx", ["prisma", "migrate", "deploy"]);
  if (migrate.code !== 0) {
    console.error(`[fixbook-it] migrate output:\n${migrate.output}`);
    throw new Error(`prisma migrate deploy exited with ${migrate.code}`);
  }
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDbUrl }),
  });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => {
    // best-effort
  });
  if (adminClient) {
    await adminClient
      .query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
      .catch(() => {
        // best-effort
      });
    await adminClient.end().catch(() => {
      // best-effort
    });
  }
});

const plan = () => {
  const tables = parseMysqlDump(DUMP, ["clienti", "oggetti"]);
  return buildMigrationPlan(tables.clienti ?? [], tables.oggetti ?? []);
};

describe.skipIf(!serverReachable)("FixBook load (integration)", () => {
  it("loads customers, jobs, history and verifies the totals", async () => {
    const p = plan();
    const result = await loadPlan(db(), p);

    expect(result).toMatchObject({
      customersCreated: 3,
      jobCodesRenamed: 0,
      jobsCreated: 3,
      jobsSkipped: 0,
    });
    const rows = await verifyMigration(db(), p);
    expect(rows.filter((r) => !r.ok)).toEqual([]);

    const ana = await db().customer.findUniqueOrThrow({
      where: { phone: "912 345 678" },
    });
    expect(ana).toMatchObject({
      address: "Rua A 1",
      city: "Faro",
      name: "ANA SILVA",
      taxId: "123456789",
    });

    const delivered = await db().job.findUniqueOrThrow({
      where: { externalRef: "FB-10" },
      include: {
        auditLogs: { orderBy: { createdAt: "asc" } },
        device: { include: { brand: true } },
        repairs: true,
      },
    });
    expect(delivered).toMatchObject({
      conditionNotes: "Riscos",
      jobCode: "CODE0010",
      status: "DELIVERED",
    });
    expect(delivered.depositAmount?.toNumber()).toBe(20);
    expect(delivered.device).toMatchObject({ category: "phone", model: "A52" });
    expect(delivered.device.brand.name).toBe("Samsung");
    expect(delivered.repairs).toHaveLength(1);
    expect(delivered.repairs[0]?.repairName).toBe(HISTORY_REPAIR_NAME);
    expect(delivered.repairs[0]?.price.toNumber()).toBe(85);
    expect(
      delivered.auditLogs.map((a) => [a.action, a.createdAt.toISOString()])
    ).toEqual([
      ["JOB_CREATED", "2024-01-15T10:00:00.000Z"],
      ["STATUS_CHANGED", "2024-01-20T18:00:00.000Z"],
    ]);

    const open = await db().job.findUniqueOrThrow({
      where: { externalRef: "FB-11" },
      include: { notes: true },
    });
    expect(open.status).toBe("INTAKE");
    expect(open.notes.map((n) => [n.content, n.isCustomerVisible])).toEqual([
      ["Ligar antes\nPeça: Bateria", false],
    ]);

    const renamed = await db().job.findUniqueOrThrow({
      where: { externalRef: "FB-12" },
      include: { customer: true },
    });
    expect(renamed.jobCode).toBe("CODE0011-2");
    expect(renamed.customer.name).toBe("Zé");

    const workflow = await db().recordWorkflow.findMany({
      include: { state: true },
      where: { entityType: "JOB" },
    });
    expect(workflow.map((w) => w.state.name).sort()).toEqual([
      "FixBook: Diagnóstico",
      "FixBook: Encomendar",
      "FixBook: Entregue",
    ]);
  });

  it("creates an import author that cannot sign in", async () => {
    const user = await db().user.findUniqueOrThrow({
      where: { username: IMPORT_USERNAME },
      include: { accounts: true },
    });
    expect(user.isActive).toBe(false);
    expect(user.accounts).toEqual([]);
  });

  it("sends nothing and creates no tasks", async () => {
    expect(await db().notificationOutbox.count()).toBe(0);
    expect(await db().workshopTask.count()).toBe(0);
  });

  it("is idempotent and keeps staff notes, appending legacy ones once", async () => {
    await db().customer.update({
      where: { phone: "912 345 678" },
      data: { notes: "Nota da equipa" },
    });
    await db().customer.update({
      where: { phone: "961111111" },
      data: { notes: "Outra nota" },
    });

    const first = await loadPlan(db(), plan());
    const second = await loadPlan(db(), plan());

    expect(first).toMatchObject({
      customersCreated: 0,
      customersNotesAppended: 1,
      customersReused: 3,
      jobsCreated: 0,
      jobsSkipped: 3,
    });
    expect(second.customersNotesAppended).toBe(0);
    expect(await db().job.count()).toBe(3);
    const ana = await db().customer.findUniqueOrThrow({
      where: { phone: "912 345 678" },
    });
    expect(ana.notes).toBe(
      `Nota da equipa${NOTES_SEPARATOR}Paga a pronto\nFundido de 2 fichas do FixBook (n.º 1, 2).`
    );
    const rui = await db().customer.findUniqueOrThrow({
      where: { phone: "961111111" },
    });
    expect(rui.notes).toBe("Outra nota");
  });

  it("matches an existing customer stored with the +351 prefix", async () => {
    await db().customer.create({
      data: { name: "Marta", phone: "+351 940 000 000" },
    });
    const p = buildMigrationPlan(
      [
        {
          cf: "",
          citta: "Tavira",
          cognome: "Reis",
          commenti: "",
          data: "2022-01-01",
          email: "",
          id: "50",
          indirizzo: "",
          nome: "Marta",
          telefono: "940000000",
          vat: "",
        },
      ],
      []
    );

    const result = await loadPlan(db(), p);

    expect(result).toMatchObject({ customersCreated: 0, customersReused: 1 });
    const marta = await db().customer.findUniqueOrThrow({
      where: { phone: "+351 940 000 000" },
    });
    expect(marta.city).toBe("Tavira");
  });

  it("verifies only the jobs of the plan it is given", async () => {
    const full = plan();
    const subset = { ...full, jobs: full.jobs.slice(0, 1) };
    subset.stats = buildMigrationPlan([], []).stats;
    subset.stats.jobs = 1;
    subset.stats.jobsByStatus = { DELIVERED: 1 };
    subset.stats.jobsWithPrice = 1;
    subset.stats.priceTotal = 85;
    subset.stats.depositTotal = 20;
    subset.stats.deliveredWithDate = 1;

    const rows = await verifyMigration(db(), subset);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
  });
});
