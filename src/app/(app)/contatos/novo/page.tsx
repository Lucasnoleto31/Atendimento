import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { ehGestao, somenteLeitura } from "@/lib/papeis";
import { FormContato } from "../form-contato";
import { LinkVoltar } from "../link-voltar";
import { lerVoltar, rotuloVoltar, voltarDiferenteDe } from "../voltar";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Novo contato") };

/** O primeiro valor de um parâmetro da URL, limpo e cortado. */
function textoDe(valor: unknown, maximo: number): string {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return typeof bruto === "string" ? bruto.trim().slice(0, maximo) : "";
}

/**
 * O cadastro. A busca sem resultado da lista abre aqui com o termo já no
 * campo (?telefone= ou ?nome=) e o foco no que ficou vazio: quem procurou um
 * número e não achou não digita de novo. A conferência de duplicado continua
 * na action, no envio.
 */
export default async function NovoContatoPage({
  searchParams,
}: PageProps<"/contatos/novo">) {
  const params = await searchParams;
  // A lista filtrada manda os filtros no ?voltar=; sem ele, o pai é a lista.
  const voltar = voltarDiferenteDe(lerVoltar(params.voltar), "/contatos/novo");
  const destino = voltar ?? "/contatos";
  // O termo da busca: só o que um telefone tem, e o nome como veio.
  const telefoneInicial = textoDe(params.telefone, 40).replace(
    /[^\d+()\-\s]/g,
    "",
  );
  const nomeInicial = telefoneInicial ? "" : textoDe(params.nome, 120);

  const supabase = await createClient();
  const [perfil, { data: equipe }] = await Promise.all([
    perfilAtual(),
    supabase
      .from("profiles")
      .select("id, nome, papel")
      .eq("ativo", true)
      .order("nome"),
  ]);
  // Compliance só lê: o formulário nem abre.
  if (perfil && somenteLeitura(perfil.papel)) redirect(destino);
  // Só a gestão escolhe o responsável; os demais cadastram para si (a action
  // aplica a mesma regra).
  const escolheResponsavel = ehGestao(perfil?.papel);
  // Para a gestão, os destinos do chat: sem quem só lê (o compliance não
  // atende). A carga de conversas abertas de cada um o formulário lê depois
  // de abrir, sem a página esperar.
  const opcoes = (
    (equipe ?? []) as { id: string; nome: string; papel: string }[]
  )
    .filter((p) => !somenteLeitura(p.papel))
    .map(({ id, nome }) => ({ id, nome }));

  return (
    <div className="@container px-2 pt-2 pb-4 md:px-3 md:pt-3">
      <LinkVoltar
        href={destino}
        rotulo={voltar ? rotuloVoltar(voltar) : "Contatos"}
      />

      <header className="mt-2">
        <h1 className="tipo-titulo-1 text-tinta">Novo contato</h1>
      </header>

      <div className="mt-3">
        <FormContato
          modo="novo"
          valores={{
            nome: nomeInicial,
            telefone: telefoneInicial,
            email: "",
            responsavelId: perfil?.id ?? "",
            observacao: "",
          }}
          // A ficha nova (ou a existente, se o número já estiver na base)
          // abre com o mesmo caminho de volta do Cancelar.
          ocultos={{ voltar: voltar ?? "" }}
          responsaveis={
            escolheResponsavel ? { opcoes, semDono: false } : null
          }
          foco={
            telefoneInicial ? "nome" : nomeInicial ? "telefone" : undefined
          }
          cancelar={destino}
        />
      </div>
    </div>
  );
}
