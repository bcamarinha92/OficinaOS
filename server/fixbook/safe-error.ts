/**
 * Error for the migration's output without personal data. Prisma's
 * messages can embed the values being written (name, phone, notes), so
 * only a fixed context and the error code survive.
 */
export function safeFailure(context: string, error: unknown): Error {
  let code = "erro";
  if (error && typeof error === "object" && "code" in error) {
    code = String((error as { code: unknown }).code);
  } else if (error instanceof Error) {
    code = error.name;
  }
  return new Error(`${context} (${code})`);
}
