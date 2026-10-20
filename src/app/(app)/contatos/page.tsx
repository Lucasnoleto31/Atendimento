import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { ehAtendente, ehGestao, somenteLeitura, veTudo } from "@/lib/papeis";
import { veioPeloDirect } from "@/lib/avatar";
import { formatarData } from "@/lib/format";
import { Button, classesDoBotao } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  consultaDosFiltros,
  lerFiltros,
  MAX_CAMPANHAS,
  SEM_DONO,
  temFiltro,
  urlContatos,
  urlExportar,
} from "./filtros";
import { consultarContatos, naOrdemDaLista } from "./consulta";
import { FiltrosLista } from "./filtros-lista";
import type {
  CampanhaDoFiltro,
  MembroDoFiltro,
} from "./barra-filtros-contatos";
import { lerAvisoLista, textoAvisoLista } from "./aviso-lista";
import { comVoltar, urlConversa } from "./voltar";
import { contatoDe, desdeQuando } from "./formato";
import { Vazio, type Contato, type EtiquetaCatalogo } from "./lista-contatos";
import { ListaSelecionavel } from "./lista-selecionavel";
import { Paginador } from "./navegacao-lista";
import { ExportarLista } from "./exportar-lista";
import { ProvedorSelecao } from "./selecao-na-tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Contatos") };

const POR_PAGINA = 60;

const CAMPOS =
  "id, nome, telefone_e164, instagram_id, instagram_usuario, " +
  "ultima_interacao_em, responsavel:profiles(nome), etiquetas:lead_tags(tag_id)";

type Linha = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  /** IGSID: só para saber se tem foto guardada (veioPeloDirect). */
  instagram_id: string | null;
  instagram_usuario: string | null;
  ultima_interacao_em: string | null;
  responsavel: { nome: string } | null;
  etiquetas: { tag_id: string }[] | null;
};

const numero = new Intl.NumberFormat("pt-BR");

/**
 * O cadastro que a busca sem resultado oferece, com o termo já no campo:
 * com 8 dígitos ou mais vai como telefone; sem dígito nenhum, como nome.
 * Com @ não há botão (Instagram não se cadastra à mão), nem com letras e
 * poucos números juntos, que não são nem um nem outro.
 */
function cadastroDaBusca(busca: string, voltar: string | null): string | null {
  if (!busca || busca.includes("@")) return null;
  const digitos = busca.replace(/\D/g, "").length;
  const campo = digitos >= 8 ? "telefone" : digitos === 0 ? "nome" : null;
  if (!campo) return null;
  return comVoltar(
    `/contatos/novo?${campo}=${encodeURIComponent(busca)}`,
    voltar,
  );
}

/**
 * A base de contatos: uma consulta na tabela leads (consultarContatos, o
 * mesmo ponto do CSV e das ações em massa), paginada sem count (a linha a
 * mais diz se há próxima página), e os catálogos de etiqueta, equipe e
 * campanhas em paralelo. Os filtros (busca, período, etiquetas,
 * responsáveis, campanha e canal) moram na URL e saem de filtros.ts. A ordem é a da caixa de entrada: interação mais recente
 * primeiro. A seleção em massa (lista-selecionavel) vale para a página na
 * tela.
 *
 * Duas formas, pela largura do conteúdo (container query, que vale com o
 * menu lateral aberto ou recolhido): no celular, linhas com avatar, nome,
 * telefone ou @, dono e última interação; a partir de 768px de conteúdo, a
 * tabela densa. Nas duas, a linha abre a ficha e o botão de conversa leva
 * ao chat com o caminho de volta para esta lista, filtros incluídos.
 *
 * A troca mede o invólucro de fora (@container/pagina), que não tem recuo:
 * o container query mede a caixa sem o padding, e no div de dentro os 48px
 * de recuo faziam a tabela só aparecer com 1.056px de janela. Com o menu
 * lateral de 240px, a janela de 1.024 dá 784px de conteúdo (tabela, com
 * 736px de largura) e a de 1.280 dá 1.040 (tabela com a coluna de
 * etiquetas). As duas ficam 16px acima dos limiares (768 e 1.024): a barra
 * de rolagem que ocupa espaço, a do Windows, pode comer até isso sem trocar
 * a forma. O resto da página segue medindo o div de dentro, como antes.
 */
