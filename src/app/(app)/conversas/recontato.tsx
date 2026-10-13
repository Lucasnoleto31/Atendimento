"use client";

import { useId, useState, type RefObject } from "react";
import { CalendarClock, Check, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateWhatsapp } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { AJUDA, CAMPO, ROTULO } from "@/components/app/form-styles";
import { EscolhaTemplate } from "@/app/(app)/chat/templates";
import {
  agendarRecontato,
  type ResultadoRecontato,
} from "@/app/(app)/chat/recontato-actions";
import {
  limparMotivo,
  MOTIVO_MAX,
  RECONTATO_MAX_DIAS,
  type Recontato,
} from "@/app/(app)/chat/recontato";
import {
  diaComSemana,
  diaEmTexto,
  hojeEmBrasilia,
  horaEmTexto,
  instanteEmBrasilia,
  partesEmBrasilia,
  quandoEmTexto,
  somarDias,
} from "@/app/(app)/chat/quando";
import { Folha, Grupo, RotuloGrupo } from "./folha";

/*
 * O recontato na tela (o modelo está em chat/recontato.ts): o diálogo de
 * agendar e reagendar, a faixa no topo da conversa e o "Escolher data e
 * hora" do adiar, que usa os mesmos campos. Folha presa no pé no celular e
 * janela centralizada do tablet para cima (a forma "centro" da Folha).
 */

/** "Escolher data e hora" do adiar vai até um ano à frente (o servidor
 *  confere o mesmo teto em chat/actions.ts). */
const ADIAR_MAX_DIAS = 366;

/* ── Data e hora ──────────────────────────────────────────────────────── */

/**
 * Data e hora lado a lado, nos campos nativos (o teclado e o seletor do
 * sistema no celular). `min` e `max` em "AAAA-MM-DD".
 */
function CamposDataHora({
  dia,
  hora,
  aoMudarDia,
  aoMudarHora,
  min,
  max,
  erro,
}: {
  dia: string;
  hora: string;
  aoMudarDia: (v: string) => void;
  aoMudarHora: (v: string) => void;
  min: string;
  max: string;
  erro?: boolean;
}) {
  const base = useId();
  return (
    // 12px entre os dois no toque, o vão mínimo do kit entre vizinhos.
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1 pointer-coarse:gap-1.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={`${base}-dia`} className={ROTULO}>
          Data
        </label>
        <input
          id={`${base}-dia`}
          type="date"
          required
          value={dia}
          min={min}
          max={max}
          aria-invalid={erro || undefined}
          onChange={(e) => aoMudarDia(e.target.value)}
          className={cn(CAMPO, "w-full", erro && "border-erro")}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={`${base}-hora`} className={ROTULO}>
          Hora
        </label>
        <input
          id={`${base}-hora`}
          type="time"
          required
          step={300}
          value={hora}
          aria-invalid={erro || undefined}
          onChange={(e) => aoMudarHora(e.target.value)}
          className={cn(CAMPO, "w-full", erro && "border-erro")}
        />
      </div>
    </div>
  );
}

/** O instante escolhido, conferido: futuro (um minuto à frente) e até
 *  `maxDias`. Devolve o ISO ou o erro em texto. */
function conferirInstante(
  dia: string,
  hora: string,
  maxDias: number,
  oQue: string,
): { iso: string } | { erro: string } {
  const iso = instanteEmBrasilia(dia, hora);
  if (!iso) return { erro: "Escolha a data e a hora." };
  const ms = Date.parse(iso);
  if (ms <= Date.now() + 60_000) {
    return { erro: "Escolha um horário daqui para a frente." };
  }
  if (ms > Date.now() + maxDias * 86_400_000) {
    return {
      erro: `${oQue} vai até ${maxDias.toLocaleString("pt-BR")} dias à frente.`,
    };
  }
  return { iso };
}

/* ── Adiar: escolher data e hora ──────────────────────────────────────── */

