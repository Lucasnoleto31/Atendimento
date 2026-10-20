import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { ehAtendente, ehGestao, somenteLeitura } from "@/lib/papeis";
import { formatarTelefone } from "@/lib/format";
import { FormContato } from "../../form-contato";
import { LinkVoltar } from "../../link-voltar";
import { lerVoltar, rotuloVoltar, voltarDiferenteDe } from "../../voltar";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = {
  title: titulo("Editar contato"),
};

type ContatoEditavel = {
  id: string;
  nome: string;
  telefone_e164: string | null;
  email: string | null;
  responsavel_id: string | null;
  observacao: string | null;
  responsavel: { nome: string } | null;
};

export default async function EditarContatoPage({
  params,
  searchParams,
}: PageProps<"/contatos/[id]/editar">) {
  const { id } = await params;
  const busca = await searchParams;
  // Do chat, a edição volta para a conversa; da ficha, para a ficha (que
  // pode trazer o próprio ?voltar=). Sem ?voltar=, o pai é a ficha.
  const voltar = voltarDiferenteDe(
    lerVoltar(busca.voltar),
    `/contatos/${id}/editar`,
  );
  const destino = voltar ?? `/contatos/${id}`;

  const supabase = await createClient();
  const [perfil, ocultos, { data }, { data: equipe }] = await Promise.all([
    perfilAtual(),
    donosOcultosParaMim(),
    supabase
      .from("leads")
      .select(
        "id, nome, telefone_e164, email, responsavel_id, observacao, responsavel:profiles(nome)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, nome, papel")
      .eq("ativo", true)
      .order("nome"),
  ]);

  const contato = data as unknown as ContatoEditavel | null;
  // Contato de dono oculto para quem abre (Administração > Privacidade) é
  // "não encontrado", como na ficha. A lista de responsáveis abaixo segue
  // inteira: passar para alguém oculto é permitido.
  if (!contato || donoOculto(contato.responsavel_id, ocultos)) notFound();
  // Compliance só lê: volta para de onde veio.
  if (perfil && somenteLeitura(perfil.papel)) redirect(destino);
  // O select do responsável fica só para a gestão, com os destinos do chat:
  // sem quem só lê (o compliance não atende); a carga de conversas abertas
  // de cada um o formulário lê depois de abrir, sem a página esperar. Para
  // o atendente e o assessor, o responsável vira
  // texto: o banco recusava a troca deles por aqui depois do formulário
  // inteiro preenchido. O assessor troca pelo "Trocar" da ficha, que segue
  // as mesmas regras da transferência e deixa a linha no histórico.
  const escolheResponsavel = ehGestao(perfil?.papel);
  const opcoes: { id: string; nome: string }[] = (
    (equipe ?? []) as { id: string; nome: string; papel: string }[]
  )
    .filter((p) => !somenteLeitura(p.papel))
    .map(({ id, nome }) => ({ id, nome }));
  // O responsável de agora fora da lista (desativado, ou alguém que só lê):
  // sem a opção dele, o select abriria em "Sem dono" e salvar tiraria o
  // dono do contato.
  if (
    contato.responsavel_id &&
    !opcoes.some((p) => p.id === contato.responsavel_id)
  ) {
    const ativo = (equipe ?? []).some(
      (p: { id: string }) => p.id === contato.responsavel_id,
    );
    opcoes.push({
      id: contato.responsavel_id,
      nome: ativo
        ? (contato.responsavel?.nome ?? "Usuário")
        : `${contato.responsavel?.nome ?? "Usuário"} (inativo)`,
    });
  }

  return (
    <div className="@container px-2 pt-2 pb-4 md:px-3 md:pt-3">
      <LinkVoltar
        href={destino}
        rotulo={voltar ? rotuloVoltar(voltar) : "Ficha do contato"}
      />

      <header className="mt-2">
        <h1 className="tipo-titulo-1 text-tinta">Editar contato</h1>
        <p className="mt-0.5 tipo-subtitulo [overflow-wrap:anywhere] text-texto-2">
          {contato.nome}
        </p>
      </header>

      <div className="mt-3">
        <FormContato
          modo="editar"
          valores={{
            nome: contato.nome,
            telefone: contato.telefone_e164
              ? formatarTelefone(contato.telefone_e164)
              : "",
            email: contato.email ?? "",
            responsavelId: contato.responsavel_id ?? "",
            observacao: contato.observacao ?? "",
          }}
          // O telefone gravado a action lê do banco, não daqui.
          ocultos={{
            id: contato.id,
            // Salvar volta para o mesmo lugar do Cancelar.
            voltar: voltar ?? "",
          }}
          responsaveis={escolheResponsavel ? { opcoes, semDono: true } : null}
          responsavelFixo={
            escolheResponsavel
              ? undefined
              : {
                  nome: contato.responsavel?.nome ?? null,
                  ajuda:
                    perfil && !ehAtendente(perfil.papel)
                      ? "Para passar a outra pessoa, use “Trocar” na ficha."
                      : undefined,
                }
          }
          cancelar={destino}
        />
      </div>
    </div>
  );
}
