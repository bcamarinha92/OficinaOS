import { describe, expect, it } from "vitest";
import { safeFailure } from "../safe-error";

describe("safeFailure", () => {
  it("keeps the context and Prisma code, never the row values", () => {
    const prismaError = Object.assign(
      new Error("Unique constraint failed: phone '912345678' (Ana Silva)"),
      { code: "P2002", name: "PrismaClientKnownRequestError" }
    );
    const err = safeFailure("Falha na reparação FB-7", prismaError);
    expect(err.message).toBe("Falha na reparação FB-7 (P2002)");
  });

  it("falls back to the error name", () => {
    expect(safeFailure("Falha", new TypeError("Ana")).message).toBe(
      "Falha (TypeError)"
    );
    expect(safeFailure("Falha", "x").message).toBe("Falha (erro)");
  });
});
