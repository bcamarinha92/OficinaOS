/**
 * Modules this fork (branch `hdt`) runs without a cloud entitlement. The SMS
 * channel talks only to the shop's own Android gateway (sms-gate, local mode)
 * and never touches OficinaOS Cloud, so the shop enables it locally.
 */
export const LOCALLY_ENABLED_MODULES: readonly string[] = ["sms"];

/**
 * Cached Pro entitlements live on ShopSettings.cloudEntitlements (polled
 * from the cloud every 2 min). A local feature is active only while the
 * module id is in that list — expired/revoked grants disappear on the
 * next sync and the feature stops without touching its own toggle.
 * Modules in LOCALLY_ENABLED_MODULES are always active.
 */
export function isModuleEnabled(
  row: { cloudEntitlements?: unknown } | null | undefined,
  module: string
): boolean {
  if (LOCALLY_ENABLED_MODULES.includes(module)) {
    return true;
  }
  const modules = Array.isArray(row?.cloudEntitlements)
    ? (row.cloudEntitlements as string[])
    : [];
  return modules.includes(module);
}
