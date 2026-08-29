"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatarData,
  formatarDataHora,
  formatarReais,
  formatarTelefone,
} from "@/lib/format";
import {
  concluirTarefaLead,
  criarTarefaLead,
  type ResultadoEnvio,
} from "@/app/(app)/chat/actions";
import { carregarContexto, type ContextoConversa } from "./actions";

const ESTADO: ResultadoEnvio = {};

const ROTULO_MOTIVO: Record<string, string> = {
  manual: "Cadastro manual",
  importacao: "Importação",
  webhook_meta: "WhatsApp (Meta)",
  formulario: "Formulário",
  webhook_instagram: "Instagram Direct",
  queda_lotes: "Reativação — queda de lotes",
  sem_giro: "Reativação — sem giro",
};

/** Um dado do painel: rótulo curto em cima, valor legível embaixo. */
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-neutral-600">{rotulo}</p>
      <p className="text-sm break-words text-neutral-800">{children}</p>
    </div>
  );
}

function BotaoCopiar({ valor, rotulo }: { valor: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);
  return (
    <button
      type="button"
      aria-label={copiado ? `${rotulo} copiado` : `Copiar ${rotulo}`}
      title={copiado ? "Copiado" : `Copiar ${rotulo}`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(valor)
          .then(() => setCopiado(true))
          .catch(() => setCopiado(false));
      }}
      className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
    >
      {copiado ? (
        <Check size={15} strokeWidth={2} aria-hidden className="text-success" />
      ) : (
        <Copy size={15} strokeWidth={1.7} aria-hidden />
      )}
    </button>
  );
}

/**
 * O painel de contexto do palco (Bloco C): quem é a pessoa, o que ela vale
 * hoje e o que ficou combinado — do lado da conversa, para o atendente não
 * precisar abrir a ficha em outra aba no meio do atendimento.
 *
 * Carrega SOZINHO, depois da conversa: o gesto de abrir conversa não pode
 * esperar por giro, receita e tarefas.
 */
