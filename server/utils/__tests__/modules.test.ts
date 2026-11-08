import { describe, expect, it } from "vitest";
import { isModuleEnabled, LOCALLY_ENABLED_MODULES } from "../modules";

describe("isModuleEnabled", () => {
  it("enables a module listed in the cloud entitlements", () => {
    expect(
      isModuleEnabled({ cloudEntitlements: ["invoicing"] }, "invoicing")
    ).toBe(true);
  });

  it("keeps other Pro modules gated without an entitlement", () => {
    expect(isModuleEnabled({ cloudEntitlements: [] }, "invoicing")).toBe(false);
    expect(isModuleEnabled(null, "whatsapp-bot")).toBe(false);
  });

  it("treats the local SMS gateway as always enabled in this fork", () => {
    expect(LOCALLY_ENABLED_MODULES).toContain("sms");
    expect(isModuleEnabled(null, "sms")).toBe(true);
    expect(isModuleEnabled({ cloudEntitlements: [] }, "sms")).toBe(true);
    expect(isModuleEnabled({ cloudEntitlements: "garbage" }, "sms")).toBe(true);
  });
});
