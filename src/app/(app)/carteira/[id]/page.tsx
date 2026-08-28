import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { formatarData, formatarReais, formatarTelefone } from "@/lib/format";
import { CAMPO } from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import { salvarFichaCliente } from "../actions";
import { AbrirConversa } from "../abrir-conversa";

export const metadata: Metadata = { title: "Cliente · Zeve CRM" };

const ROTULO_STATUS: Record<string, { texto: string; classe: string }> = {
  ativo: { texto: "Ativo", classe: "bg-success-bg text-success" },
  em_risco: { texto: "Em risco", classe: "bg-warning-bg text-warning" },
  reativado: { texto: "Reativado", classe: "bg-info-bg text-info" },
  churn: { texto: "Churn", classe: "bg-danger-bg text-danger" },
};

export default async function ClientePage({
  params,
  searchParams,
}: PageProps<"/carteira/[id]">) {
  const { id } = await params;
  const busca = await searchParams;
  const aviso = typeof busca.aviso === "string" ? busca.aviso : null;

  const perfil = await perfilAtual();
  const ehGestor = perfil?.papel === "admin" || perfil?.papel === "gestor";
  const supabase = await createClient();

  const [{ data: cliente }, { data: giro }, { data: contas }, { data: equipe }] =
    await Promise.all([
      supabase
        .from("customers")
        .select(
          "id, nome_completo, telefone_e164, documento, email, conta_aberta_em, ativo, status, segmento, responsavel_id, churned_em",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("v_carteira")
        .select(
          "lotes_30d, lotes_30d_anterior, ultimo_giro_em, dias_sem_giro, receita_30d_centavos, ltv_centavos, lead_id",
        )
        .eq("customer_id", id)
        .maybeSingle(),
      supabase.from("customer_accounts").select("conta").eq("customer_id", id),
      supabase
        .from("profiles")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome"),
    ]);

  if (!cliente) notFound();

  // Ficha 360 (6.2): cliente com atendimento tem UMA ficha só — a do lead,
  // aba Cliente. Esta tela fica para o cliente sem lead (importado da
  // corretora e nunca atendido) e para o inativo fora da v_carteira.
  if (giro?.lead_id) {
    redirect(
      `/leads/${giro.lead_id}?aba=cliente${
        aviso ? `&aviso=${encodeURIComponent(aviso)}` : ""
      }`,
    );
  }

  const status = ROTULO_STATUS[cliente.status as string] ?? {
    texto: cliente.status,
    classe: "bg-neutral-100 text-neutral-600",
  };
  const variacao =
    giro?.lotes_30d != null &&
    giro?.lotes_30d_anterior != null &&
    giro.lotes_30d_anterior > 0
      ? Math.round(
          ((giro.lotes_30d - giro.lotes_30d_anterior) / giro.lotes_30d_anterior) *
            100,
        )
      : null;

  const numero = (n: number) => n.toLocaleString("pt-BR");

  return (
    <div className="flex min-h-full flex-col p-2 md:p-3">
      <div className="flex items-center gap-1">
        <Link
          href="/carteira"
          aria-label="Voltar para a carteira"
          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <ArrowLeft size={18} strokeWidth={1.5} aria-hidden />
        </Link>
        <span className="text-sm text-neutral-600">Carteira</span>
      </div>

      <header className="mt-1 flex flex-wrap items-start justify-between gap-2 border-b border-neutral-200 pb-2">
        <div className="min-w-0">
          <h1 className="text-h1 text-neutral-900">{cliente.nome_completo}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-neutral-600">
            <span
              className={cn(
                "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                status.classe,
              )}
            >
              {status.texto}
            </span>
            {cliente.segmento ? (
              <span className="capitalize">{cliente.segmento}</span>
            ) : null}
            <span className="font-mono tabular-nums">
              {cliente.telefone_e164
                ? formatarTelefone(cliente.telefone_e164)
                : "sem telefone"}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1">
          {/* Quem tem lead_id já foi redirecionado acima para a ficha 360 —
              aqui só chega cliente sem atendimento, então a única ação
              possível é iniciar a conversa (e só com telefone no cadastro). */}
          {cliente.telefone_e164 ? (
            <AbrirConversa
              customerId={cliente.id}
              nome={cliente.nome_completo}
            />
          ) : null}
        </div>
      </header>

      {aviso ? (
        <p
          role="status"
          className="mt-2 max-w-[68ch] rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-1 text-sm text-neutral-800"
        >
          {aviso}
        </p>
      ) : null}

      {!cliente.telefone_e164 ? (
        <p className="mt-2 max-w-[68ch] rounded-md border border-warning bg-warning-bg px-1.5 py-1 text-sm text-warning">
          <strong className="font-medium">Sem telefone no cadastro.</strong>{" "}
          Preencha abaixo para conseguir falar com este cliente pelo WhatsApp —
          ao salvar, o CRM já liga a conversa que existir com esse número.
        </p>
      ) : null}

      <dl className="mt-3 grid gap-3 border-b border-neutral-200 pb-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
            Lotes (30d)
          </dt>
          <dd className="font-mono text-h2 text-neutral-800 tabular-nums">
            {numero(giro?.lotes_30d ?? 0)}
            {variacao !== null ? (
              <span
                className={cn(
                  "ml-0.5 text-sm",
                  variacao < 0 ? "text-danger" : "text-success",
                )}
              >
                {variacao > 0 ? `+${variacao}%` : `${variacao}%`}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
            Receita (30d)
          </dt>
          <dd className="font-mono text-h2 text-neutral-800 tabular-nums">
            {formatarReais(giro?.receita_30d_centavos ?? 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
            LTV
          </dt>
          <dd className="font-mono text-h2 text-neutral-800 tabular-nums">
            {formatarReais(giro?.ltv_centavos ?? 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-[0.06em] text-neutral-600 uppercase">
            Último giro
          </dt>
          <dd className="font-mono text-h2 text-neutral-800 tabular-nums">
            {giro?.ultimo_giro_em
              ? formatarData(giro.ultimo_giro_em)
              : "nunca"}
          </dd>
          {giro?.dias_sem_giro != null ? (
            <dd className="text-xs text-neutral-600">
              há {giro.dias_sem_giro} dia(s)
            </dd>
          ) : null}
        </div>
      </dl>

      <div className="mt-3 grid items-start gap-3 lg:grid-cols-[1fr_280px]">
        <section aria-labelledby="ficha-titulo">
          <h2 id="ficha-titulo" className="text-h3 text-neutral-900">
            Ficha do cliente
          </h2>

          {!ehGestor ? (
            <p className="mt-1 text-sm text-neutral-600">
              Só gestor ou admin edita a ficha.
            </p>
          ) : (
            <form
              action={salvarFichaCliente}
              className="mt-2 flex max-w-[560px] flex-col gap-2"
            >
              <input type="hidden" name="customer_id" value={cliente.id} />
              {/* Intocado, o telefone fica fora do update (número fora do
                  padrão BR não pode ser regravado nem travar a ficha). */}
              <input
                type="hidden"
                name="telefone_original"
                value={cliente.telefone_e164 ?? ""}
              />

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="nome_completo"
                  className="text-sm font-medium text-neutral-800"
                >
                  Nome
                </label>
                <input
                  id="nome_completo"
                  name="nome_completo"
                  required
                  defaultValue={cliente.nome_completo}
                  className={CAMPO}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="telefone"
                  className="text-sm font-medium text-neutral-800"
                >
                  Telefone (WhatsApp)
                </label>
                <input
                  id="telefone"
                  name="telefone"
                  inputMode="tel"
                  placeholder="62 98181-0004"
                  defaultValue={
                    cliente.telefone_e164
                      ? formatarTelefone(cliente.telefone_e164)
                      : ""
                  }
                  className={CAMPO}
                />
                <p className="text-xs text-neutral-600">
                  Com DDD. É por ele que o CRM encontra a conversa do WhatsApp.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="documento"
                    className="text-sm font-medium text-neutral-800"
                  >
                    CPF/CNPJ
                  </label>
                  <input
                    id="documento"
                    name="documento"
                    inputMode="numeric"
                    defaultValue={cliente.documento ?? ""}
                    className={cn(CAMPO, "font-mono tabular-nums")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-neutral-800"
                  >
                    E-mail
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={cliente.email ?? ""}
                    className={CAMPO}
                  />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="conta_aberta_em"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Conta aberta em
                  </label>
                  <input
                    id="conta_aberta_em"
                    name="conta_aberta_em"
                    type="date"
                    defaultValue={cliente.conta_aberta_em ?? ""}
                    className={cn(CAMPO, "font-mono tabular-nums")}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="responsavel_id"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Assessor
                  </label>
                  <select
                    id="responsavel_id"
                    name="responsavel_id"
                    defaultValue={cliente.responsavel_id ?? ""}
                    className={CAMPO}
                  >
                    <option value="">Sem dono</option>
                    {/* Assessor desativado segue como opção: sem ela o
                        select cai em "Sem dono" e qualquer save removeria
                        o dono sem ninguém pedir. */}
                    {cliente.responsavel_id &&
                    !((equipe ?? []) as { id: string }[]).some(
                      (p) => p.id === cliente.responsavel_id,
                    ) ? (
                      <option value={cliente.responsavel_id}>
                        Assessor atual (desativado)
                      </option>
                    ) : null}
                    {((equipe ?? []) as { id: string; nome: string }[]).map(
                      (p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="situacao"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Situação
                  </label>
                  <select
                    id="situacao"
                    name="situacao"
                    defaultValue={cliente.ativo ? "ativa" : "inativa"}
                    className={CAMPO}
                  >
                    <option value="ativa">Conta ativa</option>
                    <option value="inativa">Conta encerrada</option>
                  </select>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  className="inline-flex h-[40px] items-center rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  Salvar ficha
                </button>
              </div>
            </form>
          )}
        </section>

        <section aria-labelledby="contas-titulo">
          <h2 id="contas-titulo" className="text-h3 text-neutral-900">
            Contas na corretora
          </h2>
          {((contas ?? []) as { conta: string }[]).length === 0 ? (
            <p className="mt-1 text-sm text-neutral-600">
              Nenhuma conta vinculada.
            </p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-0.5">
              {((contas ?? []) as { conta: string }[]).map((c) => (
                <li
                  key={c.conta}
                  className="inline-flex h-[24px] items-center rounded-sm bg-neutral-100 px-1 font-mono text-xs text-neutral-800 tabular-nums"
                >
                  {c.conta}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-neutral-600">
            As contas vêm da importação da corretora e ligam os lotes a este
            cliente.
          </p>
        </section>
      </div>
    </div>
  );
}
