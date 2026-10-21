import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { registrarAcesso } from "@/lib/auditoria";
import { ehAtendente, ehGestao, somenteLeitura, veTudo } from "@/lib/papeis";
import { veioPeloDirect } from "@/lib/avatar";
import { lerAviso } from "./aviso-ficha";
import type { EtiquetaDoCatalogo } from "./etiquetas-contato";
import { FichaContato, type NotaFicha } from "./ficha";
import { lerVoltar, voltarDiferenteDe } from "../voltar";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Contato") };

/**
 * A ficha do contato: dados, etiquetas, observação e as notas internas, numa
 * página só. A conversa não carrega aqui: "Abrir conversa" leva ao chat, com
 * o caminho de volta para esta ficha.
 *
 * Tudo sai numa onda de consultas em paralelo (contato, etiquetas, notas,
 * catálogo, perfil e a privacidade), sem esperar uma pela outra. Contato de
 * um dono oculto para quem abre (Administração > Privacidade) é "não
 * encontrado", como o que o RLS não devolve: a ficha não diz que ele existe.
 */

const ROTULO_ENTRADA: Record<string, string> = {
  manual: "Cadastro manual",
  importacao: "Importação de planilha",
  webhook_meta: "WhatsApp",
  webhook_instagram: "Instagram Direct",
  formulario: "Formulário",
  meta_lead_ads: "Anúncio da Meta",
  queda_lotes: "Reativação da base",
  sem_giro: "Reativação da base",
};

// Só nota escrita por gente: os logs de ação (adiar/resolver/atribuir) são
// tipo "nota" com metadados.sistema, e os antigos, sem o campo, seguem o
// texto padrão (mesmo critério da Janela do chat).
const PADROES_NOTA_SISTEMA = [
  /^Conversa (adiada|resolvida|reaberta)/,
  /^Atendimento atribuído/,
  /^Abriu conta na corretora/,
];

type Contato = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  email: string | null;
  /** IGSID: só para saber se tem foto guardada (veioPeloDirect). */
  instagram_id: string | null;
  instagram_usuario: string | null;
  observacao: string | null;
  entrada_motivo: string;
  criado_em: string;
  ultima_interacao_em: string | null;
  responsavel_id: string | null;
  canal: { nome: string } | null;
  responsavel: { nome: string } | null;
  etiquetas: { tag_id: string }[] | null;
};

type Nota = {
  id: string;
  conteudo: string | null;
  criado_em: string;
  metadados: { sistema?: boolean; apagada?: unknown } | null;
  autor: { nome: string } | null;
};

/**
 * A nota como a ficha recebe: só o que ela mostra. A apagada no chat
 * ("Apagar para a equipe", marca em metadados.apagada) segue na lista com a
 * marca, como a bolha, e o texto não sai do servidor. A marca se lê como
 * lerApagada lê (chat/mensagem.ts): basta ser um objeto.
 */
function paraNotaFicha(n: Nota): NotaFicha {
  const base = { id: n.id, criado_em: n.criado_em, autor: n.autor };
  const marca = n.metadados?.apagada;
  if (typeof marca !== "object" || marca === null || Array.isArray(marca)) {
    return { ...base, conteudo: n.conteudo };
  }
  const { por, nome } = marca as { por?: unknown; nome?: unknown };
  return {
    ...base,
    conteudo: null,
    apagada: {
      por: por === "equipe" ? "equipe" : "contato",
      nome: typeof nome === "string" && nome.trim() ? nome : null,
    },
  };
}

