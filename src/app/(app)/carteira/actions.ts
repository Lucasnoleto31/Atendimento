"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilQueEscreve } from "@/lib/auth";
import { variantesTelefone } from "@/lib/csv";

export type ResultadoConversa = { leadId?: string; erro?: string };

/**
 * Abre atendimento para um cliente que ainda não tem lead — o caso do cliente
 * que veio pela importação da corretora e acabou de ganhar telefone no
 * cadastro. Reaproveita o lead que já exista com aquele número; só cria um
 * novo quando não há nenhum.
 */
export async function abrirConversaCliente(
  customerId: string,
): Promise<ResultadoConversa> {
  const perfil = await perfilQueEscreve();
  if (!perfil)
    return {
      erro: "Sem permissão para alterar (perfil somente leitura) — ou a sessão expirou.",
    };
  if (!customerId) return { erro: "Cliente não informado." };

  const supabase = await createClient();

  const { data: cliente } = await supabase
    .from("customers")
    .select("id, nome_completo, telefone_e164, responsavel_id")
    .eq("id", customerId)
    .maybeSingle();

  if (!cliente) return { erro: "Cliente não encontrado." };
  if (!cliente.telefone_e164) {
    return {
      erro: "Este cliente ainda não tem telefone no cadastro — preencha na ficha para abrir a conversa.",
    };
  }

  // Já existe lead com esse número? Considera as DUAS grafias do nono
  // dígito — o WhatsApp registra sem o 9 e o cadastro costuma vir com —
  // e prefere a conversa que já tem mensagem em vez de criar outra.
  const { data: candidatos } = await supabase
    .from("leads")
    .select("id, customer_id, ultima_interacao_em")
    .in("telefone_e164", variantesTelefone(cliente.telefone_e164));

  const existente =
    (candidatos ?? [])
      .slice()
      .sort((a, b) =>
        (b.ultima_interacao_em ?? "").localeCompare(
          a.ultima_interacao_em ?? "",
        ),
      )[0] ?? null;

  if (existente) {
    if (!existente.customer_id) {
      await supabase
        .from("leads")
        .update({
          customer_id: cliente.id,
          cliente_confirmado_em: new Date().toISOString(),
        })
        .eq("id", existente.id);
    }
    revalidatePath("/carteira");
    return { leadId: existente.id };
  }

  const [{ data: canal }, { data: etapa }] = await Promise.all([
    supabase.from("channels").select("id").eq("slug", "whatsapp").maybeSingle(),
    supabase
      .from("pipeline_stages")
      .select("id, pipeline:pipelines!inner(padrao)")
      .eq("pipeline.padrao", true)
      .order("ordem")
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: novo, error } = await supabase
    .from("leads")
    .insert({
      nome: cliente.nome_completo,
      telefone_e164: cliente.telefone_e164,
      customer_id: cliente.id,
      cliente_confirmado_em: new Date().toISOString(),
      channel_id: canal?.id ?? null,
      stage_id: etapa?.id ?? null,
      status: "em_atendimento",
      entrada_motivo: "importacao",
      responsavel_id: cliente.responsavel_id ?? perfil.id,
    })
    .select("id")
    .single();

  if (error || !novo) {
    return { erro: error?.message ?? "Não deu para abrir a conversa." };
  }

  revalidatePath("/carteira");
  revalidatePath("/chat");
  return { leadId: novo.id };
}

// ===========================================================================
// Ficha do cliente
// ===========================================================================

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { lerReguasConversao } from "@/lib/conversao";
import { normalizarTelefone } from "@/lib/csv";
import { formatarTelefone } from "@/lib/format";
import { parsearContas } from "@/lib/clientes";

/**
 * Edição da ficha do cliente — o único lugar onde dá para gravar o telefone
 * de quem veio pela importação da corretora e nunca teve lead. Salvar o
 * telefone dispara o gatilho da 0020, que adota o lead daquele número.
 */
export async function salvarFichaCliente(formData: FormData) {
  const perfil = await perfilQueEscreve();
  if (!perfil) redirect("/entrar");

  const customerId = String(formData.get("customer_id") ?? "");
  if (!customerId) redirect("/carteira");
  // A Ficha 360 (aba Cliente de /leads/[id]) usa esta MESMA action — o
  // formulário manda o lead para a volta cair na aba certa.
  const voltarLead = String(formData.get("voltar_lead") ?? "");

  function terminar(aviso: string): never {
    revalidatePath(`/carteira/${customerId}`);
    revalidatePath("/carteira");
    if (voltarLead) {
      revalidatePath(`/leads/${voltarLead}`);
      redirect(
        `/leads/${voltarLead}?aba=cliente&aviso=${encodeURIComponent(aviso)}`,
      );
    }
    redirect(`/carteira/${customerId}?aviso=${encodeURIComponent(aviso)}`);
  }

  if (perfil.papel !== "admin" && perfil.papel !== "gestor") {
    terminar("Só gestor ou admin edita a ficha do cliente.");
  }

  const nome = String(formData.get("nome_completo") ?? "").trim();
  if (!nome) terminar("O nome não pode ficar vazio.");

  const telefoneBruto = String(formData.get("telefone") ?? "").trim();
  // O campo vem preenchido com o número atual formatado. Se o gestor NÃO
  // mexeu nele, o telefone fica fora do update: regravar um número que o
  // webhook guardou fora do padrão BR o corromperia (ou travaria a ficha
  // inteira no "telefone inválido"), e o gatilho 0024 — vincular leads por
  // telefone — redispararia a cada save.
  const telefoneOriginal = String(formData.get("telefone_original") ?? "");
  const telefoneIntocado =
    telefoneBruto === telefoneOriginal ||
    (telefoneOriginal !== "" &&
      telefoneBruto === formatarTelefone(telefoneOriginal)) ||
    (telefoneOriginal === "" && telefoneBruto === "");
  let telefone: string | null = null;
  if (!telefoneIntocado && telefoneBruto) {
    telefone = normalizarTelefone(telefoneBruto);
    if (!telefone) {
      terminar(
        "Telefone inválido. Use DDD + número, por exemplo 62 98181-0004.",
      );
    }
  }

  const documento = String(formData.get("documento") ?? "").replace(/\D/g, "");
  if (documento && documento.length !== 11 && documento.length !== 14) {
    terminar("CPF/CNPJ inválido — 11 dígitos (CPF) ou 14 (CNPJ).");
  }

  const email = String(formData.get("email") ?? "").trim();
  const abertura = String(formData.get("conta_aberta_em") ?? "").trim();
  const responsavel = String(formData.get("responsavel_id") ?? "");
  const ativo = String(formData.get("situacao") ?? "ativa") === "ativa";

  const service = createServiceClient();

  // CPF repetido é o que gera briga de comissão: avisa apontando o cadastro
  // que já existe, em vez de deixar nascer o segundo. Desligável na régua.
  if (documento) {
    const { travarCpfDuplicado } = await lerReguasConversao(service);
    if (travarCpfDuplicado) {
      // limit(1) em vez de maybeSingle: com DOIS cadastros repetidos o
      // maybeSingle devolve erro e a trava passaria batido justamente no
      // caso que ela existe para pegar.
      const { data: repetidos, error: erroDoc } = await service
        .from("customers")
        .select("id, nome_completo")
        .eq("documento", documento)
        .neq("id", customerId)
        .limit(1);
      if (erroDoc) {
        terminar(
          "Não deu para conferir se este CPF/CNPJ já existe. Tente de novo em instantes.",
        );
      }
      const mesmoDoc = repetidos?.[0];
      if (mesmoDoc) {
        terminar(
          `Este CPF/CNPJ já está no cadastro de ${mesmoDoc.nome_completo}. Se for a mesma pessoa, use o cadastro que já existe em vez de criar outro.`,
        );
      }
    }
  }

  // Telefone é único entre clientes: avisa em vez de estourar erro do banco.
  if (!telefoneIntocado && telefone) {
    const { data: conflito } = await service
      .from("customers")
      .select("id, nome_completo")
      .eq("telefone_e164", telefone)
      .neq("id", customerId)
      .maybeSingle();
    if (conflito) {
      terminar(
        `Este telefone já está no cadastro de ${conflito.nome_completo}. Verifique se não é a mesma pessoa duplicada.`,
      );
    }
  }

  const mudancas: Record<string, unknown> = {
    nome_completo: nome,
    email: email || null,
    conta_aberta_em: abertura || null,
    responsavel_id: responsavel || null,
    ativo,
  };
  // O campo vem mascarado na tela: vazio é "não mexi", não "apague".
  if (documento) mudancas.documento = documento;
  if (!telefoneIntocado) mudancas.telefone_e164 = telefone;

  const { error } = await service
    .from("customers")
    .update(mudancas)
    .eq("id", customerId);

  if (error) terminar(`Não deu para salvar: ${error.message}`);

  // Contas adicionais (veio do antigo atualizarCliente da ficha do lead):
  // acrescenta sem apagar — a importação da base manda na lista completa.
  // O texto NÃO começa com "Ficha salva": a ficha classifica esse prefixo
  // como sucesso (banner verde), e falha parcial tem que sair como aviso.
  const parse = parsearContas(String(formData.get("contas") ?? ""));
  if ("erro" in parse) {
    terminar(`Dados salvos, mas as contas não: ${parse.erro}`);
  }
  if (parse.contas.length > 0) {
    const { error: erroContas } = await service
      .from("customer_accounts")
      .upsert(
        parse.contas.map((conta) => ({ customer_id: customerId, conta })),
        { onConflict: "conta", ignoreDuplicates: true },
      );
    if (erroContas) {
      terminar(`Dados salvos, mas as contas não: ${erroContas.message}`);
    }
  }

  terminar(
    !telefoneIntocado && telefone
      ? "Ficha salva. Com o telefone no cadastro, dá para abrir a conversa."
      : "Ficha salva.",
  );
}
