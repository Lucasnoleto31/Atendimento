import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { formatarReais, formatarTelefone } from "@/lib/format";
import { CAMPO, BOTAO_ICONE, BOTAO_ICONE_PERIGO } from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import {
  listarTemplatesMeta,
  metaConfigurada,
  type TemplateWhatsapp,
} from "@/lib/whatsapp";
import { CORES_ETIQUETA, estiloEtiqueta } from "@/lib/etiquetas";
import { SeletorCorTag } from "./cor-tag";
import {
  alternarInstancia,
  alternarProduto,
  alternarRegraCadencia,
  atualizarInstancia,
  atualizarMensagem,
  atualizarProduto,
  criarInstancia,
  criarMensagem,
  criarProduto,
  criarRegraCadencia,
  criarTag,
  excluirInstancia,
  excluirMensagem,
  excluirProduto,
  excluirRegraCadencia,
  excluirTag,
  salvarMeta,
  salvarMetaTipo,
  salvarMetaContatos,
  salvarParametro,
  salvarWhatsapp,
  criarTemplateResumo,
} from "./actions";
import { AnexosMensagem, type AnexoMensagem } from "./anexos-mensagem";

export const metadata: Metadata = { title: "Configurações · Zeve CRM" };

const RECORRENCIAS = [
  { valor: "unica", rotulo: "Única" },
  { valor: "recorrente", rotulo: "Recorrente" },
  { valor: "por_operacao", rotulo: "Por operação" },
];

const PARAMETROS = [
  {
    chave: "queda_lotes_percentual",
    rotulo: "Queda de lotes (%)",
    ajuda: "Queda em 30 dias que devolve o cliente para a fila.",
  },
  {
    chave: "dias_sem_giro",
    rotulo: "Dias sem giro",
    ajuda: "Dias sem operar para entrar na lista de reativação.",
  },
  {
    chave: "dias_sem_resposta",
    rotulo: "Dias sem resposta",
    ajuda: "Dias sem resposta do lead para marcá-lo como sem resposta.",
  },
  {
    chave: "minutos_alerta_espera",
    rotulo: "Alerta de espera (min)",
    ajuda: "Minutos aguardando resposta para destacar a conversa no Chat.",
  },
  {
    chave: "distribuicao_automatica",
    rotulo: "Distribuição automática (0/1)",
    ajuda: "1 = lead novo do WhatsApp vai para o vendedor com menos atendimentos.",
  },
  {
    chave: "dias_churn",
    rotulo: "Dias para churn",
    ajuda: "Dias sem giro para considerar o cliente perdido (padrão 60).",
  },
  {
    chave: "envios_teto_dia",
    rotulo: "Teto de envios automáticos/dia",
    ajuda:
      "Orçamento único do número: cadência + campanhas + disparo em massa param quando a soma bate aqui. Suba com a qualidade verde; desça se cair para amarela.",
  },
  {
    chave: "cadencia_por_dia",
    rotulo: "Cadência: envios/dia",
    ajuda: "Teto próprio da cadência, dentro do orçamento único acima.",
  },
  {
    chave: "custo_template_centavos",
    rotulo: "Custo por template (centavos)",
    ajuda: "Usado no gasto por etiqueta dos Relatórios. Padrão: 25.",
  },
  {
    chave: "receita_por_lote",
    rotulo: "Receita por lote (R$)",
    ajuda: "Receita média da assessoria por lote girado; habilita LTV e receita em risco (0 desliga).",
  },
  {
    chave: "resumo_gestor_ativo",
    rotulo: "Resumo diário do gestor (0/1)",
    ajuda:
      "1 = às 18h30 de dia útil o dia da mesa chega no WhatsApp de gestor/admin com número cadastrado abaixo. Exige o template resumo_diario aprovado na Meta.",
  },
];

const ROTULO_ANCORA: Record<string, string> = {
  lead_criado: "Lead sem resposta",
  conta_aberta: "Conta aberta sem 1º giro",
  sem_giro: "Cliente sem giro (repete mensal)",
  queda_lotes: "Queda de lotes (repete mensal)",
};