export default async function ContatoPage({
  params,
  searchParams,
}: PageProps<"/contatos/[id]">) {
  const { id } = await params;
  const busca = await searchParams;
  // Só código conhecido: o texto do aviso a ficha escreve.
  const aviso = lerAviso(busca.aviso);
  // De onde a pessoa veio: a conversa (chat) ou a lista com os filtros. Sem
  // ?voltar=, o pai lógico é a lista de contatos.
  const voltar = voltarDiferenteDe(lerVoltar(busca.voltar), `/contatos/${id}`);
  const supabase = await createClient();

  const [perfil, ocultos, contatoR, notasR, catalogoR, equipeR] =
    await Promise.all([
      perfilAtual(),
      donosOcultosParaMim(),
      supabase
        .from("leads")
        .select(
          `id, nome, telefone_e164, email, instagram_id, instagram_usuario, observacao,
           entrada_motivo, criado_em, ultima_interacao_em, responsavel_id,
           canal:channels(nome),
           responsavel:profiles(nome),
           etiquetas:lead_tags(tag_id)`,
        )
        .eq("id", id)
        .maybeSingle(),
      // Os logs de ação e as respostas automáticas saem no banco, antes do
      // limite: quem escreve muito fora do horário enchia as 40 vagas com
      // respostas automáticas, e as notas da equipe sumiam da ficha.
      supabase
        .from("lead_interactions")
        .select("id, conteudo, criado_em, metadados, autor:profiles(nome)")
        .eq("lead_id", id)
        .eq("tipo", "nota")
        .or("metadados->>sistema.is.null,metadados->>sistema.neq.true")
        .is("metadados->>automatica", null)
        .order("criado_em", { ascending: false })
        .limit(40),
      supabase.from("tags").select("id, nome, cor, ativo").order("nome"),
      // Para quem passar o contato no "Trocar": a equipe ativa, com o papel
      // para tirar quem só lê. Toda a equipe lê os perfis (policy
      // leitura_equipe); para quem não troca, a lista só não é usada.
      supabase
        .from("profiles")
        .select("id, nome, papel")
        .eq("ativo", true)
        .order("nome"),
    ]);

  const contato = contatoR.data as unknown as Contato | null;
  // Oculto cai no "não encontrado" antes do log: ninguém viu a ficha.
  if (!contato || donoOculto(contato.responsavel_id, ocultos)) notFound();
  // Trilha de leitura: quem abriu a ficha de quem (o compliance lê isso).
  registrarAcesso(perfil?.id ?? null, "viu_ficha", {
    lead_id: contato.id,
    nome: contato.nome,
  });

  const podeEditar = perfil !== null && !somenteLeitura(perfil.papel);
  // Trocar o responsável na ficha: quem transfere na lista (quem edita e
  // não é atendente, a mesma regra da seleção em massa). O servidor
  // (transferirContatos) confere de novo, contato por contato.
  const podeTransferir =
    perfil !== null && podeEditar && !ehAtendente(perfil.papel);
  const lidas = (notasR.data ?? []) as unknown as Nota[];
  const daEquipe = lidas.filter(
    (n) =>
      n.metadados?.sistema !== true &&
      !PADROES_NOTA_SISTEMA.some((p) => p.test(n.conteudo ?? "")),
  );
  const notas = daEquipe.slice(0, 20).map(paraNotaFicha);
  // Há mais do que as 20 na tela (ou a leitura bateu no limite de 40):
  // a ficha leva às outras na conversa.
  const cortadas = daEquipe.length > notas.length || lidas.length >= 40;
  const entrada =
    ROTULO_ENTRADA[contato.entrada_motivo] ?? contato.entrada_motivo;

  return (
    <FichaContato
      contato={{
        id: contato.id,
        nome: contato.nome,
        // Quem veio pelo Direct tem foto guardada, mesmo sem o @ (a leitura
        // do perfil pode ter falhado na entrada).
        foto: veioPeloDirect({
          instagramId: contato.instagram_id,
          instagramUsuario: contato.instagram_usuario,
          entradaMotivo: contato.entrada_motivo,
        }),
        telefoneE164: contato.telefone_e164,
        email: contato.email,
        instagram: contato.instagram_usuario,
        observacao: contato.observacao,
        criadoEm: contato.criado_em,
        ultimaInteracaoEm: contato.ultima_interacao_em,
        dono: contato.responsavel?.nome ?? null,
        origem: contato.canal?.nome ?? entrada,
        origemDetalhe: contato.canal ? entrada : null,
        etiquetas: (contato.etiquetas ?? []).map((e) => e.tag_id),
        donoId: contato.responsavel_id,
      }}
      notas={notas}
      notasCortadas={cortadas}
      transferir={
        podeTransferir && perfil
          ? {
              // Os destinos do chat: sem quem só lê (o compliance não
              // atende; o contato ficaria sem ninguém que responda).
              destinos: (
                (equipeR.data ?? []) as {
                  id: string;
                  nome: string;
                  papel: string;
                }[]
              )
                .filter((p) => !somenteLeitura(p.papel))
                .map(({ id: pessoa, nome }) => ({ id: pessoa, nome })),
              gestao: ehGestao(perfil.papel),
              // Quem não vê a base inteira (o assessor) e passa o contato a
              // outra pessoa deixa de vê-lo: o cliente da carteira vai junto
              // para o novo dono.
              saiAoPassar: !veTudo(perfil.papel),
              meuId: perfil.id,
            }
          : null
      }
      catalogo={(catalogoR.data ?? []) as EtiquetaDoCatalogo[]}
      podeEditar={podeEditar}
      voltar={voltar}
      aviso={aviso}
    />
  );
}
