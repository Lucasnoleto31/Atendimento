"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve } from "@/lib/auth";
import { ehGestao } from "@/lib/papeis";
import { donoOculto, donosOcultosParaMim } from "@/lib/privacidade";
import { normalizarTelefone, variantesTelefone } from "@/lib/telefone";
import { AVISO_DUPLICADO } from "../[id]/aviso-ficha";
import {
  AVISO_CADASTRADO,
  AVISO_CADASTRADO_OCULTO,
  comAvisoLista,
} from "../aviso-lista";
import { emailValido } from "../email";
import type { CampoContato, EstadoFormContato } from "../form-estado";
import {
  comVoltar,
  lerVoltar,
  voltarDiferenteDe,
  voltarSemOContato,
} from "../voltar";

/**
 * Cadastra o contato e abre a ficha dele (ou volta para a lista, com o
 * aviso, quando a ficha não abriria para quem cadastrou). Erro de digitação ou do banco
 * volta para o formulário (useActionState), que continua preenchido: antes,
 * o erro redirecionava para ?aviso= e a pessoa digitava tudo de novo.
 */
export async function criarContato(
  anterior: EstadoFormContato,
  formData: FormData,
): Promise<EstadoFormContato> {
  const perfil = await perfilQueEscreve();
  if (!perfil) redirect("/entrar");

  const nome = String(formData.get("nome") ?? "").trim();
  const telefoneBruto = String(formData.get("telefone") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const responsavelId = String(formData.get("responsavel_id") ?? "");
  const observacao = String(formData.get("observacao") ?? "").trim();
  // De onde a pessoa abriu o cadastro: segue para a ficha, para o "←" de lá
  // voltar ao mesmo ponto (a lista com os filtros, por exemplo).
  const voltar = voltarDiferenteDe(
    lerVoltar(formData.get("voltar")),
    "/contatos/novo",
  );

  const falha = (
    erro: string,
    campo: CampoContato | null = null,
  ): EstadoFormContato => ({ erro, campo, vez: anterior.vez + 1 });

  if (!nome) return falha("Informe o nome do contato.", "nome");

  // Número de fora entra com "+" e o código do país, como foi digitado.
  const telefone = telefoneBruto
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

  const supabase = await createClient();

  // Mesmo telefone, duas grafias: o WhatsApp registra celular antigo sem o
  // nono dígito e a planilha traz com ele. Cadastrar sem olhar as duas cria
  // um segundo contato para quem já está sendo atendido, e a resposta cai
  // sempre no antigo, porque é o número que o WhatsApp usa.
  if (telefone) {
    const { data: existente } = await supabase
      .from("leads")
      .select("id, responsavel_id")
      .in("telefone_e164", variantesTelefone(telefone))
      .limit(1)
      .maybeSingle();
    // O contato que já existe é de alguém que esta pessoa não vê
    // (Administração > Privacidade): a ficha dele cairia no "não
    // encontrado". O cadastro para aqui, sem abrir nada nem dizer de quem é.
    // Sem a regra carregada, vale o mesmo: melhor parar do que abrir a ficha.
    if (existente) {
      const ocultos = await donosOcultosParaMim().catch(() => null);
      // Sem a regra, não dá para dizer de quem é: o contato pode ser da
      // própria pessoa, e "com outra pessoa da equipe" seria falso.
      if (!ocultos) {
        return falha(
          "Não deu para conferir o telefone: as regras de privacidade não carregaram. Tente de novo.",
          "telefone",
        );
      }
      if (donoOculto(existente.responsavel_id, ocultos)) {
        return falha(
          "Já existe um contato com esse telefone, com outra pessoa da equipe.",
          "telefone",
        );
      }
      // Vai só o código: o texto, com o nome e o dono, a ficha escreve com o
      // que ela mesma leu. Frase pronta na URL deixava um link de fora pôr
      // qualquer coisa no aviso.
      redirect(
        comVoltar(`/contatos/${existente.id}?aviso=${AVISO_DUPLICADO}`, voltar),
      );
    }
  }

  // Etapa e status ficam com o default do banco: a tela não usa nenhum dos
  // dois. Quem não é gestão cadastra para si mesmo.
  const dono = ehGestao(perfil.papel) ? responsavelId || perfil.id : perfil.id;
  const { data: contato, error } = await supabase
    .from("leads")
    .insert({
      nome,
      telefone_e164: telefone,
      email: email || null,
      entrada_motivo: "manual",
      responsavel_id: dono,
      observacao: observacao || null,
    })
    .select("id")
    .single();

  if (error) {
    return error.code === "23505"
      ? falha("Já existe um contato com esse telefone.", "telefone")
      : falha(`Não deu para cadastrar: ${error.message}`);
  }

  revalidatePath("/contatos");

  // A gestão cadastrou para alguém cujos contatos ela não vê
  // (Administração > Privacidade): a ficha cairia no "não encontrado" logo
  // depois do cadastro. Volta para onde o contato não está, e a lista diz
  // que o cadastro valeu e por que ele não aparece. Sem a regra carregada,
  // não dá para saber se a ficha abriria: vale o mesmo caminho, com o aviso
  // só do cadastro.
  if (dono !== perfil.id) {
    const ocultos = await donosOcultosParaMim().catch(() => null);
    if (!ocultos || donoOculto(dono, ocultos)) {
      redirect(
        comAvisoLista(
          voltarSemOContato(voltar, contato.id) ?? "/contatos",
          ocultos ? AVISO_CADASTRADO_OCULTO : AVISO_CADASTRADO,
          dono,
        ),
      );
    }
  }
  redirect(comVoltar(`/contatos/${contato.id}`, voltar));
}