export default async function ConfiguracoesPage({
  searchParams,
}: PageProps<"/configuracoes">) {
  const perfil = await perfilAtual();
  if (!perfil || (perfil.papel !== "admin" && perfil.papel !== "gestor")) {
    redirect("/hoje");
  }

  const params = await searchParams;
  const aviso = typeof params.aviso === "string" ? params.aviso : null;
  // Carimbo do terminar(): muda a cada volta de action e serve de key para
  // resetar os formulários com estado de cliente (anexos das mensagens).
  const carimboVolta = typeof params.t === "string" ? params.t : "0";

  const supabase = await createClient();
  const [
    { data: produtos },
    { data: tags },
    { data: mensagens, comAnexos: anexosMensagemDisponiveis },
    { data: instancias },
    { data: equipe },
    { data: parametros },
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id, codigo, nome, valor_comissao_centavos, recorrencia, ativo")
      .order("codigo"),
    supabase
      .from("tags")
      .select("id, nome, cor")
      .order("nome")
      .then((r) =>
        r.error ? supabase.from("tags").select("id, nome").order("nome") : r,
      ),
    // Anexos das prontas (0060); sem a migração, cai para o formato antigo —
    // e a marca comAnexos vem da CONSULTA (lista vazia não prova nada).
    supabase
      .from("quick_replies")
      .select("id, titulo, corpo, anexos")
      .order("titulo")
      .then((r) =>
        r.error
          ? supabase
              .from("quick_replies")
              .select("id, titulo, corpo")
              .order("titulo")
              .then((r2) => ({ ...r2, comAnexos: false }))
          : { ...r, comAnexos: true },
      ),
    supabase
      .from("whatsapp_instances")
      .select("id, nome, telefone_e164, vendedor_id, ativa, meta_phone_number_id")
      .order("nome"),
    supabase
      .from("profiles")
      // "*": as metas por tipo (0050) entram quando a migração rodar, e a
      // tela funciona igual antes dela.
      .select("*")
      .eq("ativo", true)
      .order("nome"),
    supabase.from("settings").select("chave, valor"),
  ]);

  const valorParametro = new Map(
    ((parametros ?? []) as { chave: string; valor: unknown }[]).map((p) => [
      p.chave,
      String(p.valor),
    ]),
  );

  const listaEquipe = (equipe ?? []) as {
    id: string;
    nome: string;
    papel: string;
    meta_mensal_centavos: number;
    meta_contas_mes?: number | null;
    meta_ativacoes_mes?: number | null;
    whatsapp_e164?: string | null;
  }[];
  const metasTipoDisponiveis = listaEquipe.some(
    (v) => v.meta_contas_mes !== undefined,
  );
  // Coluna da 0057: sem ela, o campo de WhatsApp da equipe nem aparece.
  const whatsappDisponivel = listaEquipe.some(
    (v) => v.whatsapp_e164 !== undefined,
  );

  // Recursos da migração 0013 e templates: tolerantes a ambiente incompleto.
  const [{ data: regrasCadencia }, { data: metasContato }, templatesWhatsapp] =
    await Promise.all([
      supabase
        .from("followup_rules")
        .select("id, dias, template_nome, template_idioma, ativo, ancora")
        .order("dias"),
      supabase.from("profiles").select("id, meta_contatos_dia"),
      // Sem a Meta configurada a tela abre sem templates (a cadência avisa).
      (metaConfigurada()
        ? listarTemplatesMeta()
        : Promise.resolve([] as TemplateWhatsapp[])
      ).catch(() => [] as TemplateWhatsapp[]),
    ]);

  const cadenciaDisponivel = regrasCadencia !== null;
  const listaRegras = (regrasCadencia ?? []) as {
    id: string;
    dias: number;
    template_nome: string;
    template_idioma: string;
    ativo: boolean;
    ancora?: string | null;
  }[];
  const metaContatosPorPessoa = new Map(
    ((metasContato ?? []) as { id: string; meta_contatos_dia: number }[]).map(
      (m) => [m.id, m.meta_contatos_dia],
    ),
  );
  const metaContatosDisponivel = metasContato !== null;
  const templatesAutomatizaveis = templatesWhatsapp.filter(
    (t) => t.parametros.length <= 1,
  );

  return (
    <div className="p-2 md:p-3">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Configurações</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          Produtos, tags, mensagens padrão, instâncias de WhatsApp, metas e os
          parâmetros da reativação.
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

      {/* Produtos ---------------------------------------------------------- */}
      <section className="mt-3" aria-labelledby="produtos-titulo">
        <h2 id="produtos-titulo" className="text-h3 text-neutral-900">
          Produtos
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          O valor é a comissão que o vendedor recebe por venda.
        </p>

        <div className="mt-2 flex flex-col gap-1">
          {((produtos ?? []) as {
            id: string;
            codigo: string;
            nome: string;
            valor_comissao_centavos: number;
            recorrencia: string;
            ativo: boolean;
          }[]).map((produto) => (
            <div key={produto.id} className="flex flex-wrap items-center gap-1">
              <form
                action={atualizarProduto}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
              >
                <input type="hidden" name="id" value={produto.id} />
                <label htmlFor={`prod-cod-${produto.id}`} className="sr-only">
                  Código
                </label>
                <input
                  id={`prod-cod-${produto.id}`}
                  name="codigo"
                  defaultValue={produto.codigo}
                  required
                  className={cn(CAMPO, "w-[104px] font-mono text-xs uppercase")}
                />
                <label htmlFor={`prod-nome-${produto.id}`} className="sr-only">
                  Nome
                </label>
                <input
                  id={`prod-nome-${produto.id}`}
                  name="nome"
                  defaultValue={produto.nome}
                  required
                  className={cn(CAMPO, "min-w-[160px] flex-1")}
                />
                <label htmlFor={`prod-valor-${produto.id}`} className="sr-only">
                  Comissão em reais
                </label>
                <input
                  id={`prod-valor-${produto.id}`}
                  name="valor"
                  defaultValue={(produto.valor_comissao_centavos / 100)
                    .toFixed(2)
                    .replace(".", ",")}
                  required
                  inputMode="decimal"
                  className={cn(CAMPO, "w-[96px] text-right font-mono tabular-nums")}
                />
                <label htmlFor={`prod-rec-${produto.id}`} className="sr-only">
                  Recorrência
                </label>
                <select
                  id={`prod-rec-${produto.id}`}
                  name="recorrencia"
                  defaultValue={produto.recorrencia}
                  className={cn(CAMPO, "w-[136px]")}
                >
                  {RECORRENCIAS.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.rotulo}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  aria-label={`Salvar produto ${produto.nome}`}
                  className={BOTAO_ICONE}
                >
                  <Check size={18} strokeWidth={1.5} aria-hidden />
                </button>
              </form>

              <form action={alternarProduto}>
                <input type="hidden" name="id" value={produto.id} />
                <button
                  type="submit"
                  aria-pressed={produto.ativo}
                  title={produto.ativo ? "Desativar" : "Reativar"}
                  className={cn(
                    "inline-flex h-[20px] items-center rounded-sm px-1 text-xs transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                    produto.ativo
                      ? "bg-success-bg text-success"
                      : "bg-neutral-100 text-neutral-400",
                  )}
                >
                  {produto.ativo ? "ativo" : "inativo"}
                </button>
              </form>

              <form action={excluirProduto}>
                <input type="hidden" name="id" value={produto.id} />
                <button
                  type="submit"
                  aria-label={`Excluir produto ${produto.nome}`}
                  className={cn(BOTAO_ICONE, BOTAO_ICONE_PERIGO)}
                >
                  <Trash2 size={18} strokeWidth={1.5} aria-hidden />
                </button>
              </form>
            </div>
          ))}

          <form action={criarProduto} className="flex flex-wrap items-center gap-1">
            <label htmlFor="novo-prod-cod" className="sr-only">
              Código do novo produto
            </label>
            <input
              id="novo-prod-cod"
              name="codigo"
              placeholder="CT-PJ"
              required
              className={cn(CAMPO, "w-[104px] font-mono text-xs uppercase")}
            />
            <label htmlFor="novo-prod-nome" className="sr-only">
              Nome do novo produto
            </label>
            <input
              id="novo-prod-nome"
              name="nome"
              placeholder="Nome do produto…"
              required
              className={cn(CAMPO, "min-w-[160px] flex-1")}
            />
            <label htmlFor="novo-prod-valor" className="sr-only">
              Comissão em reais
            </label>
            <input
              id="novo-prod-valor"
              name="valor"
              placeholder="15,00"
              required
              inputMode="decimal"
              className={cn(CAMPO, "w-[96px] text-right font-mono tabular-nums")}
            />
            <label htmlFor="novo-prod-rec" className="sr-only">
              Recorrência
            </label>
            <select
              id="novo-prod-rec"
              name="recorrencia"
              defaultValue="unica"
              className={cn(CAMPO, "w-[136px]")}
            >
              {RECORRENCIAS.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.rotulo}
                </option>
              ))}
            </select>
            <button type="submit" aria-label="Adicionar produto" className={BOTAO_ICONE}>
              <Plus size={18} strokeWidth={1.5} aria-hidden />
            </button>
          </form>
        </div>
      </section>

      {/* Tags -------------------------------------------------------------- */}
      <section className="mt-4" aria-labelledby="tags-titulo">
        <h2 id="tags-titulo" className="text-h3 text-neutral-900">
          Etiquetas
        </h2>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
          Etiqueta marca <strong className="font-medium">interesse</strong> do
          lead e a <strong className="font-medium">campanha</strong> de onde
          ele veio. A fase do funil não é etiqueta — é a coluna do kanban, em
          Atendimento. Guardar a fase nos dois lugares faz um contradizer o
          outro.
        </p>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
          A cor pinta a faixa lateral da conversa no Chat e o cartão no
          Atendimento — a equipe reconhece o assunto de relance.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {(
            (tags ?? []) as { id: string; nome: string; cor?: string | null }[]
          ).map((tag) => (
            <span
              key={tag.id}
              className={cn(
                "inline-flex items-center gap-0.5 rounded-sm py-0.5 pr-0.5 pl-1 text-sm",
                estiloEtiqueta(tag.cor).chip,
              )}
            >
              {tag.nome}
              <SeletorCorTag id={tag.id} nome={tag.nome} cor={tag.cor} />
              <form action={excluirTag} className="flex">
                <input type="hidden" name="id" value={tag.id} />
                <button
                  type="submit"
                  aria-label={`Excluir tag ${tag.nome}`}
                  className="inline-flex h-[20px] w-[20px] items-center justify-center rounded-sm opacity-70 transition-opacity duration-[120ms] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  <Trash2 size={12} strokeWidth={1.5} aria-hidden />
                </button>
              </form>
            </span>
          ))}

          <form action={criarTag} className="flex items-center gap-1">
            <label htmlFor="nova-tag" className="sr-only">
              Nome da nova tag
            </label>
            <input
              id="nova-tag"
              name="nome"
              placeholder="Nova tag…"
              required
              className={cn(CAMPO, "w-[160px]")}
            />
            <label htmlFor="nova-tag-cor" className="sr-only">
              Cor da nova tag
            </label>
            <select
              id="nova-tag-cor"
              name="cor"
              defaultValue="azul"
              className={cn(CAMPO, "w-[112px]")}
            >
              {CORES_ETIQUETA.map((c) => (
                <option key={c.chave} value={c.chave}>
                  {c.rotulo}
                </option>
              ))}
            </select>
            <button type="submit" aria-label="Adicionar tag" className={BOTAO_ICONE}>
              <Plus size={18} strokeWidth={1.5} aria-hidden />
            </button>
          </form>
        </div>
      </section>

      {/* Mensagens padrão --------------------------------------------------- */}
      <section className="mt-4" aria-labelledby="mensagens-titulo">
        <h2 id="mensagens-titulo" className="text-h3 text-neutral-900">
          Mensagens padrão
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Textos prontos para a equipe disparar na conversa com o lead.
        </p>

        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          {((mensagens ?? []) as {
            id: string;
            titulo: string;
            corpo: string;
            anexos?: AnexoMensagem[] | null;
          }[]).map(
            (msg) => (
              <form
                key={`${msg.id}-${carimboVolta}`}
                action={atualizarMensagem}
                className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-sm"
              >
                <input type="hidden" name="id" value={msg.id} />
                <div className="flex items-center gap-1">
                  <label htmlFor={`msg-titulo-${msg.id}`} className="sr-only">
                    Título
                  </label>
                  <input
                    id={`msg-titulo-${msg.id}`}
                    name="titulo"
                    defaultValue={msg.titulo}
                    required
                    className={cn(CAMPO, "flex-1 font-medium")}
                  />
                  <button
                    type="submit"
                    aria-label={`Salvar mensagem ${msg.titulo}`}
                    className={BOTAO_ICONE}
                  >
                    <Check size={18} strokeWidth={1.5} aria-hidden />
                  </button>
                  <button
                    type="submit"
                    formAction={excluirMensagem}
                    aria-label={`Excluir mensagem ${msg.titulo}`}
                    className={cn(BOTAO_ICONE, BOTAO_ICONE_PERIGO)}
                  >
                    <Trash2 size={18} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
                <label htmlFor={`msg-corpo-${msg.id}`} className="sr-only">
                  Texto da mensagem
                </label>
                <textarea
                  id={`msg-corpo-${msg.id}`}
                  name="corpo"
                  defaultValue={msg.corpo}
                  required
                  rows={3}
                  className="rounded-md border border-neutral-300 bg-neutral-0 px-1.5 py-1 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                />
                {anexosMensagemDisponiveis ? (
                  <AnexosMensagem
                    idBase={msg.id}
                    existentes={msg.anexos ?? []}
                  />
                ) : null}
              </form>
            ),
          )}

          <form
            key={`nova-${carimboVolta}`}
            action={criarMensagem}
            className="flex flex-col gap-1 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2"
          >
            <div className="flex items-center gap-1">
              <label htmlFor="nova-msg-titulo" className="sr-only">
                Título da nova mensagem
              </label>
              <input
                id="nova-msg-titulo"
                name="titulo"
                placeholder="Título (ex.: Primeiro contato)"
                required
                className={cn(CAMPO, "flex-1")}
              />
              <button
                type="submit"
                aria-label="Adicionar mensagem"
                className={BOTAO_ICONE}
              >
                <Plus size={18} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <label htmlFor="nova-msg-corpo" className="sr-only">
              Texto da nova mensagem
            </label>
            <textarea
              id="nova-msg-corpo"
              name="corpo"
              placeholder="Texto da mensagem…"
              required
              rows={3}
              className="rounded-md border border-neutral-300 bg-neutral-0 px-1.5 py-1 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            />
            {anexosMensagemDisponiveis ? (
              <AnexosMensagem idBase="nova" existentes={[]} />
            ) : null}
          </form>
        </div>
      </section>

      {/* Instâncias --------------------------------------------------------- */}
      <section className="mt-4" aria-labelledby="instancias-titulo">
        <h2 id="instancias-titulo" className="text-h3 text-neutral-900">
          Instâncias de WhatsApp
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Até 10 números, cada um associado a um vendedor. A conexão com o
          número oficial da Meta é feita na Administração, pelo webhook.
        </p>

        <div className="mt-2 flex flex-col gap-1">
          {((instancias ?? []) as {
            id: string;
            nome: string;
            telefone_e164: string;
            vendedor_id: string | null;
            ativa: boolean;
            meta_phone_number_id: string | null;
          }[]).map((inst) => (
            <div key={inst.id} className="flex flex-wrap items-center gap-1">
              <form
                action={atualizarInstancia}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
              >
                <input type="hidden" name="id" value={inst.id} />
                <label htmlFor={`inst-nome-${inst.id}`} className="sr-only">
                  Nome da instância
                </label>
                <input
                  id={`inst-nome-${inst.id}`}
                  name="nome"
                  defaultValue={inst.nome}
                  required
                  className={cn(CAMPO, "w-[140px]")}
                />
                <span className="font-mono text-sm text-neutral-600 tabular-nums">
                  {formatarTelefone(inst.telefone_e164)}
                </span>
                <label htmlFor={`inst-vend-${inst.id}`} className="sr-only">
                  Vendedor responsável
                </label>
                <select
                  id={`inst-vend-${inst.id}`}
                  name="vendedor_id"
                  defaultValue={inst.vendedor_id ?? ""}
                  className={cn(CAMPO, "w-[180px]")}
                >
                  <option value="">Sem vendedor</option>
                  {listaEquipe.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nome}
                    </option>
                  ))}
                </select>
                <label htmlFor={`inst-pnid-${inst.id}`} className="sr-only">
                  phone_number_id da Meta
                </label>
                <input
                  id={`inst-pnid-${inst.id}`}
                  name="meta_phone_number_id"
                  defaultValue={inst.meta_phone_number_id ?? ""}
                  placeholder="phone_number_id (Meta)"
                  className={cn(CAMPO, "w-[180px] font-mono text-xs")}
                />
                <button
                  type="submit"
                  aria-label={`Salvar instância ${inst.nome}`}
                  className={BOTAO_ICONE}
                >
                  <Check size={18} strokeWidth={1.5} aria-hidden />
                </button>
              </form>

              <form action={alternarInstancia}>
                <input type="hidden" name="id" value={inst.id} />
                <button
                  type="submit"
                  aria-pressed={inst.ativa}
                  title={inst.ativa ? "Desativar" : "Reativar"}
                  className={cn(
                    "inline-flex h-[20px] items-center rounded-sm px-1 text-xs transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                    inst.ativa
                      ? "bg-success-bg text-success"
                      : "bg-neutral-100 text-neutral-400",
                  )}
                >
                  {inst.ativa ? "ativa" : "inativa"}
                </button>
              </form>

              <form action={excluirInstancia}>
                <input type="hidden" name="id" value={inst.id} />
                <button
                  type="submit"
                  aria-label={`Excluir instância ${inst.nome}`}
                  className={cn(BOTAO_ICONE, BOTAO_ICONE_PERIGO)}
                >
                  <Trash2 size={18} strokeWidth={1.5} aria-hidden />
                </button>
              </form>
            </div>
          ))}

          <form action={criarInstancia} className="flex flex-wrap items-center gap-1">
            <label htmlFor="nova-inst-nome" className="sr-only">
              Nome da nova instância
            </label>
            <input
              id="nova-inst-nome"
              name="nome"
              placeholder="Mesa 01"
              required
              className={cn(CAMPO, "w-[140px]")}
            />
            <label htmlFor="nova-inst-tel" className="sr-only">
              Telefone da instância
            </label>
            <input
              id="nova-inst-tel"
              name="telefone"
              placeholder="11 98842-1170"
              required
              inputMode="tel"
              className={cn(CAMPO, "w-[160px] font-mono tabular-nums")}
            />
            <label htmlFor="nova-inst-vend" className="sr-only">
              Vendedor responsável
            </label>
            <select
              id="nova-inst-vend"
              name="vendedor_id"
              defaultValue=""
              className={cn(CAMPO, "w-[180px]")}
            >
              <option value="">Sem vendedor</option>
              {listaEquipe.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome}
                </option>
              ))}
            </select>
            <label htmlFor="nova-inst-pnid" className="sr-only">
              phone_number_id da Meta
            </label>
            <input
              id="nova-inst-pnid"
              name="meta_phone_number_id"
              placeholder="phone_number_id (Meta)"
              className={cn(CAMPO, "w-[180px] font-mono text-xs")}
            />
            <button
              type="submit"
              aria-label="Adicionar instância"
              className={BOTAO_ICONE}
            >
              <Plus size={18} strokeWidth={1.5} aria-hidden />
            </button>
          </form>
        </div>
      </section>

      {/* Metas -------------------------------------------------------------- */}
      <section className="mt-4" aria-labelledby="metas-titulo">
        <h2 id="metas-titulo" className="text-h3 text-neutral-900">
          Metas do mês
        </h2>
        {perfil.papel !== "admin" ? (
          <p className="mt-1 text-sm text-neutral-600">
            Só o admin altera metas. As atuais:{" "}
            {listaEquipe
              .map(
                (v) =>
                  `${v.nome} ${formatarReais(v.meta_mensal_centavos)}${
                    metasTipoDisponiveis
                      ? ` · ${v.meta_contas_mes ?? 0} conta(s) · ${v.meta_ativacoes_mes ?? 0} ativação(ões)`
                      : ""
                  }`,
              )
              .join(" — ")}
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {listaEquipe.map((vendedor) => (
              <div key={vendedor.id} className="flex flex-wrap items-center gap-1">
                <span className="w-[220px] truncate text-sm text-neutral-800">
                  {vendedor.nome}
                  <span className="ml-0.5 text-xs text-neutral-400 capitalize">
                    {vendedor.papel}
                  </span>
                </span>
                <form action={salvarMeta} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={vendedor.id} />
                  <label htmlFor={`meta-${vendedor.id}`} className="sr-only">
                    Meta mensal de {vendedor.nome} em reais
                  </label>
                  <input
                    id={`meta-${vendedor.id}`}
                    name="meta"
                    defaultValue={(vendedor.meta_mensal_centavos / 100)
                      .toFixed(2)
                      .replace(".", ",")}
                    inputMode="decimal"
                    className={cn(CAMPO, "w-[128px] text-right font-mono tabular-nums")}
                  />
                  <button
                    type="submit"
                    aria-label={`Salvar meta de ${vendedor.nome}`}
                    className={BOTAO_ICONE}
                  >
                    <Check size={18} strokeWidth={1.5} aria-hidden />
                  </button>
                </form>
                {metaContatosDisponivel ? (
                  <form
                    action={salvarMetaContatos}
                    className="flex items-center gap-1"
                  >
                    <input type="hidden" name="id" value={vendedor.id} />
                    <label
                      htmlFor={`meta-contatos-${vendedor.id}`}
                      className="text-xs text-neutral-600"
                    >
                      contatos/dia
                    </label>
                    <input
                      id={`meta-contatos-${vendedor.id}`}
                      name="contatos"
                      type="number"
                      min={0}
                      max={500}
                      defaultValue={metaContatosPorPessoa.get(vendedor.id) ?? 0}
                      className={cn(CAMPO, "w-[80px] text-right font-mono tabular-nums")}
                    />
                    <button
                      type="submit"
                      aria-label={`Salvar meta de contatos de ${vendedor.nome}`}
                      className={BOTAO_ICONE}
                    >
                      <Check size={18} strokeWidth={1.5} aria-hidden />
                    </button>
                  </form>
                ) : null}
                {metasTipoDisponiveis ? (
                  <>
                    <form action={salvarMetaTipo} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={vendedor.id} />
                      <input type="hidden" name="campo" value="contas" />
                      <label
                        htmlFor={`meta-contas-${vendedor.id}`}
                        className="text-xs text-neutral-600"
                      >
                        contas/mês
                      </label>
                      <input
                        id={`meta-contas-${vendedor.id}`}
                        name="meta"
                        defaultValue={vendedor.meta_contas_mes ?? 0}
                        inputMode="numeric"
                        className={cn(CAMPO, "w-[64px] text-right font-mono tabular-nums")}
                      />
                      <button
                        type="submit"
                        aria-label={`Salvar meta de contas de ${vendedor.nome}`}
                        className={BOTAO_ICONE}
                      >
                        <Check size={18} strokeWidth={1.5} aria-hidden />
                      </button>
                    </form>
                    <form action={salvarMetaTipo} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={vendedor.id} />
                      <input type="hidden" name="campo" value="ativacoes" />
                      <label
                        htmlFor={`meta-ativ-${vendedor.id}`}
                        className="text-xs text-neutral-600"
                      >
                        ativações/mês
                      </label>
                      <input
                        id={`meta-ativ-${vendedor.id}`}
                        name="meta"
                        defaultValue={vendedor.meta_ativacoes_mes ?? 0}
                        inputMode="numeric"
                        className={cn(CAMPO, "w-[64px] text-right font-mono tabular-nums")}
                      />
                      <button
                        type="submit"
                        aria-label={`Salvar meta de ativações de ${vendedor.nome}`}
                        className={BOTAO_ICONE}
                      >
                        <Check size={18} strokeWidth={1.5} aria-hidden />
                      </button>
                    </form>
                  </>
                ) : null}
                {whatsappDisponivel && vendedor.papel !== "vendedor" ? (
                  <form action={salvarWhatsapp} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={vendedor.id} />
                    <label
                      htmlFor={`whats-${vendedor.id}`}
                      className="text-xs text-neutral-600"
                      title="Destino do resumo diário do gestor (7.2). Vazio = não recebe."
                    >
                      WhatsApp
                    </label>
                    <input
                      id={`whats-${vendedor.id}`}
                      name="whatsapp"
                      inputMode="tel"
                      placeholder="62 98181-0004"
                      defaultValue={
                        vendedor.whatsapp_e164
                          ? formatarTelefone(vendedor.whatsapp_e164)
                          : ""
                      }
                      className={cn(CAMPO, "w-[150px] font-mono text-xs tabular-nums")}
                    />
                    <button
                      type="submit"
                      aria-label={`Salvar WhatsApp de ${vendedor.nome}`}
                      className={BOTAO_ICONE}
                    >
                      <Check size={18} strokeWidth={1.5} aria-hidden />
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Parâmetros --------------------------------------------------------- */}
      {/* Cadência de follow-up ------------------------------------------- */}
      <section className="mt-4" aria-labelledby="cadencia-titulo">
        <h2 id="cadencia-titulo" className="text-h3 text-neutral-900">
          Cadência de follow-up
        </h2>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
          Lead que nunca respondeu recebe automaticamente o template escolhido
          N dias depois de criado — no máximo um disparo por regra por lead.
          Templates com uma variável têm a variável preenchida com o nome do
          lead.
        </p>

        {!cadenciaDisponivel ? (
          <p className="mt-2 max-w-[68ch] rounded-md bg-warning-bg px-1.5 py-1 text-sm text-warning">
            Rode as migrações 0013 e 0015 (supabase/migrations/) no SQL Editor
            para habilitar a cadência.
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {listaRegras.map((regra) => (
              <div key={regra.id} className="flex flex-wrap items-center gap-1">
                <span className="w-[320px] text-sm text-neutral-800">
                  <span className="text-neutral-600">
                    {ROTULO_ANCORA[regra.ancora ?? "lead_criado"] ??
                      regra.ancora}
                  </span>{" "}
                  · dia{" "}
                  <span className="font-mono tabular-nums">{regra.dias}</span> ·{" "}
                  {regra.template_nome}
                </span>
                <form action={alternarRegraCadencia}>
                  <input type="hidden" name="id" value={regra.id} />
                  <input
                    type="hidden"
                    name="ativo"
                    value={regra.ativo ? "0" : "1"}
                  />
                  <button
                    type="submit"
                    className={cn(
                      "inline-flex h-[32px] items-center rounded-md px-1.5 text-sm font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                      regra.ativo
                        ? "bg-success-bg text-success"
                        : "bg-neutral-100 text-neutral-600",
                    )}
                  >
                    {regra.ativo ? "Ativa" : "Pausada"}
                  </button>
                </form>
                <form action={excluirRegraCadencia}>
                  <input type="hidden" name="id" value={regra.id} />
                  <button
                    type="submit"
                    aria-label={`Excluir regra do dia ${regra.dias}`}
                    className={cn(BOTAO_ICONE, BOTAO_ICONE_PERIGO)}
                  >
                    <Trash2 size={18} strokeWidth={1.5} aria-hidden />
                  </button>
                </form>
              </div>
            ))}

            {templatesAutomatizaveis.length === 0 ? (
              <p className="text-sm text-neutral-600">
                Nenhum template automatizável (sem variável ou com uma) — crie
                um no painel da Meta.
              </p>
            ) : (
              <form
                action={criarRegraCadencia}
                className="flex flex-wrap items-end gap-1"
              >
                <div className="flex flex-col gap-0.5">
                  <label
                    htmlFor="cadencia-ancora"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Gatilho
                  </label>
                  <select
                    id="cadencia-ancora"
                    name="ancora"
                    required
                    className={cn(CAMPO, "w-[220px]")}
                  >
                    {Object.entries(ROTULO_ANCORA).map(([chave, rotulo]) => (
                      <option key={chave} value={chave}>
                        {rotulo}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-0.5">
                  <label
                    htmlFor="cadencia-dias"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Dias
                  </label>
                  <input
                    id="cadencia-dias"
                    name="dias"
                    type="number"
                    min={1}
                    max={90}
                    required
                    placeholder="3"
                    className={cn(CAMPO, "w-[96px] text-right font-mono tabular-nums")}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label
                    htmlFor="cadencia-template"
                    className="text-sm font-medium text-neutral-800"
                  >
                    Template
                  </label>
                  <select
                    id="cadencia-template"
                    name="template"
                    required
                    className={cn(CAMPO, "w-[240px]")}
                  >
                    {templatesAutomatizaveis.map((t) => (
                      <option
                        key={`${t.nome}|${t.idioma}`}
                        value={`${t.nome}|${t.idioma}`}
                      >
                        {t.nome} ({t.idioma})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="inline-flex h-[40px] items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-2 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  <Plus size={18} strokeWidth={1.5} aria-hidden />
                  Criar regra
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      <section className="mt-4 mb-3" aria-labelledby="parametros-titulo">
        <h2 id="parametros-titulo" className="text-h3 text-neutral-900">
          Parâmetros da reativação
        </h2>
        <div className="mt-2 flex flex-col gap-2">
          {PARAMETROS.map((parametro) => (
            <form
              key={parametro.chave}
              action={salvarParametro}
              className="flex items-center gap-1"
            >
              <input type="hidden" name="chave" value={parametro.chave} />
              <span className="w-[220px] text-sm text-neutral-800">
                {parametro.rotulo}
                <span className="block text-xs text-neutral-600">
                  {parametro.ajuda}
                </span>
              </span>
              <label htmlFor={`param-${parametro.chave}`} className="sr-only">
                {parametro.rotulo}
              </label>
              <input
                id={`param-${parametro.chave}`}
                name="valor"
                defaultValue={valorParametro.get(parametro.chave) ?? ""}
                required
                inputMode="numeric"
                className={cn(CAMPO, "w-[96px] text-right font-mono tabular-nums")}
              />
              <button
                type="submit"
                aria-label={`Salvar ${parametro.rotulo}`}
                className={BOTAO_ICONE}
              >
                <Check size={18} strokeWidth={1.5} aria-hidden />
              </button>
            </form>
          ))}
        </div>

        {/* Resumo diário (7.2): o template precisa existir na WABA. O botão
            cria pela API com o token do app; a lista só mostra APROVADOS,
            então "não aparece" também pode ser "aguardando aprovação". */}
        <div className="mt-2 max-w-[68ch] rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-1">
          {templatesWhatsapp.some((t) => t.nome === "resumo_diario") ? (
            <p className="text-sm text-neutral-800">
              Template <span className="font-mono">resumo_diario</span>{" "}
              aprovado na Meta — o resumo diário sai sozinho com o parâmetro
              acima ligado e os WhatsApps preenchidos em Metas do mês.
            </p>
          ) : (
            <form action={criarTemplateResumo} className="flex flex-wrap items-center gap-1">
              <p className="min-w-[240px] flex-1 text-sm text-neutral-600">
                O template <span className="font-mono">resumo_diario</span>{" "}
                ainda não está aprovado na WABA.
              </p>
              <button
                type="submit"
                className="inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                Criar template na Meta
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
