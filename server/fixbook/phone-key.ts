import { isValidPhone, phoneSearchDigits } from "@shared/utils/phone";

/**
 * Filler numbers typed when the customer gave none ("900000000",
 * "999999999") use one or two distinct digits; in FixBook such numbers were
 * shared by dozens of different people.
 */
const FILLER_MAX_DISTINCT_DIGITS = 2;

/**
 * Identity of a customer across FixBook cards and existing OficinaOS rows:
 * the phone's digits without separators or a +351 prefix ("912 345 678"
 * and "+351912345678" are the same number). Returns null when the number
 * cannot identify anyone — invalid text ("n/a") or filler — so such cards
 * are never merged with each other.
 */
export function phoneMatchKey(phone: string): string | null {
  if (!isValidPhone(phone)) {
    return null;
  }
  const digits = phoneSearchDigits(phone);
  if (new Set(digits).size <= FILLER_MAX_DISTINCT_DIGITS) {
    return null;
  }
  return digits;
}
