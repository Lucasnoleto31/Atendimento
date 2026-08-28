"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckSquare, MessageSquare, Square, Tag, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarData, formatarReais, formatarTelefone } from "@/lib/format";
import type { TemplateWhatsapp } from "@/lib/chatwoot";
import { AbrirConversa } from "./abrir-conversa";
import {
  dispararTemplateEmMassa,
  etiquetarClientesEmMassa,
  etiquetarPorFiltroCarteira,
  type FiltroCarteira,
  type ResultadoMassa,
} from "./massa";

export type LinhaCarteira = {
  customer_id: string;
  nome_completo: string;
  status: string;
  segmento: string | null;
  conta_aberta_em: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  lotes_30d: number | null;
  lotes_30d_anterior: number | null;
  ultimo_giro_em: string | null;
  dias_sem_giro: number | null;
  receita_30d_centavos: number | null;
  ltv_centavos: number | null;
  lead_id: string | null;
  telefone_e164: string | null;
  telefone_cliente?: string | null;
  dias_sem_contato: number | null;
};

const ROTULO_STATUS: Record<string, { texto: string; classe: string }> = {
  ativo: { texto: "Ativo", classe: "bg-success-bg text-success" },
  em_risco: { texto: "Em risco", classe: "bg-warning-bg text-warning" },
  reativado: { texto: "Reativado", classe: "bg-info-bg text-info" },
  churn: { texto: "Churn", classe: "bg-danger-bg text-danger" },
};

const BOTAO_BARRA =
  "inline-flex h-[32px] items-center gap-0.5 rounded-md px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-400";

const CAMPO =
  "h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";

/**
 * "Sem contato há 0d" não quer dizer nada para quem acabou de mandar
 * mensagem. Em dias recentes a tela fala como a equipe fala.
 */
