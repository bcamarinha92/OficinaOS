-- Morada, localidade e notas internas do cliente (opcionais). Necessárias
-- para importar fichas de sistemas antigos que as guardavam; só a equipa as
-- vê — nunca aparecem no acompanhamento público nem nos talões.
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "address" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "city" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "notes" TEXT;
