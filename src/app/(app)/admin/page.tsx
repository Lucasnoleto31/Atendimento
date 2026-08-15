import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { ImportForm } from "./import-form";
import { importarClientes, importarLotes } from "./actions";

export const metadata: Metadata = { title: "Administração · Zeve CRM" };

type Importacao = {
  id: string;
  tipo: "clientes" | "lotes";
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

export default async function AdminPage() {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/atendimento");
  }

  const supabase = await createClient();
  const { data: importacoes } = await supabase
    .from("imports")
    .select(
      "id, tipo, arquivo_nome, referencia_data, status, total_linhas, linhas_ok, linhas_erro, criado_em, autor:profiles(nome)",
    )
    .order("criado_em", { ascending: false })
    .limit(20);

  const historico = (importacoes ?? []) as unknown as Importacao[];

  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Administração</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          Importações da base de clientes e dos lotes diários. Usuários e
          webhook da Meta entram em seguida.
        </p>
      </header>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ImportForm
          titulo="Base de clientes"
          descricao="Sobe ou atualiza a base. Aceita a planilha da corretora (CONTA SINACOR + NOME) ou um arquivo com telefone. Cliente com várias contas é agrupado pelo nome."
          colunas="colunas: nome + conta e/ou telefone · opcionais: documento, email, data_abertura"
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
      </div>

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
                      {new Date(`${imp.referencia_data}T12:00:00`).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-2 text-sm text-neutral-600">
                      {imp.autor?.nome ?? "—"}
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
