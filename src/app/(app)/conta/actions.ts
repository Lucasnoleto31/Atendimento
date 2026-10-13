"use server";

import { revalidatePath, updateTag } from "next/cache";
import { after } from "next/server";
import { createClient as criarClienteSupabase } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { perfilAtivo } from "@/lib/auth";
import { registrarAcesso } from "@/lib/auditoria";
import { BUCKET_FOTOS } from "@/lib/avatar";
import { enviarAvisoSenhaTrocada } from "@/lib/email";
import {
  apagarFotosDaPasta,
  caminhoFotoEquipe,
  LADO_FOTO_EQUIPE,
  lerFotoEquipe,
  TAG_FOTOS_EQUIPE,
  urlFotoEquipe,
} from "@/lib/fotos-equipe";
import {
  ipDoCliente,
  JANELA_MIN,
  MAX_FALHAS,
  paraFiltro,
} from "@/app/entrar/freio";
import type { ResultadoAcao } from "../configuracoes/resultado";

/*
 * Minha conta: o próprio nome, a própria foto, a própria senha e as sessões
 * abertas em outros aparelhos. Toda action exige conta ativa (perfilAtivo): a aba
 * aberta de quem foi desativado não muda nada.
 */

export type ErrosSenha = {
  atual?: string;
  nova?: string;
  confirmacao?: string;
};

export type EstadoSenha = {
  ok?: string;
  erro?: string;
  erros?: ErrosSenha;
};

const SEM_SESSAO = "Sua sessão terminou. Entre de novo para continuar.";
const NOME_MAX = 80;
/** Os mesmos limites do redefinir (entrar/redefinir/actions.ts). */
const SENHA_MIN = 8;
/** Limite do bcrypt que o Supabase usa: o que passa disso é ignorado. */
const SENHA_MAX = 72;

