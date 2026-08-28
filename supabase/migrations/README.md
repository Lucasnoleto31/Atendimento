# Migrações — regras da casa

O banco de produção é atualizado colando cada arquivo no SQL Editor do
Supabase, em ordem alfabética de nome. Até existir controle por ferramenta
(supabase CLI), estas regras evitam os acidentes que já aconteceram:

1. **Nunca edite um arquivo já aplicado.** Correção é migração nova.
2. **Número novo, sempre.** Os pares duplicados históricos (0018/0018a,
   0031/0031a, 0032/0032a, 0034/0034a) foram renomeados com sufixo "a"
   preservando a ordem alfabética de aplicação — não repita o padrão.
3. **Todo script é reexecutável** (`if not exists`, `create or replace`,
   `on conflict`). Rodar duas vezes não pode quebrar nada.
4. **Setting nova nasce em migração**, nunca por insert manual — um banco
   reconstruído tem que se comportar igual ao de produção.
5. **Gatilhos de `leads` têm fila numerada** (`leads_t01_…` a `leads_t08_`,
   migração 0043). Gatilho novo ali OBRIGA a escolher um número — o número
   diz onde ele entra na ordem, e a ordem é semântica (vincular antes de
   marcar ganho; espelho antes do stage_change).
6. **Função grande tem dono**: `gerar_leads_reativacao`, `relatorio_leads`,
   `v_leads_listas` e afins são recriadas por cópia integral. Ao mexer,
   parta SEMPRE da última migração que as define (grep pelo nome) e mude o
   mínimo — o diff da migração deve contar a mudança real.

## Adotar o supabase CLI (quando houver disposição)

```bash
npm i -D supabase
npx supabase login          # pede access token do painel
npx supabase link --project-ref <ref do projeto>
npx supabase migration repair --status applied 0001..0044
```

A partir daí, `npx supabase db push` aplica o que faltar e mantém a tabela
de controle — e o SQL Editor deixa de ser o caminho.
