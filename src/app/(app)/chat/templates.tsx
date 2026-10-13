"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { FileText, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateWhatsapp } from "@/lib/whatsapp";
import { formatarData } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/etiqueta";
import { CAMPO, ROTULO } from "@/components/app/form-styles";
import { nomeEhGenerico, primeiroNome } from "@/app/(app)/campanhas/regras";
import { normalizarBusca } from "@/app/(app)/conversas/barra-filtros";
import { Folha, Grupo, RotuloGrupo } from "@/app/(app)/conversas/folha";
import {
  enviarTemplateLead,
  historicoTemplatesLead,
  type ResultadoEnvio,
} from "./actions";

const ESTADO: ResultadoEnvio = {};

/** Acima de tantos templates, a lista ganha a busca no topo (o mesmo teto
 *  dos menus da fila). */
const TEMPLATES_SEM_BUSCA = 8;

type Historico = {
  total: number;
  ultimoEm: string | null;
  ultimoNome: string | null;
  em30Dias: number;
  falhou: boolean;
};

/**
 * O envio de template aprovado do WhatsApp: o caminho para falar com o
 * contato fora da janela de 24h e para o primeiro contato. No celular é uma
 * folha presa no pé; do tablet para cima, janela centralizada. Sai por
 * portal: quem abre vive dentro do form do compositor, e form aninhado é
 * inválido.
 *
 * Antes do envio aparece quantos templates este contato já custou, que é
 * onde se decide gastar mais um.
 *
 * Embaixo de cada variável, o chip "Nome: João" preenche o primeiro nome do
 * contato pela mesma regra das campanhas (primeiroNome, em
 * campanhas/regras.ts); com nome que o sistema inventou ("Lead 1234"), o
 * chip não aparece. O campo continua editável e a prévia mostra o resultado.
 * Com mais de TEMPLATES_SEM_BUSCA templates, a lista ganha a busca.
 */
