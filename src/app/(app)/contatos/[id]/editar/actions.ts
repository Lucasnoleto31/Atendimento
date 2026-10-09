"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve } from "@/lib/auth";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { formatarTelefone } from "@/lib/format";
import { normalizarTelefone, variantesTelefone } from "@/lib/telefone";
import { AVISO_PASSOU, comAvisoLista } from "../../aviso-lista";
import { emailValido } from "../../email";
import type { CampoContato, EstadoFormContato } from "../../form-estado";
import {
  lerVoltar,
  voltarDiferenteDe,
  voltarSemOContato,
} from "../../voltar";

const digitos = (valor: string) => valor.replace(/\D/g, "");

/**
 * Salva a edição e volta para onde o Cancelar voltaria. Erro de digitação,
 * de permissão ou do banco volta para o formulário (useActionState), que
 * continua com o que foi digitado.
 */
export async function atualizarContato(
  anterior: EstadoFormContato,
  formData: FormData,
): Promise<EstadoFormContato> {
  const perfil = await perfilQueEscreve();
  if (!perfil) redirect("/entrar");

  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const telefoneBruto = String(formData.get("telefone") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  // Sem o campo (o atendente e o assessor veem o responsável como texto),
  // o dono fica como está: a troca deles é pelo "Trocar" da ficha.
  const mudaResponsavel = formData.has("responsavel_id");
  const responsavelId = String(formData.get("responsavel_id") ?? "");
  const observacao = String(formData.get("observacao") ?? "").trim();
  // O mesmo caminho de volta da tela: o sucesso termina onde o Cancelar
  // terminaria.
  const voltar = voltarDiferenteDe(
    lerVoltar(formData.get("voltar")),
    `/contatos/${id}/editar`,
  );

  const falha = (
    erro: string,
    campo: CampoContato | null = null,
  ): EstadoFormContato => ({ erro, campo, vez: anterior.vez + 1 });

  if (!id) redirect("/contatos");
  if (!nome) return falha("Informe o nome do contato.", "nome");

  const supabase = await createClient();

  // O número gravado vem do banco, lido com o RLS de quem edita, e não de
  // campo oculto da tela: o navegador manda nele o que quiser, e era ele que
  // decidia se o telefone ficava sem normalizar e se o vínculo com o
  // cliente caía.
  // Junto, os donos que esta pessoa não vê (Administração > Privacidade):
  // contato de um deles é como o que o RLS não devolve.
  const [{ data: gravado, error: erroLeitura }, ocultos] = await Promise.all([
    supabase
      .from("leads")
      .select("telefone_e164, responsavel_id")
      .eq("id", id)
      .maybeSingle(),
    donosOcultosParaMim().catch(() => null),
  ]);
  if (erroLeitura) return falha(`Não deu para salvar: ${erroLeitura.message}`);
  if (!ocultos) {
    return falha("Nada foi salvo: as regras de privacidade não carregaram. Tente de novo.");
  }
  if (!gravado || donoOculto(gravado.responsavel_id, ocultos)) {
    return falha(
      "Nada foi salvo: o contato não foi encontrado ou você não tem acesso a ele.",
    );
  }
  const telefoneAtual: string | null = gravado.telefone_e164 ?? null;

  // O campo com os mesmos dígitos do número gravado (ou do que a tela
  // mostrou dele) é o mesmo número: fica como está, sem passar pela
  // normalização. Assim corrigir só o nome de um contato de fora não mexe
  // no telefone, mesmo que ele tenha sido gravado sem o "+" (o wa_id de
  // quem escreve de fora chega assim).
  const noCampo = digitos(telefoneBruto);
  const intocado =
    telefoneAtual !== null &&
    noCampo !== "" &&
    (noCampo === digitos(telefoneAtual) ||
      noCampo === digitos(formatarTelefone(telefoneAtual)));

  // Número mudado de fora entra com "+" e o código do país: sem a opção, o
  // americano 14155552672 viraria DDD 14, um número de Bauru, e o vínculo
  // com o cliente cairia junto.
  const telefone = intocado
    ? telefoneAtual
    : telefoneBruto
      ? normalizarTelefone(telefoneBruto, { aceitarExterior: true })
      : null;
  if (telefoneBruto && !telefone) {
    return falha(
      "Telefone inválido. Use DDD e número, por exemplo 11 98842-1170. De fora do Brasil, comece com + e o código do país.",
      "telefone",
    );
  }
  if (email && !emailValido(email)) {
    return falha(
      "E-mail sem @ ou sem domínio. Exemplo: nome@empresa.com.",
      "email",
    );
  }

  // Número novo é outra pessoa, e o vínculo com o cliente da corretora
  // (customer_id) não pode ficar: o assessor da carteira antiga seguiria
  // vendo o contato e as conversas do número novo, e o gatilho do dono da
  // carteira poderia passar o cliente para o responsável deste contato.
  // Zerado no mesmo update, o gatilho do banco (t02) religa pelo número novo
  // ou deixa sem vínculo. Só a outra grafia do nono dígito é o mesmo número:
  // aí o vínculo fica, inclusive o feito por CPF ou à mão.
  const trocouTelefone =
    !intocado &&
    telefone !== telefoneAtual &&
    !(
      telefone &&
      telefoneAtual &&
      variantesTelefone(telefoneAtual).includes(telefone)
    );

  // O .select("id") diz se a linha foi gravada: sem permissão sobre o
  // contato, o RLS não devolve erro, só não atualiza nada.
  const { data, error } = await supabase
    .from("leads")
    .update({
      nome,
      telefone_e164: telefone,
      email: email || null,
      ...(mudaResponsavel ? { responsavel_id: responsavelId || null } : {}),
      observacao: observacao || null,
      ...(trocouTelefone ? { customer_id: null } : {}),
    })
    .eq("id", id)
    .select("id");

  if (error) {
    // 42501: o RLS recusou a linha como ela ficaria, porque quem edita
    // deixaria de enxergá-la (outro responsável, ou o telefone novo tirou o
    // contato da carteira dele). O Postgres desfaz o update inteiro: nada
    // foi gravado, e a mensagem precisa dizer isso.
    if (error.code === "23505") {
      return falha("Já existe outro contato com esse telefone.", "telefone");
    }
    if (error.code === "42501") {
      return falha(
        trocouTelefone
          ? "Nada foi salvo: com o telefone novo ou o novo responsável, você deixaria de ver este contato. Peça a troca à gestão."
          : "Nada foi salvo: você não tem permissão para passar este contato para outra pessoa.",
      );
    }
    return falha(`Não deu para salvar: ${error.message}`);
  }
  if (!data || data.length === 0) {
    return falha("Nada foi salvo: você não tem permissão para editar este contato.");
  }

  revalidatePath("/contatos");
  revalidatePath(`/contatos/${id}`);
  // Passou para alguém cujos contatos esta pessoa não vê: a ficha (e a
  // conversa) dele cairiam no "não encontrado". Volta para onde ele não
  // está; o normal é a lista, onde ele já não aparece, e ela diz por quê.
  if (mudaResponsavel && donoOculto(responsavelId || null, ocultos)) {
    redirect(
      comAvisoLista(
        voltarSemOContato(voltar, id) ?? "/contatos",
        AVISO_PASSOU,
        responsavelId,
      ),
    );
  }
  redirect(voltar ?? `/contatos/${id}`);
}
