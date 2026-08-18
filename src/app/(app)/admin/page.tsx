import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarData } from "@/lib/format";
import { perfilAtual } from "@/lib/auth";
import { ImportForm } from "./import-form";
import { ExcluirImportacao } from "./excluir-import";
import { KanbanConfig, type PipelineComEtapas } from "./kanban-config";
import { Usuarios, type UsuarioLinha } from "./usuarios";
import { ChatwootImport } from "./chatwoot-import";
import { HistoricoImport } from "./historico-import";
import { importarClientes, importarLeads, importarLotes } from "./actions";

export const metadata: Metadata = { title: "Administração · Zeve CRM" };

type Importacao = {
  id: string;
  tipo: "clientes" | "lotes" | "leads";
  arquivo_nome: string | null;
  referencia_data: string;
  status: "processando" | "concluida" | "falhou";
  total_linhas: number;
  linhas_ok: number;
  linhas_erro: number;
  criado_em: string;
  autor: { nome: string } | null;
};

const ROTULO_STATUS: Record<Importacao["status"], string> = {
  processando: "Processando",
  concluida: "Concluída",
  falhou: "Falhou",
};

function StatusEnv({ definido }: { definido: boolean }) {
  return (
    <span
      className={
        definido
          ? "inline-flex h-[20px] items-center rounded-sm bg-success-bg px-1 text-xs text-success"
          : "inline-flex h-[20px] items-center rounded-sm bg-warning-bg px-1 text-xs text-warning"
      }
    >
      {definido ? "configurado" : "pendente"}
    </span>
  );
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/atendimento");
  }

  const params = await searchParams;
  const aviso = typeof params.aviso === "string" ? params.aviso : null;

  const supabase = await createClient();

  const [
    { data: importacoes },
    { data: pipelinesBrutos },
    { data: etapas },
    { data: usuarios },
    { data: instancias },
  ] = await Promise.all([
    supabase
      .from("imports")
      .select(
        "id, tipo, arquivo_nome, referencia_data, status, total_linhas, linhas_ok, linhas_erro, criado_em, autor:profiles(nome)",
      )
      .order("criado_em", { ascending: false })
      .limit(20),
    supabase
      .from("pipelines")
      .select("id, nome, padrao")
      .order("criado_em"),
    supabase
      .from("pipeline_stages")
      .select("id, nome, ordem, is_final, pipeline_id")
      .order("ordem"),
    supabase
      .from("profiles")
      .select("id, nome, email, papel, ativo")
      .order("nome"),
    supabase
      .from("whatsapp_instances")
      .select("id, nome, meta_phone_number_id")
      .order("nome"),
  ]);

  // Quantos leads em cada etapa (trava a exclusão de etapa em uso).
  const contagens = new Map<string, number>();
  await Promise.all(
    (etapas ?? []).map(async (e: { id: string }) => {
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("stage_id", e.id);
      contagens.set(e.id, count ?? 0);
    }),
  );

  const pipelines: PipelineComEtapas[] = (
    (pipelinesBrutos ?? []) as { id: string; nome: string; padrao: boolean }[]
  ).map((p) => ({
    ...p,
    etapas: (
      (etapas ?? []) as {
        id: string;
        nome: string;
        ordem: number;
        is_final: boolean;
        pipeline_id: string;
      }[]
    )
      .filter((e) => e.pipeline_id === p.id)
      .map((e) => ({ ...e, leads: contagens.get(e.id) ?? 0 })),
  }));

  const historico = (importacoes ?? []) as unknown as Importacao[];

  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Administração</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          Importações, kanbans e etapas do atendimento. Usuários e webhook da
          Meta entram em seguida.
        </p>
      </header>

      {aviso ? (
        <p
          role="alert"
          className="mt-2 max-w-[68ch] rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning"
        >
          {aviso}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ImportForm
          titulo="Base de clientes"
          descricao="Sobe ou atualiza a base. Aceita o diversificador da corretora direto: as contas da mesma pessoa são agrupadas pelo CPF, e a situação da conta define quem está ativo."
          colunas="colunas: nome + conta e/ou telefone · opcionais: cpf_cnpj, email, data_habilitacao"
          acao={importarClientes}
          rotulo="Importar clientes"
        />

        <ImportForm
          titulo="Lotes do dia"
          descricao="Aceita o modelo de contratos direto (uma linha por ativo — o sistema soma por conta e dia). Depois de gravar, a reativação roda sozinha: queda acima do limite ou falta de giro devolve o cliente para a fila."
          colunas="colunas: conta + lotes operados · opcional: data"
          acao={importarLotes}
          comData
          rotulo="Importar lotes"
        />

        <ImportForm
          titulo="Lista de leads"
          descricao="Sobe a lista de uma campanha (Google Sheets exportado em CSV). Todo mundo ganha a etiqueta da campanha automaticamente. Telefone repetido não vira lead duplicado: quem já existe só recebe a etiqueta. Quem já é cliente entra vinculado."
          colunas="colunas: telefone · opcionais: nome, email, campanha"
          acao={importarLeads}
          extras={
            <>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="etiqueta-leads"
                  className="text-sm font-medium text-neutral-800"
                >
                  Etiqueta da lista (opcional)
                </label>
                <input
                  id="etiqueta-leads"
                  name="etiqueta"
                  type="text"
                  placeholder="Comunidade Instagram"
                  className="h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-base text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                />
                <p className="text-xs text-neutral-600">
                  Todo lead importado sai com etiqueta — é por ela que a
                  campanha encontra o público. Em branco, o CRM usa a coluna
                  “campanha” da planilha e, na falta dela, o nome do arquivo.
                </p>
              </div>

              <label className="flex min-h-[40px] items-center gap-1 text-sm text-neutral-800">
                <input
                  name="distribuir"
                  type="checkbox"
                  defaultChecked
                  className="h-[16px] w-[16px] accent-primary-600"
                />
                Dividir a lista entre a equipe
              </label>
            </>
          }
          rotulo="Importar leads"
        />
      </div>

      {perfil.papel === "admin" ? (
        <Usuarios
          usuarios={(usuarios ?? []) as UsuarioLinha[]}
          meuId={perfil.id}
        />
      ) : null}

      <KanbanConfig pipelines={pipelines} />

      {/* Chatwoot */}
      <section className="mt-3" aria-labelledby="chatwoot-titulo">
        <h2 id="chatwoot-titulo" className="text-h3 text-neutral-900">
          Chatwoot
        </h2>
        <div className="mt-2 max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          <p className="text-sm text-neutral-600">
            Importa as conversas do WhatsApp como leads: telefone cruzado com a
            base, agente vira responsável (pelo e-mail), labels viram tags e a
            conversa fica vinculada para o envio de mensagens pelo CRM.
          </p>
          <div className="mt-2 flex flex-col gap-1">
            <ChatwootImport
              configurado={Boolean(
                process.env.CHATWOOT_BASE_URL &&
                  process.env.CHATWOOT_ACCOUNT_ID &&
                  process.env.CHATWOOT_API_TOKEN,
              )}
            />
            <HistoricoImport />
            <p className="text-xs text-neutral-600">
              O histórico traz as mensagens antigas das conversas já vinculadas
              (com data original e anexos). Rode primeiro a importação de
              conversas.
            </p>
          </div>

          <dl className="mt-2 divide-y divide-neutral-200 border-t border-neutral-200">
            <div className="flex items-baseline justify-between gap-2 py-1">
              <dt className="text-sm text-neutral-600">Webhook de entrada</dt>
              <dd className="font-mono text-sm break-all text-neutral-800">
                /api/webhooks/chatwoot?token=…
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 py-1">
              <dt className="text-sm text-neutral-600">Token do webhook</dt>
              <dd>
                <StatusEnv definido={Boolean(process.env.CHATWOOT_WEBHOOK_TOKEN)} />
              </dd>
            </div>
          </dl>
          <p className="mt-1 text-xs text-neutral-600">
            No Chatwoot: Configurações → Integrações → Webhooks → adicionar a
            URL pública acima (com o token do .env.local) assinando o evento{" "}
            <code className="font-mono">message_created</code>. Mensagem recebida
            vira lead/interação aqui na hora.
          </p>
        </div>
      </section>

      {/* Webhook da Meta */}
      <section className="mt-3" aria-labelledby="webhook-titulo">
        <h2 id="webhook-titulo" className="text-h3 text-neutral-900">
          Webhook do WhatsApp (Meta)
        </h2>
        <div className="mt-2 max-w-[68ch] rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm">
          <dl className="divide-y divide-neutral-200">
            <div className="flex items-baseline justify-between gap-2 py-1">
              <dt className="text-sm text-neutral-600">Endpoint</dt>
              <dd className="font-mono text-sm text-neutral-800">
                /api/webhooks/meta
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 py-1">
              <dt className="text-sm text-neutral-600">Token de verificação</dt>
              <dd>
                <StatusEnv definido={Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN)} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 py-1">
              <dt className="text-sm text-neutral-600">
                App secret (assinatura dos eventos)
              </dt>
              <dd>
                <StatusEnv definido={Boolean(process.env.META_APP_SECRET)} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 py-1">
              <dt className="text-sm text-neutral-600">
                Instâncias com phone_number_id
              </dt>
              <dd className="font-mono text-sm text-neutral-800 tabular-nums">
                {
                  ((instancias ?? []) as { meta_phone_number_id: string | null }[]).filter(
                    (i) => i.meta_phone_number_id,
                  ).length
                }
                /{(instancias ?? []).length}
              </dd>
            </div>
          </dl>

          <ol className="mt-2 flex flex-col gap-0.5 border-t border-neutral-200 pt-2 text-sm text-neutral-600">
            <li>
              1. Preencha META_WEBHOOK_VERIFY_TOKEN (frase à sua escolha) e
              META_APP_SECRET no ambiente e reinicie.
            </li>
            <li>
              2. No painel Meta for Developers, configure o webhook do WhatsApp
              apontando para o endpoint acima (URL pública + o token).
            </li>
            <li>
              3. Assine o campo <code className="font-mono text-xs">messages</code>.
            </li>
            <li>
              4. Em Configurações, preencha o phone_number_id de cada instância
              — é ele que define o vendedor do lead que chega.
            </li>
          </ol>
        </div>
      </section>

      <section className="mt-3">
        <h2 className="text-h3 text-neutral-900">Últimas importações</h2>

        {historico.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            Nenhuma importação ainda.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th scope="col" className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Arquivo
                  </th>
                  <th scope="col" className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Tipo
                  </th>
                  <th scope="col" className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Status
                  </th>
                  <th scope="col" className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Linhas
                  </th>
                  <th scope="col" className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Referência
                  </th>
                  <th scope="col" className="px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    Por
                  </th>
                  <th scope="col" className="px-2 py-1 text-right text-xs tracking-[0.06em] text-neutral-600 uppercase">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {historico.map((imp) => (
                  <tr key={imp.id} className="h-[48px] hover:bg-neutral-50">
                    <td className="max-w-[240px] truncate px-2 text-sm text-neutral-800">
                      {imp.arquivo_nome ?? "—"}
                    </td>
                    <td className="px-2 text-sm text-neutral-600 capitalize">
                      {imp.tipo}
                    </td>
                    <td className="px-2">
                      <span
                        className={
                          imp.status === "concluida"
                            ? "inline-flex h-[20px] items-center rounded-sm bg-success-bg px-1 text-xs text-success"
                            : imp.status === "falhou"
                              ? "inline-flex h-[20px] items-center rounded-sm bg-danger-bg px-1 text-xs text-danger"
                              : "inline-flex h-[20px] items-center rounded-sm bg-warning-bg px-1 text-xs text-warning"
                        }
                      >
                        {ROTULO_STATUS[imp.status]}
                      </span>
                    </td>
                    <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                      {imp.linhas_ok}/{imp.total_linhas}
                      {imp.linhas_erro > 0 ? (
                        <span className="text-warning"> · {imp.linhas_erro} erro(s)</span>
                      ) : null}
                    </td>
                    <td className="px-2 text-right font-mono text-sm text-neutral-600 tabular-nums">
                      {formatarData(imp.referencia_data)}
                    </td>
                    <td className="px-2 text-sm text-neutral-600">
                      {imp.autor?.nome ?? "—"}
                    </td>
                    <td className="px-2 text-right">
                      <ExcluirImportacao
                        importId={imp.id}
                        tipo={imp.tipo}
                        arquivo={imp.arquivo_nome ?? "sem nome"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