function ultimoContato(dias: number | null): string {
  if (dias === null) return "nunca";
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias}d`;
}

export function TabelaCarteira({
  linhas,
  temReceita,
  etiquetas,
  templates,
  total,
  filtro,
}: {
  linhas: LinhaCarteira[];
  temReceita: boolean;
  etiquetas: { id: string; nome: string }[];
  templates: TemplateWhatsapp[];
  /** Quantos clientes o filtro atual tem ao todo, não só nesta página. */
  total: number;
  filtro: FiltroCarteira;
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  // Lista como "os 1159 em churn" não cabe numa seleção de 100 por página:
  // este modo manda o FILTRO para o servidor em vez dos ids marcados.
  const [filtroInteiro, setFiltroInteiro] = useState(false);
  const [painel, setPainel] = useState<"etiqueta" | "template" | null>(null);
  const [pendente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoMassa | null>(null);

  // Etiquetar
  const [tagEscolhida, setTagEscolhida] = useState("");
  const [tagNova, setTagNova] = useState("");

  // Disparar template
  const [indiceTemplate, setIndiceTemplate] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});

  const ids = [...marcados];
  const todosMarcados = linhas.length > 0 && marcados.size === linhas.length;
  const temMaisForaDaPagina = total > linhas.length;
  const quantidade = filtroInteiro ? total : marcados.size;
  const template =
    indiceTemplate === "" ? null : (templates[Number(indiceTemplate)] ?? null);

  const alternar = (id: string) => {
    setFiltroInteiro(false);
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const marcarPagina = (marcar: boolean) => {
    setFiltroInteiro(false);
    setMarcados(marcar ? new Set(linhas.map((l) => l.customer_id)) : new Set());
  };

  const fechar = () => {
    setPainel(null);
    setTagNova("");
    setTagEscolhida("");
    setIndiceTemplate("");
    setValores({});
  };

  const executar = (acao: () => Promise<ResultadoMassa>) => {
    setResultado(null);
    iniciar(async () => {
      const r = await acao();
      setResultado(r);
      if (r.ok) {
        setMarcados(new Set());
        setFiltroInteiro(false);
        fechar();
      }
    });
  };

  return (
    <>
      {marcados.size > 0 ? (
        <div className="mt-2 rounded-lg border border-primary-500 bg-primary-50 p-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => marcarPagina(!todosMarcados)}
              className="inline-flex h-[32px] items-center gap-0.5 rounded-md px-1 text-sm font-medium text-primary-900 transition-colors duration-[120ms] hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              {todosMarcados ? (
                <CheckSquare size={14} strokeWidth={1.5} aria-hidden />
              ) : (
                <Square size={14} strokeWidth={1.5} aria-hidden />
              )}
              {quantidade} selecionado(s)
            </button>

            <span aria-hidden className="text-neutral-300">
              ·
            </span>

            <button
              type="button"
              disabled={pendente}
              onClick={() => {
                setResultado(null);
                setPainel(painel === "etiqueta" ? null : "etiqueta");
              }}
              className={BOTAO_BARRA}
              title="Marcar uma etiqueta nos selecionados — é assim que nasce o público de uma campanha"
            >
              <Tag size={14} strokeWidth={1.5} aria-hidden />
              Etiquetar para campanha
            </button>

            {templates.length > 0 && !filtroInteiro ? (
              <button
                type="button"
                disabled={pendente}
                onClick={() => {
                  setResultado(null);
                  setPainel(painel === "template" ? null : "template");
                }}
                className={BOTAO_BARRA}
                title="Enviar agora o mesmo template aprovado para os selecionados"
              >
                <MessageSquare size={14} strokeWidth={1.5} aria-hidden />
                Disparar template
              </button>
            ) : null}

            <button
              type="button"
              aria-label="Limpar seleção"
              onClick={() => {
                setFiltroInteiro(false);
                setMarcados(new Set());
                fechar();
              }}
              className="ml-auto inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-primary-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <X size={16} strokeWidth={1.5} aria-hidden />
            </button>
          </div>

          {todosMarcados && temMaisForaDaPagina ? (
            <p className="mt-1 border-t border-primary-500/30 pt-1 text-sm text-primary-900">
              {filtroInteiro ? (
                <>
                  Os <strong className="font-medium">{total}</strong> clientes
                  do filtro estão selecionados.{" "}
                  <button
                    type="button"
                    onClick={() => setFiltroInteiro(false)}
                    className="rounded-sm font-medium underline underline-offset-2 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    Voltar para só os {linhas.length} desta página
                  </button>
                </>
              ) : (
                <>
                  Os {linhas.length} desta página estão marcados.{" "}
                  <button
                    type="button"
                    onClick={() => setFiltroInteiro(true)}
                    className="rounded-sm font-medium underline underline-offset-2 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    Selecionar os {total} do filtro inteiro
                  </button>
                </>
              )}
            </p>
          ) : null}

          {painel === "etiqueta" ? (
            <div className="mt-1.5 grid gap-1 border-t border-primary-500/30 pt-1.5 sm:grid-cols-[1fr_1fr_auto]">
              <label className="block">
                <span className="mb-0.5 block text-xs text-neutral-600">
                  Etiqueta existente
                </span>
                <select
                  value={tagEscolhida}
                  onChange={(e) => {
                    setTagEscolhida(e.target.value);
                    if (e.target.value) setTagNova("");
                  }}
                  className={CAMPO}
                >
                  <option value="">Escolher…</option>
                  {etiquetas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-0.5 block text-xs text-neutral-600">
                  …ou criar uma nova
                </span>
                <input
                  type="text"
                  value={tagNova}
                  onChange={(e) => {
                    setTagNova(e.target.value);
                    if (e.target.value) setTagEscolhida("");
                  }}
                  placeholder="Ex.: Resgate agosto"
                  className={CAMPO}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={pendente || (!tagEscolhida && !tagNova.trim())}
                  onClick={() => {
                    const escolha = {
                      id: tagEscolhida || undefined,
                      novoNome: tagNova.trim() || undefined,
                    };
                    executar(() =>
                      filtroInteiro
                        ? etiquetarPorFiltroCarteira(filtro, escolha)
                        : etiquetarClientesEmMassa(ids, escolha),
                    );
                  }}
                  className="inline-flex h-[40px] items-center rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendente
                    ? "Etiquetando…"
                    : `Etiquetar ${quantidade} cliente(s)`}
                </button>
              </div>
              <p className="text-xs text-neutral-600 sm:col-span-3">
                Cliente da importação que ainda não tem conversa ganha uma
                agora — sem isso a campanha não teria para onde mandar.
              </p>
            </div>
          ) : null}

          {painel === "template" ? (
            <div className="mt-1.5 grid gap-1 border-t border-primary-500/30 pt-1.5">
              <label className="block max-w-[420px]">
                <span className="mb-0.5 block text-xs text-neutral-600">
                  Template aprovado
                </span>
                <select
                  value={indiceTemplate}
                  onChange={(e) => {
                    setIndiceTemplate(e.target.value);
                    setValores({});
                  }}
                  className={CAMPO}
                >
                  <option value="">Escolher…</option>
                  {templates.map((t, i) => (
                    <option key={`${t.nome}-${t.idioma}`} value={String(i)}>
                      {t.nome} ({t.idioma})
                    </option>
                  ))}
                </select>
              </label>

              {template ? (
                <>
                  <p className="max-w-[68ch] rounded-md bg-neutral-0 px-1.5 py-1 text-sm whitespace-pre-wrap text-neutral-800">
                    {template.corpo}
                  </p>
                  {template.parametros.map((token) => (
                    <label key={token} className="block max-w-[420px]">
                      <span className="mb-0.5 block text-xs text-neutral-600">
                        Variável {`{{${token}}}`} — use {"{nome}"} para o
                        primeiro nome de cada cliente
                      </span>
                      <input
                        type="text"
                        value={valores[token] ?? ""}
                        onChange={(e) =>
                          setValores((v) => ({ ...v, [token]: e.target.value }))
                        }
                        className={CAMPO}
                      />
                    </label>
                  ))}
                </>
              ) : null}

              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  disabled={pendente || !template}
                  onClick={() =>
                    executar(() =>
                      dispararTemplateEmMassa(
                        ids,
                        template?.nome ?? "",
                        template?.idioma ?? "",
                        valores,
                      ),
                    )
                  }
                  className="inline-flex h-[40px] items-center rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendente
                    ? "Enviando…"
                    : `Enviar para ${marcados.size} cliente(s)`}
                </button>
                <p className="text-xs text-neutral-600">
                  Sai na hora, até 50 por vez. Quem pediu descadastro fica de
                  fora. Para uma lista maior, etiquete e crie uma campanha.
                </p>
              </div>
            </div>
          ) : null}

          {resultado?.erro ? (
            <p role="alert" className="mt-1 text-sm text-danger">
              {resultado.erro}
            </p>
          ) : null}
        </div>
      ) : null}

      {resultado?.ok && resultado.aviso ? (
        <p
          role="status"
          className="mt-2 rounded-md bg-success-bg px-1.5 py-1 text-sm text-success"
        >
          {resultado.aviso}
        </p>
      ) : null}

      <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-0 shadow-sm">
        <table className="w-full min-w-[1000px] border-collapse text-left">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50">
              <th scope="col" className="w-[40px] px-1">
                <label className="flex h-[32px] cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    checked={todosMarcados}
                    onChange={() =>
                      setMarcados(
                        todosMarcados
                          ? new Set()
                          : new Set(linhas.map((l) => l.customer_id)),
                      )
                    }
                    aria-label="Selecionar todos os clientes da página"
                    className="h-[16px] w-[16px] accent-primary-600"
                  />
                </label>
              </th>
              <Th>Cliente</Th>
              <Th>Saúde</Th>
              <Th alinhar="right">Lotes 30d</Th>
              <Th alinhar="right">Sem giro há</Th>
              {temReceita ? <Th alinhar="right">Receita 30d</Th> : null}
              <Th alinhar="right">Último contato</Th>
              <Th>Responsável</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {linhas.map((linha) => {
              const status = ROTULO_STATUS[linha.status] ?? {
                texto: linha.status,
                classe: "bg-neutral-100 text-neutral-600",
              };
              const variacao =
                linha.lotes_30d !== null &&
                linha.lotes_30d_anterior !== null &&
                linha.lotes_30d_anterior > 0
                  ? Math.round(
                      ((linha.lotes_30d - linha.lotes_30d_anterior) /
                        linha.lotes_30d_anterior) *
                        100,
                    )
                  : null;
              const marcado = marcados.has(linha.customer_id);
              return (
                <tr
                  key={linha.customer_id}
                  className={cn(
                    "h-[48px]",
                    marcado ? "bg-primary-50" : "hover:bg-neutral-50",
                  )}
                >
                  <td className="px-1">
                    <label className="flex h-[40px] cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(linha.customer_id)}
                        aria-label={`Selecionar ${linha.nome_completo}`}
                        className="h-[16px] w-[16px] accent-primary-600"
                      />
                    </label>
                  </td>
                  <td className="px-2">
                    <Link
                      href={`/carteira/${linha.customer_id}`}
                      className="block max-w-[260px] truncate rounded-sm text-sm font-medium text-neutral-800 underline-offset-2 hover:text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                    >
                      {linha.nome_completo}
                    </Link>
                    <span className="block font-mono text-xs text-neutral-600 tabular-nums">
                      {linha.telefone_e164
                        ? formatarTelefone(linha.telefone_e164)
                        : "sem telefone"}
                      {linha.conta_aberta_em
                        ? ` · conta ${formatarData(linha.conta_aberta_em.slice(0, 10))}`
                        : ""}
                    </span>
                  </td>
                  <td className="px-2">
                    <span
                      className={cn(
                        "inline-flex h-[20px] items-center rounded-sm px-1 text-xs font-medium",
                        status.classe,
                      )}
                    >
                      {status.texto}
                    </span>
                    {linha.segmento ? (
                      <span className="mt-0.5 block text-xs text-neutral-400 capitalize">
                        {linha.segmento}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                    {linha.lotes_30d ?? 0}
                    {variacao !== null ? (
                      <span
                        className={cn(
                          "ml-0.5 text-xs",
                          variacao < 0 ? "text-danger" : "text-success",
                        )}
                      >
                        {variacao > 0 ? `+${variacao}%` : `${variacao}%`}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      "px-2 text-right font-mono text-sm tabular-nums",
                      (linha.dias_sem_giro ?? 0) > 14
                        ? "font-medium text-warning"
                        : "text-neutral-600",
                    )}
                  >
                    {linha.ultimo_giro_em === null
                      ? "nunca girou"
                      : `${linha.dias_sem_giro}d`}
                  </td>
                  {temReceita ? (
                    <td className="px-2 text-right font-mono text-sm text-neutral-800 tabular-nums">
                      {formatarReais(linha.receita_30d_centavos ?? 0)}
                    </td>
                  ) : null}
                  <td
                    className={cn(
                      "px-2 text-right text-sm tabular-nums",
                      (linha.dias_sem_contato ?? 0) > 30 ||
                        linha.dias_sem_contato === null
                        ? "text-neutral-400"
                        : "text-neutral-600",
                    )}
                  >
                    {ultimoContato(linha.dias_sem_contato)}
                  </td>
                  <td className="max-w-[140px] truncate px-2 text-sm text-neutral-600">
                    {linha.responsavel_nome ?? "sem dono"}
                  </td>
                  <td className="px-2">
                    {linha.lead_id ? (
                      <span className="inline-flex items-center">
                        <Link
                          href={`/chat?lead=${linha.lead_id}`}
                          aria-label={`Abrir conversa com ${linha.nome_completo}`}
                          title="Abrir no chat"
                          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                        >
                          <MessageSquare
                            size={18}
                            strokeWidth={1.5}
                            aria-hidden
                          />
                        </Link>
                        <Link
                          href={`/leads/${linha.lead_id}?aba=cliente`}
                          aria-label={`Abrir ficha de ${linha.nome_completo}`}
                          title="Abrir ficha"
                          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                        >
                          <UserRound size={18} strokeWidth={1.5} aria-hidden />
                        </Link>
                      </span>
                    ) : linha.telefone_cliente ? (
                      <AbrirConversa
                        customerId={linha.customer_id}
                        nome={linha.nome_completo}
                      />
                    ) : (
                      <span className="text-xs text-neutral-400">
                        sem telefone
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({
  children,
  alinhar,
}: {
  children: React.ReactNode;
  alinhar?: "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2 py-1 text-xs tracking-[0.06em] text-neutral-600 uppercase",
        alinhar === "right" && "text-right",
      )}
    >
      {children}
    </th>
  );
}