/**
 * O "Escolher data e hora" do adiar (no Adiar ▾, no ⋯ do celular, na
 * seleção em massa e na paleta). Abre com amanhã no início do horário de
 * atendimento. Confirmar devolve o instante (ISO) e o texto "até 12/10 às
 * 15h", para o aviso e a confirmação da massa.
 */
export function DialogoAdiarData({
  aberto,
  aoFechar,
  horaPadrao,
  rotuloBotao = "Adiar",
  aoConfirmar,
  retorno,
}: {
  aberto: boolean;
  aoFechar: () => void;
  horaPadrao: string;
  rotuloBotao?: string;
  aoConfirmar: (iso: string, frase: string) => void;
  retorno?: RefObject<HTMLElement | null>;
}) {
  const idForm = useId();
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState(horaPadrao);
  const [hoje, setHoje] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  // Cada abertura começa em amanhã, na hora padrão (ajuste durante o render;
  // montado já aberto, o primeiro render também conta como abertura).
  const [abertoAntes, setAbertoAntes] = useState(false);
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto);
    if (aberto) {
      const agora = hojeEmBrasilia();
      setHoje(agora);
      setDia(somarDias(agora, 1));
      setHora(horaPadrao);
      setErro(null);
    }
  }

  const confirmar = () => {
    const r = conferirInstante(dia, hora, ADIAR_MAX_DIAS, "O adiar");
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }
    aoConfirmar(r.iso, `até ${quandoEmTexto(r.iso)}`);
  };

  return (
    <Folha
      aberta={aberto}
      aoFechar={aoFechar}
      titulo="Adiar até"
      forma="centro"
      retorno={retorno}
      rodape={
        <div className="flex flex-col gap-1">
          {erro ? (
            <p role="alert" className="tipo-nota text-erro">
              {erro}
            </p>
          ) : null}
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="secondary"
              onClick={aoFechar}
              className="pointer-coarse:h-[44px]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form={idForm}
              className="pointer-coarse:h-[44px]"
            >
              {rotuloBotao}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={idForm}
        className="pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          confirmar();
        }}
      >
        <CamposDataHora
          dia={dia}
          hora={hora}
          aoMudarDia={(v) => {
            setDia(v);
            setErro(null);
          }}
          aoMudarHora={(v) => {
            setHora(v);
            setErro(null);
          }}
          min={hoje}
          max={hoje ? somarDias(hoje, ADIAR_MAX_DIAS) : ""}
          erro={Boolean(erro)}
        />
        <p className={cn(AJUDA, "pt-1")}>
          A conversa sai da Caixa e volta nesse horário, ou antes, se a pessoa
          escrever.
        </p>
      </form>
    </Folha>
  );
}

/* ── Agendar e reagendar ──────────────────────────────────────────────── */

type EscolhaQuando = "amanha" | "3dias" | "1semana" | "data";

const DIAS_DA_ESCOLHA: Record<Exclude<EscolhaQuando, "data">, number> = {
  amanha: 1,
  "3dias": 3,
  "1semana": 7,
};

/**
 * O diálogo de agendar (ou reagendar) o recontato: quando, motivo e o
 * template para enviar no dia (opcional). Agendar adia a conversa até o
 * quando; a tela segue para a próxima, como no adiar.
 */
