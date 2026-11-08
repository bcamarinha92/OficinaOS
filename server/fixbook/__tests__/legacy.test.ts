import { describe, expect, it } from "vitest";
import { splitBrandModel } from "../brands";
import {
  decodeCustomFields,
  lisbonToUtc,
  mapCategory,
  mapStatus,
} from "../legacy";

describe("mapStatus", () => {
  it.each([
    ["0", "DELIVERED", null, "Entregue"],
    ["1", "IN_REPAIR", null, "Em Reparação"],
    ["2", "DONE", null, "Para Entrega"],
    ["3", "ON_HOLD", "Pendente cliente", "Pendente Cliente"],
    ["5", "CANCELLED", null, "Recusado"],
    ["6", "WAITING_FOR_PARTS", null, "Pendente Peças"],
    ["7", "DONE", null, "Sem Reparação"],
    ["8", "ON_HOLD", "Externo", "Externo"],
    ["9", "INTAKE", null, "Diagnóstico"],
    ["10", "WAITING_FOR_PARTS", null, "Encomendar"],
  ])("maps FixBook %s to %s", (code, status, holdReason, label) => {
    expect(mapStatus(code)).toEqual({ holdReason, label, status });
  });

  it("keeps unknown codes open and labelled", () => {
    expect(mapStatus("42")).toEqual({
      holdReason: null,
      label: "Desconhecido (42)",
      status: "INTAKE",
    });
  });
});

describe("mapCategory", () => {
  it.each([
    ["Smartphone", "phone"],
    ["Tablet", "tablet"],
    ["Portatil", "laptop"],
    ["Portátil", "laptop"],
    ["Desktop", "desktop"],
    ["GPS", "gps"],
    ["Outro", "other"],
    ["undefined", "other"],
    ["", "other"],
  ])("maps %s to %s", (legacy, category) => {
    expect(mapCategory(legacy)).toBe(category);
  });
});

describe("decodeCustomFields", () => {
  it("decodes hex-encoded field names and drops empty values", () => {
    // "44616e6f73" is "Danos" in hex, as FixBook stores custom fields.
    expect(
      decodeCustomFields(
        '{"44616e6f73":" Ecrã riscado ","494d4549":"","4f7574726f":"x"}'
      )
    ).toEqual({ Danos: "Ecrã riscado", Outro: "x" });
  });

  it("returns nothing for empty or invalid JSON", () => {
    expect(decodeCustomFields("")).toEqual({});
    expect(decodeCustomFields("not json")).toEqual({});
    expect(decodeCustomFields("[]")).toEqual({});
  });
});

describe("lisbonToUtc", () => {
  it("converts winter time (UTC+0)", () => {
    expect(lisbonToUtc("2024-01-15 10:00:00")?.toISOString()).toBe(
      "2024-01-15T10:00:00.000Z"
    );
  });

  it("converts summer time (UTC+1)", () => {
    expect(lisbonToUtc("2024-07-15 10:00:00")?.toISOString()).toBe(
      "2024-07-15T09:00:00.000Z"
    );
  });

  it("accepts a bare date as local midnight", () => {
    expect(lisbonToUtc("2024-07-15")?.toISOString()).toBe(
      "2024-07-14T23:00:00.000Z"
    );
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    expect(lisbonToUtc("2024-02-31 10:00:00")).toBeNull();
    expect(lisbonToUtc("2024-00-00")).toBeNull();
    expect(lisbonToUtc("2024-13-01")).toBeNull();
    expect(lisbonToUtc("2024-05-10 25:00:00")).toBeNull();
  });

  it("resolves the DST gaps deterministically", () => {
    // 01:30 does not exist on 31 Mar 2024 (clocks jump 01:00 → 02:00).
    expect(lisbonToUtc("2024-03-31 01:30:00")?.toISOString()).toBe(
      "2024-03-31T01:30:00.000Z"
    );
    // 01:30 happens twice on 27 Oct 2024; the winter (second) one wins.
    expect(lisbonToUtc("2024-10-27 01:30:00")?.toISOString()).toBe(
      "2024-10-27T01:30:00.000Z"
    );
  });

  it("returns null for empty and zero dates", () => {
    expect(lisbonToUtc(null)).toBeNull();
    expect(lisbonToUtc("0000-00-00 00:00:00")).toBeNull();
    expect(lisbonToUtc("garbage")).toBeNull();
  });
});

describe("splitBrandModel", () => {
  it.each([
    ["Samsung Galaxy A52", "Samsung", "Galaxy A52"],
    ["samsung a5", "Samsung", "a5"],
    ["iPhone 11 Pro", "Apple", "iPhone 11 Pro"],
    ["ipad air 2", "Apple", "ipad air 2"],
    ["Galaxy S9", "Samsung", "Galaxy S9"],
    ["Redmi Note 8", "Xiaomi", "Redmi Note 8"],
    ["POCO X3", "Xiaomi", "POCO X3"],
    ["Mi 9T", "Xiaomi", "Mi 9T"],
    ["P20 Lite", "Huawei", "P20 Lite"],
    ["psmart 2019", "Huawei", "psmart 2019"],
    ["Mate 20", "Huawei", "Mate 20"],
    ["HP 250 G7", "HP", "250 G7"],
    ["tomtom go", "TomTom", "go"],
    ["Huawei", "Huawei", "Huawei"],
    ["  Nokia   3.1  ", "Nokia", "3.1"],
    ["vdf smart", "Vodafone", "vdf smart"],
    ["PS4 slim", "Sony", "PS4 slim"],
    ["j530", "Samsung", "j530"],
    ["s22 ultra", "Samsung", "s22 ultra"],
    ["Doogee S88", "Doogee", "S88"],
    ["neffos c5", "TP-Link", "neffos c5"],
    ["2 telemóveis", "Outra", "2 telemóveis"],
  ])("splits %j into %s / %s", (raw, brand, model) => {
    expect(splitBrandModel(raw)).toEqual({ brand, model });
  });

  it("never returns an empty model", () => {
    expect(splitBrandModel("   ")).toEqual({
      brand: "Outra",
      model: "Sem modelo",
    });
  });
});
