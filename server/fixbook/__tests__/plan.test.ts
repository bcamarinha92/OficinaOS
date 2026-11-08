import { describe, expect, it } from "vitest";
import type { DumpRow } from "../dump-parser";
import { buildMigrationPlan, MISSING_PROBLEM } from "../plan";

const INVALID_ID_RE = /id inválido/;

function client(overrides: Partial<Record<string, string | null>>): DumpRow {
  return {
    cf: "",
    citta: "",
    cognome: "Silva",
    commenti: "",
    data: "2020-01-01",
    email: "",
    id: "1",
    indirizzo: "",
    nome: "Ana",
    telefono: "912345678",
    vat: "",
    ...overrides,
  };
}

function job(overrides: Partial<Record<string, string | null>>): DumpRow {
  return {
    Anticipo: "0",
    Categoria: "Smartphone",
    Commenti: "",
    custom_field: "{}",
    codice: "AbCdEfGh",
    dataApertura: "2024-01-15 10:00:00",
    dataChiusura: null,
    email: "",
    Guasto: "Ecrã partido",
    ID: "100",
    ID_Nominativo: "1",
    Modello: "Samsung A52",
    Nominativo: "Ana Silva",
    Pezzo: null,
    Prezzo: "0",
    send_email: "0",
    sms: "0",
    status: "9",
    Telefono: "912345678",
    Tipo: "2",
    ...overrides,
  };
}

describe("buildMigrationPlan — customers", () => {
  it("merges cards sharing a phone, keeping the most recent details", () => {
    const plan = buildMigrationPlan(
      [
        client({
          commenti: "Cliente antigo",
          data: "2019-05-01",
          email: "velho@mail.pt",
          id: "1",
          indirizzo: "Rua Velha 1",
          nome: "ANA",
          telefono: "912 345 678",
        }),
        client({
          citta: "Faro",
          commenti: "Paga sempre a pronto",
          data: "2023-02-01",
          email: "ana@mail.pt",
          id: "7",
          nome: "Ana",
          telefono: "+351912345678",
          vat: "123456789",
        }),
      ],
      []
    );

    expect(plan.customers).toHaveLength(1);
    expect(plan.customers[0]).toMatchObject({
      address: "Rua Velha 1",
      city: "Faro",
      email: "ana@mail.pt",
      legacyIds: [1, 7],
      name: "Ana Silva",
      phone: "+351912345678",
      taxId: "123456789",
    });
    expect(plan.customers[0]?.createdAt?.toISOString()).toBe(
      "2019-04-30T23:00:00.000Z"
    );
    expect(plan.customers[0]?.notes).toBe(
      "Cliente antigo\nPaga sempre a pronto\nFundido de 2 fichas do FixBook (n.º 1, 7)."
    );
    expect(plan.stats).toMatchObject({
      customers: 1,
      legacyCustomers: 2,
      mergedGroups: 1,
      mergedLegacyCustomers: 2,
    });
  });

  it("moves an invalid email into the notes instead of dropping it", () => {
    const plan = buildMigrationPlan([client({ email: "ana@" })], []);
    expect(plan.customers[0]?.email).toBeNull();
    expect(plan.customers[0]?.notes).toBe("Email antigo (inválido): ana@");
    expect(plan.stats.invalidEmails).toBe(1);
  });

  it("never merges cards whose phone is invalid or a filler number", () => {
    const plan = buildMigrationPlan(
      [
        client({ id: "1", telefono: "n/a" }),
        client({ id: "2", telefono: "n/a" }),
        client({ id: "3", telefono: "000000000" }),
        client({ id: "4", telefono: "000 000 000" }),
      ],
      []
    );

    expect(plan.customers).toHaveLength(4);
    expect(new Set(plan.customers.map((c) => c.phone)).size).toBe(4);
    expect(plan.customers[0]).toMatchObject({
      notes: "Telefone antigo (inválido): n/a",
      phone: "sem-telefone-FB1",
    });
    expect(plan.stats.invalidPhones).toBe(4);
    expect(plan.stats.mergedGroups).toBe(0);
  });

  it("only merges cards when the name matches too", () => {
    const plan = buildMigrationPlan(
      [
        client({ data: "2019-01-01", id: "1", nome: "ANA", cognome: "SILVA" }),
        client({ data: "2020-01-01", id: "2", nome: "Rui", cognome: "Silva" }),
        client({ data: "2023-01-01", id: "3", nome: "Ána", cognome: "Silva " }),
      ],
      []
    );

    expect(plan.customers).toHaveLength(2);
    const [ana, rui] = plan.customers;
    // The most recent card's person keeps the real number.
    expect(ana).toMatchObject({ legacyIds: [1, 3], phone: "912345678" });
    expect(rui).toMatchObject({
      legacyIds: [2],
      notes: "Telefone partilhado com outra ficha: 912345678",
      phone: "sem-telefone-FB2",
    });
    expect(plan.stats.sharedPhoneSplits).toBe(1);
  });

  it("treats numbers made of one or two digits as filler", () => {
    const plan = buildMigrationPlan(
      [
        client({ id: "1", nome: "Ana", telefono: "900000000" }),
        client({ id: "2", nome: "Ana", telefono: "900000000" }),
      ],
      []
    );
    expect(plan.customers).toHaveLength(2);
    expect(plan.stats.invalidPhones).toBe(2);
  });

  it("reports the largest merged group so filler numbers stand out", () => {
    const plan = buildMigrationPlan(
      [
        client({ id: "1" }),
        client({ id: "2" }),
        client({ id: "3" }),
        client({ id: "4", telefono: "961111111" }),
        client({ id: "5", telefono: "961111111" }),
      ],
      []
    );
    expect(plan.stats.largestGroup).toBe(3);
  });

  it("falls back to the tax code when there is no VAT number", () => {
    const plan = buildMigrationPlan([client({ cf: "987654321" })], []);
    expect(plan.customers[0]?.taxId).toBe("987654321");
  });
});

