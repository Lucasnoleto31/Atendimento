"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { PAPEIS, rotuloPapel } from "@/lib/papeis";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtivo } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";
import type { ResultadoAcao } from "../configuracoes/resultado";
import { EMAIL_EXEMPLO } from "@/lib/marca";

export type ResultadoUsuario = {
  ok?: boolean;
  erro?: string;
  senha?: string;
  email?: string;
};

const PAPEIS_VALIDOS = new Set<string>(PAPEIS.map((p) => p.papel));

/** Banimento que dura enquanto a conta estiver desativada (100 anos). */
const BANIDO = "876000h";

/** Admin com conta ativa. Conta desativada com a aba aberta não cria nem
 *  muda ninguém: o layout só barra a tela na próxima carga. */
async function exigirAdmin() {
  const perfil = await perfilAtivo();
  if (!perfil || perfil.papel !== "admin") return null;
  return perfil;
}

const SO_ADMIN: ResultadoAcao = { erro: "Só o admin muda a equipe." };

/** A equipe e o rodízio aparecem em várias subpáginas da Administração
 *  (Equipe, Atendimento, o índice): relê todas. */
function pronto(ok: string): ResultadoAcao {
  revalidatePath("/admin", "layout");
  return { ok };
}

/** Cria o usuário com senha temporária exibida uma única vez. */
export async function criarUsuario(
  _estado: ResultadoUsuario,
  formData: FormData,
): Promise<ResultadoUsuario> {
  const admin = await exigirAdmin();
  if (!admin) return { erro: "Só o admin cria usuários." };

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const papel = String(formData.get("papel") ?? "vendedor");

  if (!nome) return { erro: "Escreva o nome da pessoa." };
  if (!email) return { erro: "Escreva o e-mail da pessoa." };
  if (!PAPEIS_VALIDOS.has(papel)) return { erro: "Escolha um dos papéis." };

  const senha = randomBytes(9).toString("base64url");
  const service = createServiceClient();

  const { data: criado, error } = await service.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, papel },
  });

  if (error) {
    return {
      erro: error.message.includes("already")
        ? "Já existe um usuário com esse e-mail."
        : `Não deu para criar: ${error.message}`,
    };
  }

  registrarAcesso(admin.id, "criou_usuario", {
    usuario_id: criado.user?.id,
    alvo: nome,
    email,
    mudancas: [{ campo: "papel", depois: rotuloPapel(papel) }],
  });
  revalidatePath("/admin", "layout");
  return { ok: true, senha, email };
}

/** Gera uma senha nova, exibida uma única vez. */
export async function resetarSenha(
  _estado: ResultadoUsuario,
  formData: FormData,
): Promise<ResultadoUsuario> {
  const admin = await exigirAdmin();
  if (!admin) return { erro: "Só o admin gera senha nova." };

  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "");
  if (!id) return { erro: "Usuário não informado." };

  const senha = randomBytes(9).toString("base64url");
  const service = createServiceClient();

  const { error } = await service.auth.admin.updateUserById(id, {
    password: senha,
  });

  if (error) return { erro: `Não deu para gerar: ${error.message}` };
  // Quem tem a senha nova entra na conta: fica na trilha quem gerou e para quem.
  registrarAcesso(admin.id, "resetou_senha", { usuario_id: id, email });
  return { ok: true, senha, email };
}

const NOME_MAX = 80;
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Erro do Auth na troca de e-mail, dito para quem está na tela. */
function motivoDoEmail(erro: { code?: string; message: string }): string {
  if (erro.code === "email_exists" || /already/i.test(erro.message)) {
    return "Esse e-mail já é de outra conta. Nada foi salvo.";
  }
  if (erro.code === "email_address_invalid") {
    return "O Supabase não aceitou esse e-mail. Nada foi salvo.";
  }
  return `Não deu para trocar o e-mail: ${erro.message}. Nada foi salvo.`;
}

/**
 * Corrige o nome e o e-mail de alguém da equipe. O nome é só profiles. O
 * e-mail é o de entrada: muda primeiro no Auth (service role, já confirmado,
 * sem e-mail de confirmação) e depois em profiles, no mesmo passo. Se o Auth
 * recusar (e-mail já usado), nada é gravado; se o perfil falhar depois, o
 * Auth volta ao e-mail de antes.
 */