/** O nome como fica gravado: sem espaço nas pontas nem espaço repetido. */
function limparNome(valor: FormDataEntryValue | null): string {
  return String(valor ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * O próprio nome, pelo cliente da sessão: o RLS (perfil_proprio) deixa cada
 * um mudar a própria linha, e o gatilho do banco barra papel, metas e
 * ativo. Compliance é só leitura também aqui (a policy restritiva não deixa
 * gravar), e a tela nem oferece.
 */
export async function mudarMeuNome(
  _estado: ResultadoAcao,
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await perfilAtivo();
  if (!perfil) return { erro: SEM_SESSAO };
  if (perfil.papel === "compliance") {
    return { erro: "No papel de compliance, quem muda o nome é a administração." };
  }

  const nome = limparNome(formData.get("nome"));
  if (!nome) return { erro: "Escreva o seu nome." };
  if (nome.length > NOME_MAX) {
    return { erro: `O nome pode ter no máximo ${NOME_MAX} caracteres.` };
  }
  if (nome === perfil.nome) return { ok: "Nome salvo" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ nome })
    .eq("id", perfil.id)
    .select("id")
    .maybeSingle();
  if (error) return { erro: `Não deu para salvar: ${error.message}` };
  // Nenhuma linha voltou: o RLS não deixou. Sem isto, a tela diria "salvo".
  if (!data) return { erro: "O nome não foi salvo. Fale com a administração." };

  registrarAcesso(perfil.id, "mudou_proprio_nome", {
    nome,
    antes: perfil.nome,
  });
  // O nome aparece no menu, nas conversas e no relatório.
  revalidatePath("/", "layout");
  return { ok: "Nome salvo" };
}

type Servico = ReturnType<typeof createServiceClient>;

/**
 * O IP das linhas deste freio vai com marca própria ("CONTA:<ip>"), como as
 * marcas de entrar/freio.ts. O login certo apaga as linhas do e-mail OU do
 * IP dele: com o IP cru, quem tem a sessão de outra pessoa errava 4 vezes
 * aqui, entrava com a própria conta no mesmo IP e zerava o freio. Nenhum
 * endereço IP começa com "CONTA:", então a marca não se confunde com as
 * linhas do login.
 */
function ipMarcado(ip: string): string {
  return `CONTA:${ip}`;
}

/**
 * O freio da senha atual, na tabela do freio do login (login_tentativas, 5
 * falhas em 15 minutos por e-mail OU IP). O e-mail vai cru: os dois são
 * palpites da mesma senha, e quem tem a sessão de outra pessoa não ganha 5
 * palpites aqui e mais 5 no /entrar. O IP vai marcado (ipMarcado), e a conta
 * daqui soma as linhas do e-mail com as deste IP marcado.
 *
 * Grava a tentativa ANTES de contar, como o freio do código
 * (entrar/freio.ts): contando antes, uma rajada em paralelo passaria inteira
 * pela contagem. A linha gravada já é a falha; senha certa apaga as do
 * e-mail. Sem a tabela ou com o banco fora, segue sem freio, como o login.
 */
async function reservarConferencia(
  s: Servico,
  email: string,
  ip: string,
): Promise<{ bloqueada: boolean; linha: string | null }> {
  const { data, error } = await s
    .from("login_tentativas")
    .insert({ email, ip: ipMarcado(ip) })
    .select("id")
    .single();
  if (error || !data) {
    console.error(
      `[conta] freio da senha sem registro: ${error?.message ?? "gravação sem retorno"}`,
    );
    return { bloqueada: false, linha: null };
  }
  const linha = (data as { id: string }).id;

  const { count, error: erroContagem } = await s
    .from("login_tentativas")
    .select("id", { count: "exact", head: true })
    .or(`email.eq."${paraFiltro(email)}",ip.eq."${paraFiltro(ipMarcado(ip))}"`)
    .gte("criado_em", new Date(Date.now() - JANELA_MIN * 60_000).toISOString());
  if (erroContagem) {
    console.error(`[conta] freio da senha sem contagem: ${erroContagem.message}`);
    return { bloqueada: false, linha };
  }
  // A linha desta tentativa entra na conta, daí o ">" e não o ">=".
  if ((count ?? 0) > MAX_FALHAS) {
    // A tentativa barrada não conta: quem insiste não estica o bloqueio.
    await apagarLinha(s, linha);
    return { bloqueada: true, linha: null };
  }
  return { bloqueada: false, linha };
}

async function apagarLinha(s: Servico, id: string | null) {
  if (!id) return;
  await s
    .from("login_tentativas")
    .delete()
    .eq("id", id)
    .then(
      () => {},
      () => {},
    );
}

/**
 * Confere a senha num cliente do Supabase só para isto: sem cookie e sem
 * sessão guardada, então a sessão de quem está logado não muda. A sessão
 * que o login de conferência abre é encerrada no servidor na mesma hora.
 */
async function conferirSenha(
  email: string,
  senha: string,
): Promise<"certa" | "errada" | "falhou"> {
  const conferencia = criarClienteSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  try {
    const { data, error } = await conferencia.auth.signInWithPassword({
      email,
      password: senha,
    });
    if (data.session) {
      await conferencia.auth.signOut({ scope: "local" });
    }
    if (!error && data.session) return "certa";
    if (
      error &&
      (error.code === "invalid_credentials" ||
        /invalid login credentials/i.test(error.message))
    ) {
      return "errada";
    }
    console.error(`[conta] conferência da senha falhou: ${error?.message}`);
    return "falhou";
  } catch (erro) {
    console.error(
      "[conta] conferência da senha falhou:",
      erro instanceof Error ? erro.message : erro,
    );
    return "falhou";
  }
}

/**
 * Troca a própria senha: confere a atual (com freio), grava a nova pelo
 * service role (o que tira todos os aparelhos da conta), põe este de volta
 * com a senha nova, registra no log e manda o aviso por e-mail.
 *
 * A nova vai pelo admin (updateUserById), não pelo updateUser da sessão:
 * quem cadastrou o app autenticador ainda tem o fator no Auth, e o Supabase
 * recusa troca de senha de sessão sem o segundo fator (insufficient_aal). A
 * senha atual conferida acima é a prova, como o código é no redefinir.
 */
export async function trocarSenha(
  _estado: EstadoSenha,
  formData: FormData,
): Promise<EstadoSenha> {
  const perfil = await perfilAtivo();
  if (!perfil) return { erro: SEM_SESSAO };

  const atual = String(formData.get("atual") ?? "");
  const nova = String(formData.get("nova") ?? "");
  const confirmacao = String(formData.get("confirmacao") ?? "");

  const erros: ErrosSenha = {};
  if (!atual) erros.atual = "Digite a senha que você usa hoje.";
  if (nova.length < SENHA_MIN) {
    erros.nova = `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`;
  } else if (nova.length > SENHA_MAX) {
    erros.nova = `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;
  } else if (atual && nova === atual) {
    erros.nova = "A nova senha é igual à atual.";
  } else if (confirmacao !== nova) {
    erros.confirmacao = "As duas senhas não são iguais.";
  }
  if (Object.keys(erros).length > 0) return { erros };

  // O e-mail de entrada vem do Auth, não do perfil: é com ele que a senha
  // confere.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || user.id !== perfil.id) return { erro: SEM_SESSAO };
  const email = user.email.toLowerCase();

  let service: Servico;
  try {
    service = createServiceClient();
  } catch {
    return {
      erro: "O servidor está sem a chave de serviço do Supabase. Avise a administração.",
    };
  }

  const ip = await ipDoCliente();
  const reserva = await reservarConferencia(service, email, ip);
  if (reserva.bloqueada) {
    registrarAcesso(perfil.id, "troca_senha_bloqueada", {
      ip,
      // A contagem junta e-mail e IP: não dá para dizer qual dos dois barrou.
      motivo: "muitas tentativas neste e-mail ou IP",
    });
    return { erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
  }

  const conferida = await conferirSenha(email, atual);
  if (conferida === "errada") {
    return { erros: { atual: "A senha atual não confere." } };
  }
  if (conferida === "falhou") {
    // Não foi palpite errado: a linha reservada não conta como falha.
    await apagarLinha(service, reserva.linha);
    return {
      erro: "Não deu para conferir a senha agora. Tente de novo em instantes.",
    };
  }

  // Senha atual certa: as falhas deste e-mail (e a linha reservada) saem.
  after(async () => {
    await service
      .from("login_tentativas")
      .delete()
      .eq("email", email)
      .then(
        () => {},
        () => {},
      );
  });

  const { error: erroSenha } = await service.auth.admin.updateUserById(
    perfil.id,
    { password: nova },
  );
  if (erroSenha) {
    console.error(`[conta] senha recusada: ${erroSenha.message}`);
    return erroSenha.code === "weak_password"
      ? {
          erros: {
            nova: "O servidor pediu uma senha mais forte. Misture letras, números e símbolos.",
          },
        }
      : { erro: `A senha não foi trocada: ${erroSenha.message}` };
  }

  registrarAcesso(perfil.id, "trocou_senha", { ip });
  const quando = new Date();
  after(async () => {
    try {
      await enviarAvisoSenhaTrocada(email, quando);
    } catch (erro) {
      console.error(
        "[conta] aviso de senha trocada não saiu:",
        erro instanceof Error ? erro.message : erro,
      );
    }
  });

  // A troca pelo admin encerra TODAS as sessões da pessoa no Auth, a deste
  // aparelho também (o UpdatePassword do supabase/auth sem sessão faz
  // Logout de tudo). Os outros aparelhos saem por isso; este entra de novo
  // com a senha nova, e os cookies da sessão nova saem nesta resposta.
  const { error: erroEntrada } = await supabase.auth.signInWithPassword({
    email,
    password: nova,
  });
  if (erroEntrada) {
    console.error(`[conta] sessão nova não abriu: ${erroEntrada.message}`);
    return { ok: "Senha trocada. Entre de novo com a senha nova." };
  }

  // Rede de segurança, se o Auth um dia deixar de derrubar as sessões na
  // troca: os outros aparelhos saem pela sessão nova, que fica.
  const { error: erroOutros } = await supabase.auth.signOut({
    scope: "others",
  });
  if (erroOutros) {
    console.error(`[conta] outros aparelhos: ${erroOutros.message}`);
  }

  return {
    ok: erroOutros
      ? "Senha trocada"
      : "Senha trocada. Os outros aparelhos saíram da conta.",
  };
}

/** Encerra as sessões dos outros aparelhos; este continua dentro. */
export async function sairDosOutrosAparelhos(
  _estado: ResultadoAcao,
  _formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await perfilAtivo();
  if (!perfil) return { erro: SEM_SESSAO };

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    return { erro: `Não deu para tirar os outros aparelhos: ${error.message}` };
  }

  registrarAcesso(perfil.id, "saiu_dos_outros_aparelhos");
  return { ok: "Só este aparelho continua na conta" };
}

/* ── A própria foto ───────────────────────────────────────────────────── */

/** O teto da foto que chega. A do navegador (256×256) fica em dezenas de KB. */
const FOTO_MAX_BYTES = 1024 * 1024;

const FOTO_SO_LEITURA =
  "No papel de compliance, a conta é só leitura. A foto que já existe pode sair.";
const FORMATO_RECUSADO =
  "A foto chegou num formato que o sistema não aceita. Escolha de novo.";
const SEM_CHAVE_SERVICO =
  "O servidor está sem a chave de serviço do Supabase. Avise a administração.";

/**
 * Grava a URL da foto (ou null, que apaga a chave) nos metadados do Auth da
 * própria pessoa, pela sessão dela. Os metadados não pedem o segundo fator
 * (o Supabase só exige aal2 para senha, e-mail e telefone), mas, se a sessão
 * for recusada, grava pelo admin: a pessoa já foi conferida pela sessão
 * (perfilAtivo), e o id é o dela. Devolve o erro, ou null.
 */
async function gravarFotoNaConta(
  id: string,
  url: string | null,
  service: Servico | null,
): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { foto_url: url },
  });
  if (!error) return null;
  console.error(`[conta] foto pela sessão recusada: ${error.message}`);
  if (!service) return error.message;
  const { error: erroAdmin } = await service.auth.admin.updateUserById(id, {
    user_metadata: { foto_url: url },
  });
  if (!erroAdmin) return null;
  console.error(`[conta] foto pelo admin recusada: ${erroAdmin.message}`);
  return erroAdmin.message;
}

/**
 * Põe ou troca a própria foto. O navegador já mandou a imagem cortada e
 * reduzida (256×256, WebP ou JPEG); aqui ela é conferida de novo (tamanho do
 * arquivo, formato e medida pelo conteúdo), sobe para o Storage pelo service
 * role (o arquivo vem pela action, com a sessão conferida) e a URL vai para
 * os metadados do Auth da própria pessoa (gravarFotoNaConta).
 *
 * A medida importa tanto quanto o peso: um WebP de 16.383×16.383 de cor lisa
 * tem poucos KB, e cada navegador da equipe que desenhasse o círculo de 32px
 * decodificaria perto de 1 GB. Só passa o quadrado de 256 que o navegador
 * manda; a chamada feita à mão com outra medida volta recusada.
 */
export async function salvarMinhaFoto(
  formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await perfilAtivo();
  if (!perfil) return { erro: SEM_SESSAO };
  if (perfil.papel === "compliance") return { erro: FOTO_SO_LEITURA };

  const arquivo = formData.get("foto");
  if (!(arquivo instanceof Blob) || arquivo.size === 0) {
    return { erro: "Escolha uma foto." };
  }
  if (arquivo.size > FOTO_MAX_BYTES) {
    return { erro: "A foto passou de 1 MB. Escolha outra imagem." };
  }
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const lida = lerFotoEquipe(bytes);
  if (
    !lida ||
    lida.largura !== LADO_FOTO_EQUIPE ||
    lida.altura !== LADO_FOTO_EQUIPE
  ) {
    return { erro: FORMATO_RECUSADO };
  }
  const formato = lida.formato;

  let service: Servico;
  try {
    service = createServiceClient();
  } catch {
    return { erro: SEM_CHAVE_SERVICO };
  }

  const carimbo = Date.now();
  const caminho = caminhoFotoEquipe(perfil.id, carimbo, formato);
  const url = urlFotoEquipe(caminho);
  if (!url) return { erro: "O servidor está sem o endereço do Supabase." };

  const { error: erroEnvio } = await service.storage
    .from(BUCKET_FOTOS)
    .upload(caminho, bytes, {
      contentType: formato === "webp" ? "image/webp" : "image/jpeg",
      // O endereço muda a cada troca (carimbo): o arquivo nunca muda.
      cacheControl: "31536000",
      upsert: false,
    });
  if (erroEnvio) {
    console.error(`[conta] foto não subiu: ${erroEnvio.message}`);
    return { erro: `A foto não subiu: ${erroEnvio.message}` };
  }

  const erroConta = await gravarFotoNaConta(perfil.id, url, service);
  if (erroConta) {
    // Subiu e não ficou na conta: o arquivo sai, para não sobrar no bucket.
    await service.storage
      .from(BUCKET_FOTOS)
      .remove([caminho])
      .then(
        () => {},
        () => {},
      );
    return { erro: `A foto não foi salva: ${erroConta}` };
  }

  after(() => apagarFotosDaPasta(service, perfil.id, carimbo));
  // O log lê "Ana trocou a própria foto · foto nova".
  registrarAcesso(perfil.id, "trocou_propria_foto", {
    mudancas: [{ campo: "foto", depois: "nova" }],
  });
  // A foto aparece no menu, na folha do "Mais" e na Equipe: o cache das
  // fotos expira já (quem salvou vê a foto nova na resposta) e as telas
  // releem.
  updateTag(TAG_FOTOS_EQUIPE);
  revalidatePath("/", "layout");
  return { ok: "Foto salva" };
}

/**
 * Tira a própria foto: a URL sai dos metadados e o arquivo, do bucket. A
 * equipe volta a ver as iniciais. Vale também para o compliance: tirar não
 * grava dado de negócio, e a foto de quem virou compliance depois de pôr a
 * dele não pode ficar sem caminho de saída (é imagem de uma pessoa).
 */
export async function tirarMinhaFoto(
  _estado: ResultadoAcao,
  _formData: FormData,
): Promise<ResultadoAcao> {
  const perfil = await perfilAtivo();
  if (!perfil) return { erro: SEM_SESSAO };

  // Sem a chave de serviço (a máquina local), a URL sai da conta pela
  // sessão e o arquivo fica no bucket.
  let service: Servico | null = null;
  try {
    service = createServiceClient();
  } catch {
    service = null;
  }

  // null apaga a chave dos metadados (o Auth não guarda a chave vazia).
  const erro = await gravarFotoNaConta(perfil.id, null, service);
  if (erro) return { erro: `A foto não foi removida: ${erro}` };

  if (service) {
    const comChave = service;
    after(() => apagarFotosDaPasta(comChave, perfil.id, null));
  }

  registrarAcesso(perfil.id, "trocou_propria_foto", {
    mudancas: [{ campo: "foto", depois: "removida" }],
  });
  updateTag(TAG_FOTOS_EQUIPE);
  revalidatePath("/", "layout");
  return { ok: "Foto removida" };
}