export function DialogoTemplate({
  aberto,
  aoFechar,
  leadId,
  nomeContato = null,
  templates,
  inicial = null,
  recontatoId = null,
  aoEnviar,
  aoEnvioEmVoo,
  retorno,
}: {
  aberto: boolean;
  aoFechar: () => void;
  leadId: string;
  /** O nome do contato, para o chip "Nome: João" das variáveis. */
  nomeContato?: string | null;
  templates: TemplateWhatsapp[];
  /** Aberto pela faixa do recontato: o template e as variáveis que ficaram
   *  no agendamento já vêm escolhidos (e continuam editáveis). */
  inicial?: {
    nome: string;
    idioma: string;
    variaveis: Record<string, string>;
  } | null;
  /** O recontato que este envio fecha: o servidor grava o "feito" junto. */
  recontatoId?: string | null;
  /** O template saiu: a Janela põe a interação na conversa e a fila acerta
   *  a linha (o servidor diz se quem enviou assumiu a conversa). */
  aoEnviar?: (resultado: ResultadoEnvio) => void;
  /** O template está no ar (true) ou teve desfecho (false): a fila e a
   *  casca seguram o que desmontaria a Janela, como no envio de texto. */
  aoEnvioEmVoo?: (leadId: string, emVoo: boolean) => void;
  retorno?: React.RefObject<HTMLElement | null>;
}) {
  const idForm = useId();
  const [indice, setIndice] = useState<number | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [estado, formAction, enviando] = useActionState(
    enviarTemplateLead,
    ESTADO,
  );
  const [historico, setHistorico] = useState<Historico | null>(null);
  // O template do recontato que não está mais entre os aprovados.
  const [semInicial, setSemInicial] = useState<string | null>(null);
  // Cada abertura monta a escolha de novo (a busca começa vazia).
  const [abertura, setAbertura] = useState(0);

  // Abrir zera o número anterior (ajuste durante o render): reabrir depois
  // de enviar mostrava o valor que o próprio envio tornou falso. Pela faixa
  // do recontato, abre com o template e as variáveis do agendamento.
  const [abertoAntes, setAbertoAntes] = useState(aberto);
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto);
    if (aberto) {
      setHistorico(null);
      setSemInicial(null);
      setAbertura((n) => n + 1);
      if (inicial) {
        const i = templates.findIndex(
          (t) => t.nome === inicial.nome && t.idioma === inicial.idioma,
        );
        setIndice(i === -1 ? null : i);
        setValores(i === -1 ? {} : { ...inicial.variaveis });
        if (i === -1) setSemInicial(inicial.nome);
      }
    }
  }

  // Concluiu: limpa a escolha (ajuste durante o render) e o pai fecha.
  const [estadoAnterior, setEstadoAnterior] = useState(estado);
  if (estado !== estadoAnterior) {
    setEstadoAnterior(estado);
    if (estado.ok) {
      setIndice(null);
      setValores({});
      setHistorico(null);
    }
  }

  // Avisar quem abriu é efeito, não render: ele muda o próprio estado (e o
  // da fila), e componente nenhum mexe no estado de outro enquanto
  // renderiza.
  const aoEnviarRef = useRef(aoEnviar);
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoEnviarRef.current = aoEnviar;
    aoFecharRef.current = aoFechar;
  });
  useEffect(() => {
    if (!estado.ok) return;
    aoEnviarRef.current?.(estado);
    aoFecharRef.current();
  }, [estado]);

  // Do clique ao desfecho, o envio está no ar: trocar de conversa ou de
  // tela agora levaria junto o erro da Meta. Desmontar também solta.
  useEffect(() => {
    if (!enviando || !aoEnvioEmVoo) return;
    aoEnvioEmVoo(leadId, true);
    return () => aoEnvioEmVoo(leadId, false);
  }, [enviando, leadId, aoEnvioEmVoo]);

  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    void historicoTemplatesLead(leadId)
      .then((h) => {
        if (vivo) setHistorico(h);
      })
      .catch(() => {
        // Não some em silêncio: sem o aviso, a tela ficaria igual à de um
        // contato que nunca recebeu template, o contrário do que houve.
        if (vivo) {
          setHistorico({
            total: 0,
            ultimoEm: null,
            ultimoNome: null,
            em30Dias: 0,
            falhou: true,
          });
        }
      });
    return () => {
      vivo = false;
    };
  }, [aberto, leadId]);

  const escolhido = indice !== null ? (templates[indice] ?? null) : null;

  // Com o envio no ar a folha não fecha (Esc, X, Cancelar, arrasto): fechada,
  // o erro da Meta ficaria dentro dela e a pessoa acharia que o template saiu.
  const fecharSeLivre = () => {
    if (!enviando) aoFechar();
  };

  return (
    <Folha
      aberta={aberto}
      aoFechar={fecharSeLivre}
      titulo="Enviar template"
      forma="centro"
      retorno={retorno}
      rodape={
        <div className="flex flex-col gap-1">
          {estado.erro ? (
            <p role="alert" className="tipo-nota text-erro">
              {estado.erro}
            </p>
          ) : null}
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="secondary"
              onClick={fecharSeLivre}
              disabled={enviando}
              className="pointer-coarse:h-[44px]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form={idForm}
              disabled={!escolhido}
              carregando={enviando}
              className="pointer-coarse:h-[44px]"
            >
              {enviando ? "Enviando…" : "Enviar template"}
            </Button>
          </div>
        </div>
      }
    >
      {historico?.falhou ? (
        <p className="tipo-nota pt-0.5 text-texto-2">
          A contagem de templates deste contato não carregou.
        </p>
      ) : historico && historico.total > 0 ? (
        <p
          className={cn(
            "tipo-nota pt-0.5",
            historico.em30Dias >= 3 ? "text-atencao" : "text-texto-2",
          )}
        >
          Já foram{" "}
          <span className="font-semibold tabular-nums">
            {historico.total.toLocaleString("pt-BR")}
          </span>{" "}
          {historico.total === 1 ? "template" : "templates"} para este contato
          {historico.em30Dias > 0 ? (
            <>
              {" · "}
              <span className="tabular-nums">
                {historico.em30Dias.toLocaleString("pt-BR")}
              </span>{" "}
              nos últimos 30 dias
            </>
          ) : null}
          {historico.ultimoEm
            ? ` · último em ${formatarData(historico.ultimoEm)}`
            : ""}
          .
        </p>
      ) : null}

      {semInicial ? (
        <p className="tipo-nota pt-0.5 text-atencao">
          O template {semInicial} do recontato não está mais entre os
          aprovados. Escolha outro.
        </p>
      ) : null}

      <form id={idForm} action={formAction} className="min-w-0">
        <input type="hidden" name="lead_id" value={leadId} />
        <input
          type="hidden"
          name="template_nome"
          value={escolhido?.nome ?? ""}
        />
        <input
          type="hidden"
          name="template_idioma"
          value={escolhido?.idioma ?? ""}
        />
        {recontatoId ? (
          <input type="hidden" name="recontato_id" value={recontatoId} />
        ) : null}
        <EscolhaTemplate
          key={abertura}
          templates={templates}
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
          rotulo="Template"
          comNomesDoForm
        />
      </form>
    </Folha>
  );
}

