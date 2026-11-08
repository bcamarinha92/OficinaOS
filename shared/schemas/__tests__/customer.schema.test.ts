import { describe, expect, it } from "vitest";
import {
  CUSTOMER_ADDRESS_MAX,
  CUSTOMER_CITY_MAX,
  CUSTOMER_NAME_MAX,
  CUSTOMER_NOTES_MAX,
  createCustomerSchema,
  updateCustomerSchema,
} from "../customer.schema";

describe("customer schema length caps", () => {
  it("accepts a name at the cap and rejects one above it", () => {
    const base = { phone: "912345678" };
    expect(
      createCustomerSchema.safeParse({
        ...base,
        name: "x".repeat(CUSTOMER_NAME_MAX),
      }).success
    ).toBe(true);
    expect(
      createCustomerSchema.safeParse({ ...base, name: "x".repeat(5000) })
        .success
    ).toBe(false);
  });

  it("caps phone and email length", () => {
    expect(
      createCustomerSchema.safeParse({ name: "Rui", phone: "9".repeat(33) })
        .success
    ).toBe(false);
    expect(
      updateCustomerSchema.safeParse({
        email: `${"a".repeat(250)}@x.pt`,
      }).success
    ).toBe(false);
  });

  it("accepts address, city and notes up to their caps and rejects longer ones", () => {
    const base = { name: "Rui", phone: "912345678" };
    expect(
      createCustomerSchema.safeParse({
        ...base,
        address: "x".repeat(CUSTOMER_ADDRESS_MAX),
        city: "x".repeat(CUSTOMER_CITY_MAX),
        notes: "x".repeat(CUSTOMER_NOTES_MAX),
      }).success
    ).toBe(true);
    for (const [field, max] of [
      ["address", CUSTOMER_ADDRESS_MAX],
      ["city", CUSTOMER_CITY_MAX],
      ["notes", CUSTOMER_NOTES_MAX],
    ] as const) {
      expect(
        createCustomerSchema.safeParse({
          ...base,
          [field]: "x".repeat(max + 1),
        }).success
      ).toBe(false);
      expect(
        updateCustomerSchema.safeParse({ [field]: "x".repeat(max + 1) }).success
      ).toBe(false);
    }
  });

  it("accepts empty address, city and notes so a form can clear them", () => {
    const parsed = updateCustomerSchema.safeParse({
      address: "",
      city: "",
      notes: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the useExisting override flag", () => {
    const parsed = createCustomerSchema.safeParse({
      name: "Rui",
      phone: "912345678",
      useExisting: true,
    });
    expect(parsed.data?.useExisting).toBe(true);
  });
});