describe("buildMigrationPlan — jobs", () => {
  it("maps a delivered repair with price, deposit, dates and notes", () => {
    const plan = buildMigrationPlan(
      [client({})],
      [
        job({
          Anticipo: "20",
          Commenti: "Cliente volta sexta",
          custom_field: '{"44616e6f73":"Riscos na tampa"}',
          dataChiusura: "2024-07-20 18:30:00",
          Pezzo: "Ecrã OLED",
          Prezzo: "85",
          status: "0",
        }),
      ]
    );

    expect(plan.jobs[0]).toMatchObject({
      brand: "Samsung",
      category: "phone",
      conditionNotes: "Riscos na tampa",
      customerKey: "912345678",
      depositAmount: 20,
      externalRef: "FB-100",
      jobCode: "AbCdEfGh",
      legacyStatusLabel: "Entregue",
      model: "A52",
      note: "Cliente volta sexta\nPeça: Ecrã OLED",
      price: 85,
      reportedProblem: "Ecrã partido",
      status: "DELIVERED",
    });
    expect(plan.jobs[0]?.createdAt?.toISOString()).toBe(
      "2024-01-15T10:00:00.000Z"
    );
    expect(plan.jobs[0]?.deliveredAt?.toISOString()).toBe(
      "2024-07-20T17:30:00.000Z"
    );
    expect(plan.stats).toMatchObject({
      deliveredWithDate: 1,
      depositTotal: 20,
      jobsWithPrice: 1,
      priceTotal: 85,
    });
  });

  it("keeps open jobs open, with hold reasons and FixBook labels", () => {
    const plan = buildMigrationPlan(
      [client({})],
      [
        job({ ID: "1", codice: "A1", status: "8" }),
        job({ ID: "2", codice: "A2", status: "7" }),
        job({ ID: "3", codice: "A3", status: "10", Tipo: "1" }),
      ]
    );

    expect(plan.jobs.map((j) => [j.status, j.holdReason])).toEqual([
      ["ON_HOLD", "Externo"],
      ["DONE", null],
      ["WAITING_FOR_PARTS", null],
    ]);
    expect(plan.jobs[1]?.note).toBe("Sem reparação (FixBook)");
    expect(plan.jobs[2]?.note).toBe("Encomenda (FixBook)");
    expect(plan.stats.legacyStatuses).toEqual({
      Encomendar: 1,
      Externo: 1,
      "Sem Reparação": 1,
    });
  });

  it("does not record a delivery date for jobs that were not delivered", () => {
    const plan = buildMigrationPlan(
      [client({})],
      [job({ dataChiusura: "2024-07-20 18:30:00", status: "2" })]
    );
    expect(plan.jobs[0]?.deliveredAt).toBeNull();
  });

  it("renames repeated codes so every job stays trackable", () => {
    const plan = buildMigrationPlan(
      [client({})],
      [
        job({ codice: "DUPE1234", ID: "1" }),
        job({ codice: "DUPE1234", ID: "2" }),
        job({ codice: "DUPE1234", ID: "3" }),
      ]
    );
    expect(plan.jobs.map((j) => j.jobCode)).toEqual([
      "DUPE1234",
      "DUPE1234-2",
      "DUPE1234-3",
    ]);
    expect(plan.stats.renamedCodes).toBe(2);
  });

  it("creates a customer from the job when its card was deleted", () => {
    const plan = buildMigrationPlan(
      [client({})],
      [
        job({
          ID: "5",
          ID_Nominativo: "999",
          Nominativo: "Rui Costa",
          Telefono: "961111111",
        }),
        job({
          ID: "6",
          ID_Nominativo: "998",
          Nominativo: "ana silva",
          Telefono: "912 345 678",
        }),
      ]
    );

    expect(plan.customers).toHaveLength(2);
    expect(plan.customers[1]).toMatchObject({
      key: "961111111",
      name: "Rui Costa",
      phone: "961111111",
    });
    // The second orphan's phone and name match a customer: reuse it.
    expect(plan.jobs[1]?.customerKey).toBe("912345678");
    expect(plan.stats).toMatchObject({
      orphanCustomersCreated: 1,
      orphanJobs: 2,
    });
  });

  it("refuses rows without a usable FixBook id", () => {
    expect(() => buildMigrationPlan([client({})], [job({ ID: "0" })])).toThrow(
      INVALID_ID_RE
    );
    expect(() => buildMigrationPlan([client({ id: "x" })], [])).toThrow(
      INVALID_ID_RE
    );
  });

  it("gives an orphan with another name its own customer", () => {
    const plan = buildMigrationPlan(
      [client({})],
      [
        job({ ID: "7", ID_Nominativo: "999", Nominativo: "Zé Lopes" }),
        job({ ID: "8", ID_Nominativo: "999", Nominativo: "ZÉ LOPES" }),
      ]
    );

    expect(plan.customers).toHaveLength(2);
    expect(plan.customers[1]).toMatchObject({
      name: "Zé Lopes",
      phone: "sem-telefone-R7",
    });
    expect(plan.jobs[0]?.customerKey).toBe(plan.jobs[1]?.customerKey);
    expect(plan.stats.orphanCustomersCreated).toBe(1);
  });

  it("fills a placeholder problem when FixBook had none", () => {
    const plan = buildMigrationPlan([client({})], [job({ Guasto: "  " })]);
    expect(plan.jobs[0]?.reportedProblem).toBe(MISSING_PROBLEM);
    expect(plan.stats.missingProblem).toBe(1);
  });
});