export function DialogoRecontato({
  aberto,
  aoFechar,
  leadId,
  nomeContato,
  templates,
  aceitaTemplate,
  horaPadrao,
  reagendar = null,
  aoConcluir,
  retorno,
}: {
  aberto: boolean;
  aoFechar: () => void;
  leadId: string;
  nomeContato: string;
  /** [] = a Meta sem template; null = não carregou. */
  templates: TemplateWhatsapp[] | null;
  /** O contato tem telefone (template só sai pelo WhatsApp). null = ainda
   *  não se sabe: a lista aparece e o servidor confere. */
  aceitaTemplate: boolean | null;
  /** "09:00": o início do horário de atendimento. */
  horaPadrao: string;
  /** Reagendar: o recontato que muda de data, com o motivo e o template. */
  reagendar?: Recontato | null;
  aoConcluir: (r: ResultadoRecontato) => void;
  retorno?: RefObject<HTMLElement | null>;
}) {
  const idForm = useId();
  const idQuando = useId();
  const idMotivo = useId();
  const [hoje, setHoje] = useState("");
  const [escolha, setEscolha] = useState<EscolhaQuando>("amanha");
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState(horaPadrao);
  const [motivo, setMotivo] = useState("");
  const [indice, setIndice] = useState<number | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [erroMotivo, setErroMotivo] = useState(false);
  const [gravando, setGravando] = useState(false);
  // Cada abertura monta a escolha de template de novo (a busca começa vazia).
  const [abertura, setAbertura] = useState(0);

  const lista = templates ?? [];
  // Reagendar com o template gravado fora da lista da Meta (reprovado,
  // removido, ou a lista veio vazia): agendar sai sem ele, e a tela diz.
  const templateDoRecontato = reagendar?.template ?? null;
  const templateSumiu =
    templateDoRecontato &&
    templates !== null &&
    aceitaTemplate !== false &&
    !lista.some(
      (x) =>
        x.nome === templateDoRecontato.nome &&
        x.idioma === templateDoRecontato.idioma,
    )
      ? templateDoRecontato.nome
      : null;

  // Cada abertura começa do zero; no reagendar, com o motivo e o template
  // do recontato (ajuste durante o render; montado já aberto, o primeiro
  // render também conta como abertura).
  const [abertoAntes, setAbertoAntes] = useState(false);
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto);
    if (aberto) {
      const agora = hojeEmBrasilia();
      setHoje(agora);
      setEscolha("amanha");
      setDia(somarDias(agora, 1));
      setHora(horaPadrao);
      setMotivo(reagendar?.motivo ?? "");
      const t = reagendar?.template;
      const i = t
        ? lista.findIndex((x) => x.nome === t.nome && x.idioma === t.idioma)
        : -1;
      setIndice(i === -1 ? null : i);
      setValores(i === -1 || !t ? {} : { ...t.variaveis });
      setErro(null);
      setErroMotivo(false);
      setAbertura((n) => n + 1);
    }
  }

  const horaTexto = horaEmTexto(horaPadrao);
  const opcoes: { valor: EscolhaQuando; rotulo: string; detalhe: string }[] =
    hoje
      ? [
          {
            valor: "amanha",
            rotulo: `Amanhã às ${horaTexto}`,
            detalhe: diaComSemana(somarDias(hoje, 1), hoje),
          },
          {
            valor: "3dias",
            rotulo: "Em 3 dias",
            detalhe: `${diaComSemana(somarDias(hoje, 3), hoje)} às ${horaTexto}`,
          },
          {
            valor: "1semana",
            rotulo: "Em 1 semana",
            detalhe: `${diaComSemana(somarDias(hoje, 7), hoje)} às ${horaTexto}`,
          },
          { valor: "data", rotulo: "Escolher data e hora", detalhe: "" },
        ]
      : [];

  const fecharSeLivre = () => {
    if (!gravando) aoFechar();
  };

  const agendar = async () => {
    if (gravando) return;
    setErro(null);
    const limpo = limparMotivo(motivo);
    if (!limpo) {
      setErroMotivo(true);
      setErro("Escreva o motivo do recontato.");
      document.getElementById(idMotivo)?.focus();
      return;
    }
    let quando: string | null;
    if (escolha === "data") {
      const r = conferirInstante(dia, hora, RECONTATO_MAX_DIAS, "O recontato");
      if ("erro" in r) {
        setErro(r.erro);
        return;
      }
      quando = r.iso;
    } else {
      quando = instanteEmBrasilia(
        somarDias(hojeEmBrasilia(), DIAS_DA_ESCOLHA[escolha]),
        horaPadrao,
      );
    }
    if (!quando) {
      setErro("Escolha quando fazer o recontato.");
      return;
    }
    const escolhido = indice !== null ? (lista[indice] ?? null) : null;
    setGravando(true);
    let r: ResultadoRecontato;
    try {
      r = await agendarRecontato({
        leadId,
        quando,
        motivo: limpo,
        template: escolhido
          ? {
              nome: escolhido.nome,
              idioma: escolhido.idioma,
              // Só as variáveis deste template, sem as de outro escolhido antes.
              variaveis: Object.fromEntries(
                escolhido.parametros
                  .map((p) => [p, valores[p]?.trim() ?? ""] as const)
                  .filter(([, v]) => v),
              ),
            }
          : // Sem a lista da Meta, o reagendar não tem como mostrar o
            // template: ele fica como estava.
            templates === null
            ? (reagendar?.template ?? null)
            : null,
        id: reagendar?.id ?? null,
      });
    } catch {
      r = { erro: "A conexão não respondeu. Tente de novo." };
    }
    setGravando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    aoConcluir(r);
  };

  return (
    <Folha
      aberta={aberto}
      aoFechar={fecharSeLivre}
      titulo={reagendar ? "Reagendar recontato" : "Agendar recontato"}
      forma="centro"
      retorno={retorno}
      rodape={
        <div className="flex flex-col gap-1">
          {erro ? (
            <p role="alert" className="tipo-nota text-erro">
              {erro}
            </p>
          ) : null}
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="secondary"
              onClick={fecharSeLivre}
              disabled={gravando}
              className="pointer-coarse:h-[44px]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form={idForm}
              carregando={gravando}
              className="pointer-coarse:h-[44px]"
            >
              {gravando ? "Agendando…" : reagendar ? "Reagendar" : "Agendar"}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={idForm}
        className="min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          void agendar();
        }}
      >
        <p className="tipo-nota pt-0.5 text-texto-2">
          {nomeContato} sai da Caixa e volta no dia, com o motivo à vista. Se
          escrever antes, volta na hora e o recontato continua marcado.
        </p>

        <RotuloGrupo id={idQuando}>Quando</RotuloGrupo>
        <div role="radiogroup" aria-labelledby={idQuando}>
          <Grupo>
            {opcoes.map((o) => (
              <label
                key={o.valor}
                className="group/linha flex cursor-pointer items-center gap-1.5 pl-1.5 transition-colors duration-[120ms] hover:bg-realce has-[:checked]:bg-selecao"
              >
                <input
                  type="radio"
                  name={`${idForm}-quando`}
                  checked={escolha === o.valor}
                  onChange={() => {
                    setEscolha(o.valor);
                    setErro(null);
                  }}
                  className="h-[18px] w-[18px] shrink-0"
                />
                <span className="flex min-h-[48px] min-w-0 flex-1 items-center gap-1 border-t border-fio py-1 pr-1.5 group-first/linha:border-t-0">
                  <span className="tipo-corpo min-w-0 flex-1 text-tinta">
                    {o.rotulo}
                  </span>
                  {o.detalhe ? (
                    <span className="tipo-nota shrink-0 text-texto-2 tabular-nums">
                      {o.detalhe}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </Grupo>
        </div>
        {escolha === "data" ? (
          <div className="pt-1.5">
            <CamposDataHora
              dia={dia}
              hora={hora}
              aoMudarDia={(v) => {
                setDia(v);
                setErro(null);
              }}
              aoMudarHora={(v) => {
                setHora(v);
                setErro(null);
              }}
              min={hoje}
              max={hoje ? somarDias(hoje, RECONTATO_MAX_DIAS) : ""}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-0.5 pt-2">
          <div className="flex items-baseline gap-1">
            <label htmlFor={idMotivo} className={cn(ROTULO, "min-w-0 flex-1")}>
              Motivo
            </label>
            <span
              aria-hidden
              className={cn(
                "tipo-nota shrink-0 tabular-nums",
                motivo.length >= MOTIVO_MAX ? "text-atencao" : "text-texto-2",
              )}
            >
              {motivo.length.toLocaleString("pt-BR")}/{MOTIVO_MAX}
            </span>
          </div>
          <input
            id={idMotivo}
            type="text"
            required
            maxLength={MOTIVO_MAX}
            autoComplete="off"
            value={motivo}
            aria-invalid={erroMotivo || undefined}
            aria-describedby={`${idMotivo}-ajuda`}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (erroMotivo) setErroMotivo(false);
            }}
            placeholder="O que falar com a pessoa"
            className={cn(CAMPO, "w-full", erroMotivo && "border-erro")}
          />
          <p id={`${idMotivo}-ajuda`} className={AJUDA}>
            Aparece na fila no dia, no lugar da última mensagem. Até{" "}
            {MOTIVO_MAX} caracteres.
          </p>
        </div>

        {aceitaTemplate === false ? (
          <>
            <RotuloGrupo>Template para enviar</RotuloGrupo>
            <p className="tipo-nota px-1.5 text-texto-2">
              Template só sai pelo WhatsApp, e este contato não tem telefone.
            </p>
          </>
        ) : templates === null ? (
          <>
            <RotuloGrupo>Template para enviar</RotuloGrupo>
            <p className="tipo-nota px-1.5 text-erro">
              {reagendar?.template
                ? `Os templates da Meta não carregaram. O recontato continua com o template ${reagendar.template.nome}.`
                : "Os templates da Meta não carregaram. Dá para agendar sem e escolher no dia."}
            </p>
          </>
        ) : lista.length === 0 ? (
          templateSumiu ? (
            <>
              <RotuloGrupo>Template para enviar</RotuloGrupo>
              <p className="tipo-nota px-1.5 text-atencao [overflow-wrap:anywhere]">
                O template {templateSumiu} do recontato não está mais entre os
                aprovados, e a Meta não tem outro. O recontato fica sem
                template.
              </p>
            </>
          ) : null
        ) : (
          <>
            {templateSumiu ? (
              <p className="tipo-nota px-1.5 pt-2 text-atencao [overflow-wrap:anywhere]">
                O template {templateSumiu} do recontato não está mais entre os
                aprovados. Escolha outro ou reagende sem template.
              </p>
            ) : null}
            <EscolhaTemplate
              key={abertura}
              templates={lista}
              indice={indice}
              aoEscolher={(i) => {
                setIndice(i);
                setValores({});
              }}
              valores={valores}
              aoMudarValor={(token, valor) =>
                setValores((v) => ({ ...v, [token]: valor }))
              }
              nomeContato={nomeContato}
              rotulo="Template para enviar (opcional)"
              comNenhum
            />
          </>
        )}
      </form>
    </Folha>
  );
}

/* ── A faixa no topo da conversa ──────────────────────────────────────── */

/** O nome da faixa pelo dia: "Recontato de hoje", "Recontato atrasado". */
function tituloDaFaixa(dia: string, hoje: string): string {
  if (dia === hoje) return "Recontato de hoje";
  if (dia < hoje) return "Recontato atrasado";
  return "Recontato agendado";
}

/**
 * A faixa do recontato pendente mais cedo, embaixo do cabeçalho da
 * conversa: o motivo, quando e por quem, e as ações. Do dia (ou atrasado),
 * o nome vai na cor de atenção. Quem só lê vê a faixa sem os botões.
 */
export function FaixaRecontato({
  recontato,
  hoje,
  somenteLeitura,
  podeEnviarTemplate,
  pendente,
  aoEnviarTemplate,
  aoFeito,
  aoReagendar,
  aoCancelar,
  gatilhoRef,
}: {
  recontato: Recontato;
  /** "AAAA-MM-DD" de hoje, em Brasília. */
  hoje: string;
  somenteLeitura: boolean;
  /** O contato tem telefone e os templates carregaram. */
  podeEnviarTemplate: boolean;
  /** Um gesto da faixa está gravando. */
  pendente: boolean;
  aoEnviarTemplate: () => void;
  aoFeito: () => void;
  aoReagendar: () => void;
  aoCancelar: () => void;
  /** Para onde o foco volta quando o diálogo aberto daqui fecha. */
  gatilhoRef?: RefObject<HTMLButtonElement | null>;
}) {
  const idTitulo = useId();
  const { dia, hora } = partesEmBrasilia(recontato.quando);
  const doDia = dia <= hoje;
  const quando =
    dia === hoje
      ? `hoje às ${horaEmTexto(hora)}`
      : dia < hoje
        ? `era para ${diaEmTexto(dia, hoje)} às ${horaEmTexto(hora)}`
        : quandoEmTexto(recontato.quando, hoje);
  const template = recontato.template;
  // Gravando, os botões não se desativam: desativado, o botão largava o
  // foco no body, e a próxima letra virava atalho do chat (E resolve). Ficam
  // aria-disabled, e o toque repetido é ignorado.
  const seLivre = (acao: () => void) => () => {
    if (!pendente) acao();
  };
  const ocupado = pendente || undefined;
  return (
    <section
      aria-labelledby={idTitulo}
      aria-busy={ocupado}
      data-faixa-recontato=""
      className="mx-2 mt-1.5 shrink-0 rounded-painel bg-cartao py-1 pr-1 pl-1.5 md:mx-3"
    >
      <div className="flex items-start gap-1">
        <CalendarClock
          size={18}
          strokeWidth={1.75}
          aria-hidden
          className={cn(
            "mt-[2px] shrink-0",
            doDia ? "text-atencao" : "text-texto-2",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="tipo-corpo break-words text-tinta">
            <span
              id={idTitulo}
              className={cn("font-semibold", doDia && "text-atencao")}
            >
              {tituloDaFaixa(dia, hoje)}:
            </span>{" "}
            {recontato.motivo}
          </p>
          {/* O nome do template da Meta não tem espaço (snake_case): quebra
              em qualquer ponto, senão abre rolagem lateral em 375px. */}
          <p className="tipo-nota text-texto-2 [overflow-wrap:anywhere]">
            {quando}
            {recontato.porNome ? ` · por ${recontato.porNome}` : ""}
            {template ? ` · template ${template.nome}` : ""}
          </p>
        </div>
      </div>
      {!somenteLeitura ? (
        <div className="mt-1 flex flex-wrap gap-1 pointer-coarse:gap-1.5">
          {template && podeEnviarTemplate ? (
            <Button
              variant="secondary"
              size="sm"
              aria-disabled={ocupado}
              onClick={seLivre(aoEnviarTemplate)}
              aria-haspopup="dialog"
              icone={<Send size={16} strokeWidth={1.75} aria-hidden />}
              className="max-w-full pointer-coarse:h-[44px]"
              title={`Enviar o template ${template.nome}; o recontato fica feito`}
            >
              <span className="min-w-0 truncate">Enviar {template.nome}</span>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            aria-disabled={ocupado}
            onClick={seLivre(aoFeito)}
            icone={<Check size={16} strokeWidth={2} aria-hidden />}
            className="pointer-coarse:h-[44px]"
          >
            Feito
          </Button>
          <Button
            ref={gatilhoRef}
            variant="ghost"
            size="sm"
            aria-disabled={ocupado}
            onClick={seLivre(aoReagendar)}
            aria-haspopup="dialog"
            className="pointer-coarse:h-[44px]"
          >
            Reagendar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-disabled={ocupado}
            onClick={seLivre(aoCancelar)}
            className="pointer-coarse:h-[44px]"
          >
            Cancelar
          </Button>
        </div>
      ) : null}
    </section>
  );
}
