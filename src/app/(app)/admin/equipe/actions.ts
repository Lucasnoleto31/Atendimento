"use server";

import { revalidatePath, updateTag } from "next/cache";
import { after } from "next/server";
import { perfilAtivo } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";
import { createServiceClient } from "@/lib/supabase/server";
import { apagarFotosDaPasta, TAG_FOTOS_EQUIPE } from "@/lib/fotos-equipe";
import type { ResultadoAcao } from "../../configuracoes/resultado";

/*
 * Administração › Equipe: a foto de alguém, tirada pelo admin. Quem põe e
 * troca é sempre a própria pessoa, em Minha conta; o admin só tira. É o
 * caminho de saída da foto de quem não tira sozinho: a conta desativada (a
 * pessoa não entra mais) e qualquer outro caso em que a foto precise sair
 * sem esperar por ela.
 */

/** O id do Auth (o mesmo de profiles): um uuid. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tira a foto de uma pessoa da equipe: a URL sai dos metadados do Auth dela
 * (service role, porque não é a sessão dela) e a pasta equipe/<id>/ é
 * esvaziada depois da resposta. Fica no log com o nome de quem perdeu a
 * foto.
 */
export async function removerFotoDeUsuario(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  // Admin com conta ativa: a aba aberta de quem foi desativado ou rebaixado
  // não mexe na equipe.
  const admin = await perfilAtivo();
  if (!admin || admin.papel !== "admin") {
    return { erro: "Só o admin tira a foto de alguém." };
  }

  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { erro: "Pessoa não informada." };

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return {
      erro: "O servidor está sem a chave de serviço do Supabase. Nada foi removido.",
    };
  }

  const { data: pessoa } = await service
    .from("profiles")
    .select("nome")
    .eq("id", id)
    .maybeSingle();
  const nome = (pessoa as { nome: string } | null)?.nome ?? null;
  if (!nome) return { erro: "Essa pessoa não está mais na equipe." };

  // null apaga a chave dos metadados; as outras chaves ficam como estão.
  const { error } = await service.auth.admin.updateUserById(id, {
    user_metadata: { foto_url: null },
  });
  if (error) {
    console.error(`[equipe] foto não saiu: ${error.message}`);
    return { erro: `A foto não foi removida: ${error.message}` };
  }

  after(() => apagarFotosDaPasta(service, id, null));
  // O log lê "Ana removeu a foto de Bia".
  registrarAcesso(admin.id, "removeu_foto_usuario", {
    usuario_id: id,
    alvo: nome,
    mudancas: [{ campo: "foto", depois: "removida" }],
  });
  // A foto some do menu da pessoa, da Equipe e de onde mais aparecer.
  updateTag(TAG_FOTOS_EQUIPE);
  revalidatePath("/", "layout");
  return { ok: `Foto de ${nome} removida` };
}