export default async function ContatosPage({
  searchParams,
}: PageProps<"/contatos">) {
  const params = await searchParams;
  const filtros = lerFiltros(params);
  const pagina = Math.max(1, Math.floor(Number(params.pagina)) || 1);
  const de = (pagina - 1) * POR_PAGINA;
  // O aviso da edição ou do cadastro que tirou o contato da vista de quem
  // salvou (aviso-lista.ts): só o código e o id vêm da URL.
  const avisoUrl = lerAvisoLista(params.aviso, params.para);

  const supabase = await createClient();
  // Os donos cujos contatos esta pessoa não vê (Administração >
  // Privacidade). Só a lista espera por ele; erro de leitura derruba a
  // página, em vez de mostrar o que a regra esconde.
  const ocultosP = donosOcultosParaMim();

  const [perfil, ocultos, contatosR, tagsR, equipeR, campanhasR] =
    await Promise.all([
      perfilAtual(),
      ocultosP,
      ocultosP.then((o) =>
        // A ordem da caixa de entrada (naOrdemDaLista), a mesma do "Marcar
        // os N deste filtro" e do CSV dele.
        naOrdemDaLista(
          consultarContatos(supabase, CAMPOS, { filtros, ocultos: o }),
        ).range(de, de + POR_PAGINA),
      ),
      supabase.from("tags").select("id, nome, cor, ativo").order("nome"),
      supabase
        .from("profiles")
        .select("id, nome, papel")
        .eq("ativo", true)
        .order("nome"),
      // As campanhas do filtro "Recebeu a campanha", as mais recentes, como
      // na fila do chat. Toda a equipe lê (policy leitura_equipe, 0021).
      supabase
        .from("campanhas")
        .select("id, nome, status")
        .order("criado_em", { ascending: false })
        .limit(MAX_CAMPANHAS),
    ]);

  const linhas = (contatosR.data ?? []) as Linha[];
  const temProxima = linhas.length > POR_PAGINA;
  const visiveis = linhas.slice(0, POR_PAGINA);

  const catalogo = (tagsR.data ?? []) as EtiquetaCatalogo[];
  const etiquetaPorId = new Map(catalogo.map((t) => [t.id, t]));
  const equipeComPapel = (equipeR.data ?? []) as {
    id: string;
    nome: string;
    papel: string;
  }[];
  const equipe = equipeComPapel.map(({ id, nome }) => ({ id, nome }));
  // Para quem transferir: os destinos do chat, sem quem só lê. O compliance
  // não atende: o contato passado para ele ficaria sem ninguém que responda.
  // O servidor continua decidindo quem pode receber.
  const destinos = equipeComPapel
    .filter((p) => !somenteLeitura(p.papel))
    .map(({ id, nome }) => ({ id, nome }));
  // Sem as campanhas (falhou a leitura), o menu da Campanha diz que não
  // carregou em vez de oferecer uma lista vazia.
  type LinhaCampanha = { id: string; nome: string; status: string };
  const paraFiltro = (c: LinhaCampanha): CampanhaDoFiltro => ({
    id: c.id,
    nome: c.nome,
    status:
      c.status === "ativa" || c.status === "pausada" ? c.status : "concluida",
  });
  const campanhas: CampanhaDoFiltro[] | null = campanhasR.error
    ? null
    : ((campanhasR.data ?? []) as LinhaCampanha[]).map(paraFiltro);
  // Link guardado com uma campanha que já saiu das mais recentes: ela entra
  // no catálogo, para o botão e o menu da Campanha dizerem qual é o recorte.
  if (
    campanhas &&
    filtros.campanha &&
    !campanhas.some((c) => c.id === filtros.campanha)
  ) {
    const { data: antiga } = await supabase
      .from("campanhas")
      .select("id, nome, status")
      .eq("id", filtros.campanha)
      .maybeSingle();
    if (antiga) campanhas.push(paraFiltro(antiga as LinhaCampanha));
  }
  // O nome de cada responsável do filtro, para o botão e o menu dizerem qual
  // é o recorte: a equipe ativa inteira (com os donos ocultos, que não viram
  // opção) e, se vieram num link guardado, os desativados.
  const foraDaEquipe = filtros.responsaveis.filter(
    (id) => id !== SEM_DONO && !equipe.some((p) => p.id === id),
  );
  let desativados: { id: string; nome: string }[] = [];
  if (!equipeR.error && foraDaEquipe.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, nome")
      .eq("ativo", false)
      .in("id", foraDaEquipe);
    desativados = (data ?? []) as { id: string; nome: string }[];
  }
  const nomesEquipe: MembroDoFiltro[] | null = equipeR.error
    ? null
    : [
        ...equipe.map((p) => ({ ...p, ativo: true })),
        ...desativados.map((p) => ({ ...p, ativo: false })),
      ];

  // Exportar segue a regra de sempre: só quem enxerga a base inteira
  // (gestão e compliance), e a rota confere de novo.
  const podeExportar = veTudo(perfil?.papel);
  const podeCriar = perfil !== null && !somenteLeitura(perfil.papel);
  // Atendente só enxerga os próprios contatos: filtrar ou mostrar o
  // responsável não diria nada a ele.
  const comDono = perfil !== null && !ehAtendente(perfil.papel);
  // A seleção em massa, com as permissões de hoje (as actions e a rota
  // conferem de novo): etiquetar é de quem edita; transferir segue o
  // cadastro, em que o RLS só deixa trocar o dono quem não é atendente (o
  // atendente perderia o contato de vista); exportar é de quem exporta.
  const selecao = {
    etiquetar: podeCriar && catalogo.length > 0,
    transferir: podeCriar && comDono,
    exportar: podeExportar,
  };

  const filtrando = temFiltro(filtros);
  // O tamanho da lista, na linha do "Selecionar" ("60+ contatos") e no pé
  // da folha de filtros no celular ("Ver 60+ contatos"): as páginas de antes
  // vieram cheias, então o total até aqui é o começo desta mais as linhas
  // dela. Sem saber (o erro, a página além do fim), fica sem número.
  const resultado =
    contatosR.error || (visiveis.length === 0 && pagina > 1)
      ? null
      : { total: de + visiveis.length, mais: temProxima };
  // A lista como está (filtros e página) vai no ?voltar= da ficha, do
  // cadastro e da conversa: o "←" de lá devolve a mesma lista, não a cheia.
  const aqui = urlContatos(filtros, pagina);
  const voltarLista = aqui === "/contatos" ? null : aqui;

  const contatos: Contato[] = visiveis.map((l) => ({
    id: l.id,
    nome: l.nome,
    // Quem veio pelo Direct tem foto guardada, com @ ou sem: o mesmo
    // critério da fila e da ficha.
    foto: veioPeloDirect({
      instagramId: l.instagram_id,
      instagramUsuario: l.instagram_usuario,
    }),
    contato: contatoDe(l.telefone_e164, l.instagram_usuario),
    dono: l.responsavel?.nome ?? null,
    quando: l.ultima_interacao_em,
    quandoTexto: l.ultima_interacao_em
      ? desdeQuando(l.ultima_interacao_em)
      : null,
    quandoTitulo: l.ultima_interacao_em
      ? formatarData(l.ultima_interacao_em)
      : null,
    etiquetas: (l.etiquetas ?? [])
      .map((e) => etiquetaPorId.get(e.tag_id))
      .filter((t): t is EtiquetaCatalogo => t !== undefined),
    ficha: comVoltar(`/contatos/${l.id}`, voltarLista),
    conversa: urlConversa(l.id, aqui),
  }));

  // Sem linhas: o erro da leitura ou a lista vazia. Vai para dentro da
  // ListaSelecionavel, que fica montada nos dois casos: a ação em massa que
  // esvazia a lista (transferir todos os sem dono, tirar a etiqueta do
  // filtro) não leva junto o aviso do resultado, que mora nela.
  const semLinhas = contatosR.error ? (
    <div role="alert" className="rounded-painel bg-cartao p-2.5">
      <p className="tipo-destaque text-erro">
        Não deu para carregar os contatos.
      </p>
      <p className="mt-0.5 tipo-nota break-words text-texto-2">
        {contatosR.error.message}
      </p>
      <Button href={aqui} variant="secondary" size="sm" className="mt-1.5">
        Tentar de novo
      </Button>
    </div>
  ) : (
    <Vazio
      pagina={pagina}
      busca={filtros.busca}
      filtrando={filtrando}
      primeira={urlContatos(filtros)}
      cadastrar={podeCriar ? cadastroDaBusca(filtros.busca, voltarLista) : null}
    />
  );

  const textoAviso = avisoUrl
    ? textoAvisoLista(
        avisoUrl.aviso,
        equipe.find((p) => p.id === avisoUrl.para)?.nome ?? null,
      )
    : null;

  // A coluna ocupa ao menos a altura útil. Na seleção, o topo (título,
  // busca, funil e pílulas) sai de cena e a barra da seleção, presa no alto,
  // toma o lugar dele, como na fila do chat. O provedor conta às peças do
  // topo que a seleção ligou, para os comandos delas saírem da paleta.
  return (
    <ProvedorSelecao>
      <div className="flex min-h-util flex-col @container/pagina">
        <div className="group/contatos flex flex-1 flex-col @container px-2 pt-2 pb-4 md:px-3 md:pt-3 [&:has([data-pendente])_[data-lista]]:opacity-60">
          <div className="group-has-[[data-selecionando]]/contatos:hidden">
            <header className="flex items-center justify-between gap-2">
              <h1 className="tipo-titulo-grande text-tinta">Contatos</h1>
              <div className="flex items-center gap-1.5">
                {podeExportar ? (
                  // Abre a confirmação com o número antes de baixar. Na
                  // seleção ele sai: o "Exportar" da barra leva só os
                  // marcados, e este, a lista filtrada inteira.
                  <ExportarLista url={urlExportar(filtros)} filtrando={filtrando} />
                ) : null}
                {podeCriar ? (
                  <Link
                    href={comVoltar("/contatos/novo", voltarLista)}
                    className={cn(
                      classesDoBotao({ variant: "primary", size: "md" }),
                      "w-[40px] px-0 pointer-coarse:h-[44px] pointer-coarse:w-[44px] @xl:w-auto @xl:px-2 pointer-coarse:@xl:w-auto",
                    )}
                  >
                    <Plus size={18} strokeWidth={1.75} aria-hidden />
                    <span className="sr-only @xl:not-sr-only">Novo contato</span>
                  </Link>
                ) : null}
              </div>
            </header>

            {textoAviso ? (
              <p
                role="status"
                className="mt-2 flex max-w-[68ch] items-start gap-1 rounded-painel bg-cartao p-2 tipo-corpo text-tinta"
              >
                <CircleAlert
                  size={20}
                  strokeWidth={1.75}
                  aria-hidden
                  className="mt-px shrink-0 text-atencao"
                />
                {textoAviso}
              </p>
            ) : null}

            <div className="mt-2">
              <FiltrosLista
                filtros={filtros}
                // O catálogo inteiro: o menu oferece as ativas e a arquivada
                // que veio no filtro da URL (senão não haveria como tirá-la),
                // e a pílula dá nome ao que está marcado. Sem a leitura, o menu
                // diz que não carregou, em vez de "Nenhuma etiqueta cadastrada".
                etiquetas={tagsR.error ? null : catalogo}
                // Dono oculto não vira filtro (a lista dele sairia vazia); como
                // destino de "Transferir", na seleção, ele continua.
                equipe={
                  equipeR.error
                    ? null
                    : equipe.filter((p) => !donoOculto(p.id, ocultos))
                }
                nomesEquipe={nomesEquipe}
                campanhas={campanhas}
                filtraResponsavel={comDono}
                resultado={resultado}
                novo={podeCriar ? comVoltar("/contatos/novo", voltarLista) : null}
                chave={aqui}
              />
            </div>
          </div>

          {/* O resultado anunciado para quem usa leitor de tela: a lista troca
              sozinha enquanto se digita. */}
          <p role="status" className="sr-only">
            {contatosR.error
              ? ""
              : visiveis.length === 0
                ? "Nenhum contato."
                : visiveis.length === 1
                  ? "1 contato nesta página."
                  : `${numero.format(visiveis.length)} contatos nesta página.`}
          </p>

          <section
            aria-label="Lista de contatos"
            data-lista=""
            className="mt-2 flex flex-1 flex-col transition-opacity duration-[180ms] @3xl/pagina:mt-3 group-has-[[data-selecionando]]/contatos:mt-0!"
          >
            <ListaSelecionavel
              contatos={contatos}
              comDono={comDono}
              chave={aqui}
              consulta={consultaDosFiltros(filtros)}
              filtrando={filtrando}
              resultado={resultado}
              etiquetas={catalogo}
              destinos={destinos}
              pode={selecao}
              gestao={ehGestao(perfil?.papel)}
              vazio={semLinhas}
            >
              {contatos.length > 0 && (pagina > 1 || temProxima) ? (
                <nav
                  aria-label="Páginas"
                  className="mt-2 flex items-center justify-between gap-2"
                >
                  <p className="tipo-nota whitespace-nowrap text-texto-2 tabular-nums">
                    <span className="sr-only @xl:not-sr-only">Contatos </span>
                    {numero.format(de + 1)} a {numero.format(de + contatos.length)}
                  </p>
                  <Paginador
                    anterior={pagina > 1 ? urlContatos(filtros, pagina - 1) : null}
                    proxima={temProxima ? urlContatos(filtros, pagina + 1) : null}
                  />
                </nav>
              ) : null}
            </ListaSelecionavel>
          </section>
        </div>
      </div>
    </ProvedorSelecao>
  );
}
