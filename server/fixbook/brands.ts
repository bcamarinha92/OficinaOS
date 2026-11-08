/**
 * FixBook keeps brand and model in one free-text field ("Samsung A52",
 * "iPhone 11", "Redmi Note 8"). OficinaOS needs a Brand + model pair. The
 * first word decides: a known brand name is split off; a product-line name
 * (iPhone, Galaxy, Redmi…) maps to its maker and the model keeps the full
 * text; anything else goes to the generic "Outra" brand untouched.
 */

/** Same fallback brand as the CSV importer (job.service.ts). */
export const GENERIC_BRAND = "Outra";
const EMPTY_MODEL = "Sem modelo";
const SPACES_RE = /\s+/g;
const HUAWEI_P_SERIES_RE = /^p\d+$/;
/** Samsung Galaxy J/S model numbers typed without the brand (j530, s22). */
const SAMSUNG_SERIES_RE = /^(?:j\d{3}|s\d{1,2})$/;

/** Lower-case first word → display name, for words that are the brand. */
const BRAND_NAMES: Record<string, string> = Object.fromEntries(
  [
    "Acer",
    "Alcatel",
    "Apple",
    "Asus",
    "Blackview",
    "BQ",
    "CAT",
    "Compaq",
    "Dell",
    "Doogee",
    "Elephone",
    "Facitel",
    "Garmin",
    "Google",
    "Honor",
    "HP",
    "Huawei",
    "Insys",
    "Lenovo",
    "LG",
    "MEO",
    "Meizu",
    "Microsoft",
    "Motorola",
    "MSI",
    "Nokia",
    "NOS",
    "OnePlus",
    "Oppo",
    "Qilive",
    "Qubo",
    "Realme",
    "Samsung",
    "Sony",
    "SPC",
    "Sunstech",
    "TCL",
    "TomTom",
    "Toshiba",
    "UMI",
    "Umidigi",
    "Vivo",
    "Vodafone",
    "Wiko",
    "Xiaomi",
    "ZTE",
  ].map((name) => [name.toLowerCase(), name])
);

/** Product-line words → maker; the model keeps the whole text. */
const PRODUCT_LINES: Record<string, string> = {
  galaxy: "Samsung",
  imac: "Apple",
  ipad: "Apple",
  iphone: "Apple",
  ipod: "Apple",
  macbook: "Apple",
  mate: "Huawei",
  mi: "Xiaomi",
  neffos: "TP-Link",
  nova: "Huawei",
  playstation: "Sony",
  poco: "Xiaomi",
  ps4: "Sony",
  ps5: "Sony",
  psmart: "Huawei",
  redmi: "Xiaomi",
  vdf: "Vodafone",
};

export function splitBrandModel(raw: string): { brand: string; model: string } {
  const text = raw.replace(SPACES_RE, " ").trim();
  if (!text) {
    return { brand: GENERIC_BRAND, model: EMPTY_MODEL };
  }
  const [first = "", ...rest] = text.split(" ");
  const word = first.toLowerCase();

  const brand = BRAND_NAMES[word];
  if (brand) {
    return { brand, model: rest.join(" ") || text };
  }
  const maker =
    PRODUCT_LINES[word] ??
    (HUAWEI_P_SERIES_RE.test(word) ? "Huawei" : undefined) ??
    (SAMSUNG_SERIES_RE.test(word) ? "Samsung" : undefined);
  if (maker) {
    return { brand: maker, model: text };
  }
  return { brand: GENERIC_BRAND, model: text };
}