/**
 * A escolha do template: a busca (com mais de TEMPLATES_SEM_BUSCA), a
 * lista de rádio, as variáveis com o chip "Nome: João" e a prévia. Serve ao
 * envio de template e ao agendamento do recontato (que oferece "Nenhum").
 * Os ids e o nome do grupo de rádio são desta instância: as duas folhas
 * podem estar no DOM ao mesmo tempo.
 */
export function EscolhaTemplate({
  templates,
  indice,
  aoEscolher,
  valores,
  aoMudarValor,
  nomeContato = null,
  rotulo,
  comNenhum = false,
  comNomesDoForm = false,
}: {
  templates: TemplateWhatsapp[];
  /** A posição do escolhido em `templates`; null = nenhum. */
  indice: number | null;
  aoEscolher: (indice: number | null) => void;
  valores: Record<string, string>;
  aoMudarValor: (token: string, valor: string) => void;
  nomeContato?: string | null;
  rotulo: string;
  /** "Nenhum" no topo da lista (o template do recontato é opcional). */
  comNenhum?: boolean;
  /** Os campos das variáveis vão no formulário (param_<token>). */
  comNomesDoForm?: boolean;
}) {
  const base = useId();
  const idRotulo = `${base}-rotulo`;
  const nomeGrupo = `${base}-template`;
  const [termo, setTermo] = useState("");
  const escolhido = indice !== null ? (templates[indice] ?? null) : null;
  // O primeiro nome do contato, pela regra das campanhas; nome inventado
  // pelo sistema não vira chip.
  const nomeDoContato =
    nomeContato && !nomeEhGenerico(nomeContato)
      ? primeiroNome(nomeContato, "")
      : "";
  const comBusca = templates.length > TEMPLATES_SEM_BUSCA;
  const t = normalizarBusca(termo);
  // A escolha fica na lista mesmo que a busca não a ache: o rádio marcado
  // não some debaixo do dedo.
  const naLista = templates
    .map((template, i) => ({ template, i }))
    .filter(
      ({ template, i }) =>
        !t ||
        i === indice ||
        normalizarBusca(template.nome).includes(t) ||
        normalizarBusca(template.corpo).includes(t),
    );
  const previa = escolhido
    ? escolhido.corpo.replace(
        /\{\{\s*([^{}]+?)\s*\}\}/g,
        (bloco, token: string) => valores[token]?.trim() || bloco,
      )
    : "";

  return (
    <div className="min-w-0">
      <RotuloGrupo id={idRotulo}>{rotulo}</RotuloGrupo>
      {comBusca ? (
        <label className="relative mb-1 block">
          <span className="sr-only">Buscar template</span>
          <Search
            size={18}
            strokeWidth={1.75}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-texto-3"
          />
          <input
            type="search"
            value={termo}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              // Dentro do formulário, o Enter enviaria o template.
              if (e.key === "Enter") e.preventDefault();
              if (e.key === "Escape" && termo) {
                e.preventDefault();
                e.stopPropagation();
                setTermo("");
              }
            }}
            placeholder="Buscar pelo nome ou pelo texto"
            className={cn(
              CAMPO,
              "w-full bg-cartao pl-4 [&::-webkit-search-cancel-button]:hidden",
            )}
          />
        </label>
      ) : null}
      <div role="radiogroup" aria-labelledby={idRotulo} className="min-w-0">
        {naLista.length === 0 ? (
          <p className="tipo-corpo px-1.5 py-1.5 text-texto-2">
            Nenhum template com “{termo.trim()}”.
          </p>
        ) : null}
        <Grupo className={naLista.length === 0 ? "hidden" : undefined}>
          {comNenhum ? (
            <label className="group/linha flex cursor-pointer items-center gap-1.5 pl-1.5 transition-colors duration-[120ms] hover:bg-realce has-[:checked]:bg-selecao">
              <input
                type="radio"
                name={nomeGrupo}
                checked={indice === null}
                onChange={() => aoEscolher(null)}
                className="h-[18px] w-[18px] shrink-0"
              />
              <span className="tipo-corpo flex min-h-[48px] min-w-0 flex-1 items-center border-t border-fio py-1 pr-1.5 text-tinta group-first/linha:border-t-0">
                Nenhum
              </span>
            </label>
          ) : null}
          {naLista.map(({ template, i }) => (
            <label
              key={`${template.nome}-${template.idioma}`}
              className="group/linha flex cursor-pointer items-start gap-1.5 pl-1.5 transition-colors duration-[120ms] hover:bg-realce has-[:checked]:bg-selecao"
            >
              <input
                type="radio"
                name={nomeGrupo}
                checked={indice === i}
                onChange={() => aoEscolher(i)}
                className="mt-[18px] h-[18px] w-[18px] shrink-0"
              />
              <span className="min-w-0 flex-1 border-t border-fio py-1.5 pr-1.5 group-first/linha:border-t-0">
                <span className="flex items-baseline gap-1">
                  <span className="tipo-destaque min-w-0 flex-1 truncate text-tinta">
                    {template.nome}
                  </span>
                  <span className="tipo-nota shrink-0 text-texto-2">
                    {template.idioma}
                  </span>
                </span>
                <span className="tipo-nota mt-0.5 line-clamp-2 break-words text-texto-2">
                  {template.corpo}
                </span>
              </span>
            </label>
          ))}
        </Grupo>
      </div>

      {escolhido && escolhido.parametros.length > 0 ? (
        <div className="flex flex-col gap-1.5 pt-2">
          {escolhido.parametros.map((token) => (
            <div key={token} className="flex min-w-0 flex-col gap-0.5">
              <label htmlFor={`${base}-param-${token}`} className={ROTULO}>
                Variável {`{{${token}}}`}
              </label>
              <input
                id={`${base}-param-${token}`}
                name={comNomesDoForm ? `param_${token}` : undefined}
                required={comNomesDoForm}
                autoComplete="off"
                value={valores[token] ?? ""}
                onChange={(e) => aoMudarValor(token, e.target.value)}
                className={cn(CAMPO, "w-full")}
              />
              {nomeDoContato ? (
                // Preenche, não alterna: o campo segue editável.
                <div className="pt-0.5">
                  <Chip
                    aria-pressed={undefined}
                    aria-label={`Preencher a variável {{${token}}} com o nome: ${nomeDoContato}`}
                    onClick={() => aoMudarValor(token, nomeDoContato)}
                  >
                    Nome: {nomeDoContato}
                  </Chip>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {escolhido ? (
        <>
          <RotuloGrupo>Prévia</RotuloGrupo>
          <Grupo className="px-1.5 py-1.5">
            <p className="tipo-corpo break-words whitespace-pre-wrap text-tinta">
              {previa}
            </p>
          </Grupo>
        </>
      ) : null}
    </div>
  );
}

/**
 * O botão "Enviar template" com o diálogo. `principal`: a janela de 24h
 * fechou (ou o contato nunca escreveu) e o template é a única saída: vira o
 * botão principal do compositor, no lugar do Enviar.
 */
export function BotaoTemplates({
  leadId,
  nomeContato = null,
  templates,
  principal = false,
  aoEnviar,
  aoEnvioEmVoo,
  className,
}: {
  leadId: string;
  /** O nome do contato, para o chip "Nome: João" das variáveis. */
  nomeContato?: string | null;
  templates: TemplateWhatsapp[];
  principal?: boolean;
  aoEnviar?: (resultado: ResultadoEnvio) => void;
  aoEnvioEmVoo?: (leadId: string, emVoo: boolean) => void;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);

  if (templates.length === 0) return null;

  return (
    <>
      <Button
        ref={gatilho}
        // Mora dentro do form do compositor: sem o type, enviaria a
        // mensagem vazia em vez de abrir o diálogo.
        type="button"
        variant={principal ? "primary" : "secondary"}
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        icone={<FileText size={18} strokeWidth={1.75} aria-hidden />}
        title="Enviar template do WhatsApp (vale fora da janela de 24h)"
        className={cn("pointer-coarse:h-[44px]", className)}
      >
        Enviar template
      </Button>
      <DialogoTemplate
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        leadId={leadId}
        nomeContato={nomeContato}
        templates={templates}
        aoEnviar={aoEnviar}
        aoEnvioEmVoo={aoEnvioEmVoo}
        retorno={gatilho}
      />
    </>
  );
}