export async function corrigirUsuario(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const admin = await exigirAdmin();
  if (!admin) return SO_ADMIN;

  const id = String(formData.get("id") ?? "");
  const nome = String(formData.get("nome") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!id) return { erro: "Usuário não informado." };
  if (!nome) return { erro: "Escreva o nome da pessoa." };
  if (nome.length > NOME_MAX) {
    return { erro: `O nome pode ter no máximo ${NOME_MAX} caracteres.` };
  }
  if (!EMAIL_VALIDO.test(email)) {
    return { erro: `Escreva um e-mail válido, como ${EMAIL_EXEMPLO.replace("voce@", "nome@")}.` };
  }

  const supabase = await createClient();
  const { data: antes, error: erroLeitura } = await supabase
    .from("profiles")
    .select("nome, email")
    .eq("id", id)
    .maybeSingle();
  if (erroLeitura || !antes) return { erro: "Usuário não encontrado." };

  const mudaNome = nome !== antes.nome;
  const mudaEmail = email !== String(antes.email).toLowerCase();
  if (!mudaNome && !mudaEmail) return { ok: "Nada mudou" };

  let service: ReturnType<typeof createServiceClient> | null = null;
  if (mudaEmail) {
    try {
      service = createServiceClient();
    } catch {
      return {
        erro: "O servidor está sem a chave de serviço do Supabase. Nada foi salvo.",
      };
    }
    const { error } = await service.auth.admin.updateUserById(id, {
      email,
      email_confirm: true,
    });
    if (error) return { erro: motivoDoEmail(error) };
  }

  const { data: gravado, error: erroPerfil } = await supabase
    .from("profiles")
    .update({
      ...(mudaNome ? { nome } : {}),
      ...(mudaEmail ? { email } : {}),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (erroPerfil || !gravado) {
    // O perfil não gravou: o login volta ao e-mail de antes.
    if (service) {
      const { error: erroVolta } = await service.auth.admin.updateUserById(
        id,
        { email: antes.email, email_confirm: true },
      );
      if (erroVolta) {
        return {
          erro: `O login de ${antes.nome} já entra com ${email}, mas a equipe ainda mostra ${antes.email}. Salve de novo.`,
        };
      }
    }
    if (erroPerfil?.code === "23505") {
      return { erro: "Esse e-mail já está na equipe. Nada foi salvo." };
    }
    return {
      erro: erroPerfil
        ? `Não deu para salvar: ${erroPerfil.message}. Nada foi salvo.`
        : "Não deu para salvar. Tente de novo.",
    };
  }

  if (mudaNome) {
    registrarAcesso(admin.id, "mudou_nome_usuario", {
      usuario_id: id,
      nome,
      antes: antes.nome,
    });
  }
  if (mudaEmail) {
    registrarAcesso(admin.id, "mudou_email_usuario", {
      usuario_id: id,
      nome,
      email,
      antes: antes.email,
    });
  }

  // O nome aparece no menu, nas conversas e no relatório; não só aqui.
  revalidatePath("/", "layout");
  return {
    ok:
      mudaNome && mudaEmail
        ? `Nome e e-mail de ${nome} salvos`
        : mudaNome
          ? `Nome salvo: ${nome}`
          : `E-mail de ${nome} salvo`,
  };
}

export async function mudarPapel(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const admin = await exigirAdmin();
  if (!admin) return SO_ADMIN;

  const id = String(formData.get("id") ?? "");
  const papel = String(formData.get("papel") ?? "");

  if (!id || !PAPEIS_VALIDOS.has(papel)) return { erro: "Escolha um dos papéis." };
  if (id === admin.id && papel !== "admin") {
    return { erro: "Você não pode rebaixar o próprio papel." };
  }

  const supabase = await createClient();
  // O papel de antes, para o log dizer de qual para qual.
  const { data: antes } = await supabase
    .from("profiles")
    .select("papel")
    .eq("id", id)
    .maybeSingle();
  const { data, error } = await supabase
    .from("profiles")
    .update({ papel })
    .eq("id", id)
    .select("nome")
    .maybeSingle();

  if (error) return { erro: `Não deu para alterar: ${error.message}` };
  if (data && antes?.papel !== papel) {
    registrarAcesso(admin.id, "mudou_papel_usuario", {
      usuario_id: id,
      alvo: data.nome,
      mudancas: [
        {
          antes: antes ? rotuloPapel(antes.papel) : undefined,
          depois: rotuloPapel(papel),
        },
      ],
    });
  }
  return pronto(
    data?.nome
      ? `${data.nome} agora é ${rotuloPapel(papel)}`
      : `Papel salvo: ${rotuloPapel(papel)}`,
  );
}

/** Entra ou sai do rodízio da distribuição automática (0041). */
export async function alternarRecebeLeads(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const admin = await exigirAdmin();
  if (!admin) return { erro: "Só o admin muda quem entra no rodízio." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Usuário não informado." };

  const supabase = await createClient();
  const { data, error: erroLeitura } = await supabase
    .from("profiles")
    .select("nome, recebe_leads")
    .eq("id", id)
    .single();
  if (erroLeitura || !data) {
    return {
      erro: "Rode a migração 0041 para controlar o rodízio por usuário.",
    };
  }

  // Estado pedido pelo formulário (1 ou 0), não "inverter": o duplo toque
  // na chave não desfaz o primeiro.
  const pedido = formData.get("recebe");
  const entra = pedido === null ? !data.recebe_leads : pedido === "1";
  const { data: gravado, error } = await supabase
    .from("profiles")
    .update({ recebe_leads: entra })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return { erro: `Não deu para alterar: ${error.message}` };
  // O segundo toque de um duplo clique não muda nada e não vira registro.
  if (gravado && data.recebe_leads !== entra) {
    registrarAcesso(admin.id, entra ? "pos_no_rodizio" : "tirou_do_rodizio", {
      usuario_id: id,
      alvo: data.nome,
    });
  }
  return pronto(
    entra ? `${data.nome} entrou no rodízio` : `${data.nome} saiu do rodízio`,
  );
}

/**
 * Desativa ou reativa a conta. Desativar grava o perfil e bane o usuário no
 * Auth: sem o banimento, a conta desativada entrava de novo e chegava às
 * rotas de exportação antes de o layout mostrar "Acesso desativado". O
 * banimento impede login novo e a renovação do token; a aba que já estava
 * aberta perde o acesso pelas guardas das actions (que conferem `ativo`) e,
 * no tempo real, quando o token vence.
 *
 * O formulário manda o estado pedido (ativo=1 ou 0), não "inverte": o
 * segundo toque de um duplo clique não desfaz o primeiro. Perfil e Auth
 * andam juntos: se o banimento falhar, o perfil volta ao que era.
 */
export async function alternarUsuarioAtivo(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const admin = await exigirAdmin();
  if (!admin) return SO_ADMIN;

  const id = String(formData.get("id") ?? "");
  if (!id) return { erro: "Usuário não informado." };
  if (id === admin.id) return { erro: "Você não pode desativar a si mesmo." };

  const supabase = await createClient();
  const { data, error: erroLeitura } = await supabase
    .from("profiles")
    .select("nome, ativo")
    .eq("id", id)
    .single();
  if (erroLeitura || !data) return { erro: "Usuário não encontrado." };

  const pedido = formData.get("ativo");
  const ativo = pedido === null ? !data.ativo : pedido === "1";

  const { data: gravado, error } = await supabase
    .from("profiles")
    .update({ ativo })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { erro: `Não deu para alterar: ${error.message}` };
  // Sem linha de volta o perfil não mudou (saiu no meio): o login no Auth
  // não se mexe, para não banir ou liberar quem o perfil não acompanha.
  if (!gravado) return { erro: "Usuário não encontrado." };

  const { error: erroBan } =
    await createServiceClient().auth.admin.updateUserById(id, {
      ban_duration: ativo ? "none" : BANIDO,
    });
  if (erroBan) {
    await supabase.from("profiles").update({ ativo: data.ativo }).eq("id", id);
    return {
      erro: ativo
        ? `Não deu para liberar o login de ${data.nome}: ${erroBan.message}. A conta continua desativada.`
        : `Não deu para bloquear o login de ${data.nome}: ${erroBan.message}. A conta continua ativa.`,
    };
  }

  // Perfil e login gravados. O segundo toque de um duplo clique não muda
  // nada e não vira registro.
  if (data.ativo !== ativo) {
    registrarAcesso(admin.id, ativo ? "reativou_usuario" : "desativou_usuario", {
      usuario_id: id,
      alvo: data.nome,
    });
  }
  return pronto(
    ativo
      ? `Acesso de ${data.nome} reativado`
      : `Acesso de ${data.nome} desativado`,
  );
}
