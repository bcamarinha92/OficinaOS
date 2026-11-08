# Migrar do FixBook (hdt_prod)

Comando próprio do ramo `hdt`: lê um `mysqldump` da base do FixBook e cria
os clientes e as reparações no OficinaOS. O MySQL do FixBook nunca é
contactado nem alterado.

## Uso

```bash
# 1. Simulação — mostra o plano e as contagens, não escreve nada
bun run migrate-fixbook -- --dump /caminho/hdt.sql

# 2. Migração — escreve na base de DATABASE_URL e verifica no fim
bun run migrate-fixbook -- --dump /caminho/hdt.sql --confirm
```

Num servidor com Docker, copia o dump para dentro do contentor da app (e
apaga-o no fim) ou monta a pasta só de leitura.

- O output tem só contagens e totais em euros — nunca nomes, telefones ou
  notas.
- O código de saída é 1 se a verificação final não bater com o plano.
- Antes de escrever, mostra o nome da base de destino (nunca o URL).
- Pode correr várias vezes: reparações já migradas (`externalRef`
  `FB-<id>`) são saltadas e clientes com o mesmo telefone são reaproveitados
  — só os campos vazios são preenchidos e as notas do FixBook ficam por baixo
  das da equipa, depois de "— FixBook —", uma única vez. Para a migração
  final, usa uma base nova.
- A verificação final só vale logo a seguir à migração: alterações feitas
  depois no OficinaOS (estado, preços) aparecem como diferenças.
- Não envia notificações, não cria tarefas e não regista pagamentos.

## O que acontece aos dados

| FixBook | OficinaOS |
|---|---|
| Fichas com o mesmo telefone (ignorando espaços e +351) **e** o mesmo nome (ignorando maiúsculas e acentos) | Um só cliente, com os dados da ficha mais recente e as notas de todas |
| Pessoas diferentes com o mesmo telefone | Clientes separados: quem está na ficha mais recente fica com o número; os outros ficam com `sem-telefone-…` e o número nas notas ("Telefone partilhado com outra ficha") |
| Nome + apelido, NIF (`vat`, senão `cf`), morada, cidade, comentários | `name`, `taxId`, `address`, `city`, `notes` |
| Email inválido | Passa para as notas do cliente |
| Telefone inválido ou de enchimento (`n/a`, `000000000`, `900000000` — até 2 dígitos distintos) | Nunca é fundido; o cliente fica com `sem-telefone-…` e o texto antigo vai para as notas |
| Reparação com a ficha de cliente apagada | Associada ao dono do telefone se o nome for igual; senão, cliente criado a partir do nome e telefone da reparação |
| `ID` | `externalRef` = `FB-<ID>` |
| `codice` | Código de acompanhamento (repetidos ganham `-2`, `-3`…) |
| Categoria + Modelo (texto livre) | Equipamento com marca separada; sem marca reconhecida → "Outra" |
| Avaria (vazia → "Sem descrição (FixBook)") | Problema reportado |
| Campo "Danos" | Estado do equipamento (`conditionNotes`) |
| Comentários, Peça, "Encomenda", "Sem reparação" | Uma nota interna |
| Preço (> 0) | Linha de reparação "Reparação (histórico)" |
| Sinal (> 0) | Sinal |
| Data de abertura / de fecho (hora de Lisboa) | Data de criação / entrega no histórico (só nas entregues) |

Estados: Diagnóstico → Receção; Em Reparação → Em reparação; Pendente Peças
e Encomendar → À espera de peças; Pendente Cliente e Externo → Em espera
(com o motivo); Para Entrega e Sem Reparação → Pronto; Entregue → Entregue;
Recusado → Cancelado. O nome original fica como estado de acompanhamento
"FixBook: …" em cada reparação.

As notas, as linhas de reparação e o histórico ficam assinados pelo
utilizador `fixbook-import` ("FixBook (importação)"), inativo e sem
palavra-passe — não consegue entrar na app.

Como não há pagamentos migrados, as reparações entregues com preço mostram
saldo em dívida e o histórico não entra nos relatórios de receita (decisão
da loja).
