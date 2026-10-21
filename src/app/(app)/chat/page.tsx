import type { Metadata } from "next";
import { cookies } from "next/headers";
import { perfilAtual } from "@/lib/auth";
import { fotosDaEquipe } from "@/lib/fotos-equipe";
import { donosOcultosParaMim } from "@/lib/privacidade";
import { AppConversas, type LeadInicial } from "@/app/(app)/conversas/app";
import {
  carregarCampanhasDaFila,
  carregarListaConversas,
} from "@/app/(app)/conversas/lista";
import { lerVoltar } from "@/app/(app)/contatos/voltar";
import { carregarCatalogos, carregarConversa } from "./conversa";
import {
  COOKIE_FILA,
  filaNaUrl,
  hrefConversa,
  lerCookieFila,
  lerFiltrosFila,
  type CatalogosChat,
} from "./mensagem";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Chat") };

const SEM_CATALOGOS: CatalogosChat = {
  mensagensPadrao: null,
  templates: null,
  equipe: null,
  etiquetas: null,
  horaRecontato: "09:00",
};

/**
 * O /chat. Este server component só monta o PRIMEIRO quadro: a fila com os
 * filtros da URL, o que não muda de uma conversa para outra (prontas,
 * templates, equipe, etiquetas, as campanhas do filtro) e, num deep link
 * ?lead=, a conversa, tudo em paralelo. Todo gesto seguinte é uma action
 * pontual a partir do cliente; a página nunca se refaz inteira.
 *
 * A URL é a fonte dos filtros (visao, escopo, busca, atendentes, etiquetas,
 * campanha, canal, de, ate e naoLidas; os antigos atendente e etiqueta
 * continuam lidos): o chat a reescreve a cada filtro aplicado, e quem volta
 * da ficha do contato reabre a fila como a deixou. O ?voltar= é de quem
 * abriu o chat por fora (a ficha, a lista de contatos): o "←" da conversa
 * leva de volta.
 *
 * O perfil vem do cache do request (o layout já o leu e já barrou quem
 * está sem sessão): aqui ele diz quem é "eu" para o escopo "Minhas" e qual
 * é o papel (quem pode assumir, quem vê a carga da equipe).
 *
 * Os donos ocultos (Administração > Privacidade) vão como prop: a fila do
 * servidor já vem sem eles, e o cliente usa a lista para descartar o evento
 * do tempo real e tirá-los das opções do filtro de atendente. Erro ao ler a
 * regra derruba a página, em vez de mostrar o que ela esconde.
 *
 * O /chat sem nada na URL (o menu, a aba Chat, Alt+1) abre com a fila que a
 * pessoa deixou neste aparelho (cookie "fila-chat", gravado pelo chat a cada
 * troca de visão, escopo ou filtro). Com ?lead= ou filtros na URL, vale a URL.
 */
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const params = await searchParams;
  const leadPedido =
    typeof params.lead === "string" && params.lead ? params.lead : null;
  // Volta para o próprio chat giraria em falso.
  const voltarLido = lerVoltar(params.voltar);
  const voltar =
    voltarLido && !/^\/chat(?:[/?#]|$)/.test(voltarLido) ? voltarLido : null;

  const [perfil, jarro] = await Promise.all([perfilAtual(), cookies()]);
  // Sem os catálogos ele confere só o formato do uuid e mantém tudo em
  // paralelo: um id que não existe só devolve a fila vazia (o chat tira da
  // fila guardada o que não existe mais, na montagem).
  const guardada =
    !leadPedido && !filaNaUrl(params) && perfil
      ? lerCookieFila(jarro.get(COOKIE_FILA)?.value, perfil.id)
      : null;
  const filtros = guardada ?? lerFiltrosFila(params);
  const [carga, catalogos, campanhas, conversaInicial, donosOcultos, fotos] =
    await Promise.all([
      carregarListaConversas(filtros.visao, {
        ...filtros,
        perfil: perfil ?? undefined,
      }),
      carregarCatalogos(),
      carregarCampanhasDaFila(),
      // Abrir pelo link é abrir a conversa: entra no log de acesso como o
      // clique na fila.
      leadPedido
        ? carregarConversa(leadPedido, { registrarAcesso: true })
        : Promise.resolve(null),
      donosOcultosParaMim(),
      // As fotos da equipe, uma vez para a tela inteira (bolhas, fila,
      // cabeçalho e as listas da equipe). Falha vira mapa vazio: iniciais.
      fotosDaEquipe(),
    ]);

  let leadInicial: LeadInicial | null = null;
  let leadSemAbrir: string | null = null;
  if (leadPedido && conversaInicial) {
    if ("erro" in conversaInicial) {
      // O link pedia uma conversa que não abriu: a fila avisa e oferece
      // tentar de novo, em vez de abrir calada na Caixa.
      leadSemAbrir = leadPedido;
    } else {
      leadInicial = {
        leadId: leadPedido,
        nome: conversaInicial.nome,
        dados: conversaInicial,
      };
    }
  }

  return (
    <AppConversas
      // Outra conversa ou outra fila na URL é outro primeiro quadro: o
      // estado do cliente nasce de novo em vez de seguir com o anterior.
      key={`${leadPedido ?? "caixa"}|${hrefConversa(null, filtros)}`}
      inicial={carga}
      catalogos={"erro" in catalogos ? SEM_CATALOGOS : catalogos}
      campanhas={campanhas}
      donosOcultos={donosOcultos}
      fotos={fotos}
      meuId={perfil?.id ?? null}
      papel={perfil?.papel ?? null}
      hojeChave={new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }).format(new Date())}
      leadInicial={leadInicial}
      filtrosIniciais={filtros}
      filaGuardada={guardada !== null}
      voltar={leadInicial ? voltar : null}
      leadSemAbrir={leadSemAbrir}
    />
  );
}