export function PainelContexto({
  leadId,
  nome,
  aoFechar,
  sinalRecarga = 0,
}: {
  leadId: string;
  nome: string;
  /** Só no modo folha (mobile): mostra o X que fecha. */
  aoFechar?: () => void;
  /** Muda quando o menu "⋯" grava algo — o painel mostra etapa e atendente
   *  e ficaria mentindo ao lado do menu que acabou de mudá-los. */
  sinalRecarga?: number;
}) {
  const [dados, setDados] = useState<ContextoConversa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [novaAberta, setNovaAberta] = useState(false);
  const [estado, formAction, enviandoTarefa] = useActionState(
    criarTarefaLead,
    ESTADO,
  );
  // O datetime-local devolve hora LOCAL sem fuso ("2026-08-30T10:00"); o
  // Postgres leria isso como UTC e o lembrete venceria 3h adiantado. O
  // navegador converte e manda o ISO no campo escondido.
  const [venceLocal, setVenceLocal] = useState("");
  // Contador de recarga: mudar de lead OU concluir/criar tarefa refaz a
  // busca — um só caminho de leitura, sem duplicar o efeito.
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      let r: Awaited<ReturnType<typeof carregarContexto>>;
      try {
        r = await carregarContexto(leadId);
      } catch {
        // Rede caiu: sem este catch o painel ficava preso em "Carregando o
        // contexto…" para sempre, sem erro e sem retentativa.
        r = { erro: "Sem resposta do servidor — reabra a conversa." };
      }
      if (!vivo) return; // trocou de lead: resposta velha, descarta
      setCarregando(false);
      if ("erro" in r) {
        setErro(r.erro);
        setDados(null);
      } else {
        setErro(null);
        setDados(r);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [leadId, recarga, sinalRecarga]);

  // Tarefa criada: some o formulário e a lista se atualiza.
  const [estadoAnterior, setEstadoAnterior] = useState(estado);
  if (estado !== estadoAnterior) {
    setEstadoAnterior(estado);
    if (estado.ok) {
      setNovaAberta(false);
      setVenceLocal("");
      setRecarga((n) => n + 1);
    }
  }

  const concluir = (tarefaId: string) => {
    // Some da lista na hora; erro devolve (a recarga traz a verdade).
    setDados((d) =>
      d ? { ...d, tarefas: d.tarefas.filter((t) => t.id !== tarefaId) } : d,
    );
    void concluirTarefaLead(tarefaId, leadId)
      .then((r) => {
        if (r.erro) throw new Error(r.erro);
      })
      .catch((e: unknown) => {
        // Sem o catch, uma queda de rede deixava a tarefa sumida da tela e
        // pendente no banco — o atendente achava que tinha concluído.
        setErro(
          e instanceof Error && e.message
            ? e.message
            : "Não deu para concluir — a lista voltou ao que está no banco.",
        );
        setRecarga((n) => n + 1); // a recarga traz a verdade de volta
      });
  };

  const giroCai =
    dados?.cliente &&
    dados.cliente.lotes30d !== null &&
    dados.cliente.lotes30dAnterior !== null &&
    dados.cliente.lotes30d < dados.cliente.lotes30dAnterior;

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-0">
      <div className="flex items-center gap-1 border-b border-neutral-200 px-2 py-1">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">
          {nome}
        </h2>
        <Link
          href={`/leads/${leadId}`}
          title="Abrir a ficha 360 do lead"
          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
        >
          <ExternalLink size={16} strokeWidth={1.7} aria-hidden />
        </Link>
        {aoFechar ? (
          <button
            type="button"
            aria-label="Fechar o painel"
            onClick={aoFechar}
            className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <X size={17} strokeWidth={1.7} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {erro ? (
          <p role="alert" className="rounded-md bg-danger-bg px-1.5 py-1 text-sm text-danger">
            {erro}
          </p>
        ) : null}

        {carregando && !dados ? (
          <p className="text-sm text-neutral-600">Carregando o contexto…</p>
        ) : null}

        {dados ? (
          <div className="flex flex-col gap-3">
            {/* Contato */}
            <section className="flex flex-col gap-1">
              {dados.telefone ? (
                <div className="flex items-center gap-1">
                  <Campo rotulo="WhatsApp">
                    <span className="font-mono tabular-nums">
                      {formatarTelefone(dados.telefone)}
                    </span>
                  </Campo>
                  <span className="ml-auto">
                    <BotaoCopiar valor={dados.telefone} rotulo="telefone" />
                  </span>
                </div>
              ) : null}
              {dados.email ? (
                <div className="flex items-center gap-1">
                  <Campo rotulo="E-mail">{dados.email}</Campo>
                  <span className="ml-auto">
                    <BotaoCopiar valor={dados.email} rotulo="e-mail" />
                  </span>
                </div>
              ) : null}
              <div className="flex gap-2">
                {dados.etapaNome ? (
                  <Campo rotulo="Etapa">{dados.etapaNome}</Campo>
                ) : null}
                <Campo rotulo="Atendente">
                  {dados.responsavelNome ?? "sem dono"}
                </Campo>
              </div>
            </section>

            {/* Cliente da corretora: o que ele vale hoje */}
            {dados.cliente ? (
              <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-1.5">
                <p className="text-xs font-semibold tracking-[0.06em] text-neutral-600 uppercase">
                  Cliente
                </p>
                <div className="mt-1 flex flex-col gap-1">
                  {/* Só quando difere do nome do lead: o cruzamento é por
                      telefone, e número reciclado põe a conta de outra
                      pessoa aqui — quem fala com o lead precisa saber. */}
                  {dados.cliente.nome.trim().toLowerCase() !==
                  nome.trim().toLowerCase() ? (
                    <Campo rotulo="Titular da conta">
                      {dados.cliente.nome}
                    </Campo>
                  ) : null}
                  {dados.cliente.contaAbertaEm ? (
                    <Campo rotulo="Conta aberta em">
                      {formatarData(dados.cliente.contaAbertaEm)}
                    </Campo>
                  ) : null}
                  {dados.cliente.lotes30d !== null ? (
                    <Campo rotulo="Lotes (30 dias)">
                      <span className="inline-flex items-center gap-0.5">
                        <span className="font-mono tabular-nums">
                          {dados.cliente.lotes30d}
                        </span>
                        {dados.cliente.lotes30dAnterior !== null ? (
                          <>
                            {giroCai ? (
                              <TrendingDown
                                size={14}
                                strokeWidth={1.7}
                                aria-hidden
                                className="text-danger"
                              />
                            ) : (
                              <TrendingUp
                                size={14}
                                strokeWidth={1.7}
                                aria-hidden
                                className="text-success"
                              />
                            )}
                            <span className="text-xs text-neutral-600">
                              antes {dados.cliente.lotes30dAnterior}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </Campo>
                  ) : null}
                  {/* Sem isto, "0 lotes em 30 dias" não distingue cliente
                      novo de cliente que parou de girar. */}
                  {dados.cliente.ultimoGiroEm ? (
                    <Campo rotulo="Último giro">
                      {formatarData(dados.cliente.ultimoGiroEm)}
                    </Campo>
                  ) : null}
                  {(dados.cliente.receita30dCentavos ?? 0) > 0 ? (
                    <Campo rotulo="Receita (30 dias)">
                      <span className="font-mono tabular-nums">
                        {formatarReais(dados.cliente.receita30dCentavos ?? 0)}
                      </span>
                    </Campo>
                  ) : null}
                  {(dados.cliente.ltvCentavos ?? 0) > 0 ? (
                    <Campo rotulo="Receita desde o início">
                      <span className="font-mono tabular-nums">
                        {formatarReais(dados.cliente.ltvCentavos ?? 0)}
                      </span>
                    </Campo>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* Tarefas — o que ficou combinado */}
            <section>
              <div className="flex items-center gap-1">
                <p className="text-xs font-semibold tracking-[0.06em] text-neutral-600 uppercase">
                  Combinado
                </p>
                {dados.tarefasDisponiveis ? (
                  <button
                    type="button"
                    onClick={() => setNovaAberta((v) => !v)}
                    aria-expanded={novaAberta}
                    className="ml-auto inline-flex h-[40px] items-center gap-0.5 rounded-md px-1 text-sm font-medium text-primary-600 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  >
                    <Plus size={15} strokeWidth={2} aria-hidden />
                    Lembrete
                  </button>
                ) : null}
              </div>

              {!dados.tarefasDisponiveis ? (
                <p className="text-sm text-neutral-600">
                  Os lembretes dependem da migração 0013.
                </p>
              ) : dados.tarefas.length === 0 && !novaAberta ? (
                <p className="text-sm text-neutral-600">
                  Nada combinado com este lead.
                </p>
              ) : null}

              {novaAberta ? (
                <form action={formAction} className="mt-1 flex flex-col gap-1">
                  <input type="hidden" name="lead_id" value={leadId} />
                  <label htmlFor="titulo-tarefa" className="sr-only">
                    O que ficou combinado
                  </label>
                  <input
                    id="titulo-tarefa"
                    name="titulo"
                    autoFocus
                    maxLength={140}
                    placeholder="Ligar para fechar a proposta"
                    className="h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  />
                  <label htmlFor="vence-tarefa" className="sr-only">
                    Quando
                  </label>
                  <input
                    id="vence-tarefa"
                    type="datetime-local"
                    value={venceLocal}
                    onChange={(e) => setVenceLocal(e.target.value)}
                    className="h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                  />
                  <input
                    type="hidden"
                    name="vence_iso"
                    value={
                      venceLocal && !Number.isNaN(Date.parse(venceLocal))
                        ? new Date(venceLocal).toISOString()
                        : ""
                    }
                  />
                  {estado.erro ? (
                    <p role="alert" className="text-xs text-danger">
                      {estado.erro}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setNovaAberta(false)}
                      className="inline-flex h-[40px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={enviandoTarefa}
                      className="inline-flex h-[40px] items-center rounded-md bg-primary-600 px-1.5 text-sm font-medium text-neutral-0 hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {enviandoTarefa ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                </form>
              ) : null}

              {dados.tarefas.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {dados.tarefas.map((t) => (
                    <li key={t.id} className="flex items-start gap-1">
                      <button
                        type="button"
                        aria-label={`Concluir: ${t.titulo}`}
                        onClick={() => concluir(t.id)}
                        className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors duration-[120ms] hover:bg-success-bg hover:text-success focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                      >
                        <Check size={16} strokeWidth={2} aria-hidden />
                      </button>
                      <span className="min-w-0 flex-1 py-1">
                        <span className="block text-sm break-words text-neutral-800">
                          {t.titulo}
                        </span>
                        <span
                          className={cn(
                            "block font-mono text-xs tabular-nums",
                            t.vencida ? "text-danger" : "text-neutral-600",
                          )}
                        >
                          {formatarDataHora(t.venceEm)}
                          {t.vencida ? " · venceu" : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {/* De onde veio */}
            <section className="flex flex-col gap-1 border-t border-neutral-200 pt-2">
              <Campo rotulo="Entrou por">
                {ROTULO_MOTIVO[dados.entradaMotivo] ?? dados.entradaMotivo}
                {dados.canal ? ` · ${dados.canal}` : ""}
              </Campo>
              {dados.campanha ? (
                <Campo rotulo="Campanha">{dados.campanha}</Campo>
              ) : null}
              <Campo rotulo="Na base desde">{formatarData(dados.criadoEm)}</Campo>
              <Campo rotulo="Primeira resposta">
                {dados.primeiraRespostaEm
                  ? formatarData(dados.primeiraRespostaEm)
                  : "nunca respondeu"}
              </Campo>
              {dados.observacao ? (
                <Campo rotulo="Observação">{dados.observacao}</Campo>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
