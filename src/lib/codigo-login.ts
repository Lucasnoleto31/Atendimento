/**
 * Código de acesso por e-mail e aparelho lembrado: as peças puras.
 *
 * Só Web Crypto (crypto.subtle, getRandomValues, btoa/atob): o middleware
 * importa daqui e roda no runtime edge, onde não existe node:crypto nem
 * Buffer. Nada de banco nem de cookies() aqui; quem grava e lê os cookies
 * são as actions de /entrar e o middleware.
 *
 * Os dois cookies são assinados com HMAC-SHA256 de CODIGO_LOGIN_SEGREDO e
 * conferidos aqui. Nenhum deles carrega o código em claro: o pendente leva
 * só o HMAC do código, que sem o segredo não dá para inverter nem testar
 * fora do servidor. Trocar o segredo derruba todos de uma vez (todo aparelho
 * pede código de novo), que é a forma de revogar em massa.
 */

export const COOKIE_APARELHO = "za_aparelho";
export const COOKIE_CODIGO = "za_codigo";

export const APARELHO_VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;
export const CODIGO_VALIDADE_MS = 10 * 60 * 1000;
/** Espera mínima entre dois envios de código para a mesma pessoa. */
export const REENVIO_MS = 60 * 1000;
export const DIGITOS_CODIGO = 6;

/** Aparelho que já confirmou o código para esta pessoa. */
export type Aparelho = { uid: string; exp: number };

/** Código mandado e ainda não digitado. `hash` é o HMAC, nunca o código. */
export type CodigoPendente = {
  uid: string;
  email: string;
  exp: number;
  hash: string;
  enviadoEm: number;
};

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

let avisouSegredoCurto = false;

function segredo(): string {
  const valor = process.env.CODIGO_LOGIN_SEGREDO ?? "";
  if (!valor) {
    throw new Error(
      "CODIGO_LOGIN_SEGREDO não configurado no servidor (veja docs/SETUP.md).",
    );
  }
  if (valor.length < 32) {
    // Segredo curto vira chave que dá para adivinhar. Em produção não sobe;
    // na máquina de desenvolvimento só avisa, uma vez por processo.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CODIGO_LOGIN_SEGREDO curto demais: use 32 caracteres ou mais (veja docs/SETUP.md).",
      );
    }
    if (!avisouSegredoCurto) {
      avisouSegredoCurto = true;
      console.warn(
        "[codigo-login] CODIGO_LOGIN_SEGREDO tem menos de 32 caracteres. Em produção isso trava o login.",
      );
    }
  }
  return valor;
}

let chaveEmCache: { segredo: string; chave: Promise<CryptoKey> } | null = null;

/**
 * A chave importada fica em memória por processo: o middleware confere o
 * cookie do aparelho em toda requisição e importKey não é de graça. Se o
 * segredo mudar (deploy novo), a chave é refeita.
 */
function chave(): Promise<CryptoKey> {
  const atual = segredo();
  if (chaveEmCache?.segredo !== atual) {
    chaveEmCache = {
      segredo: atual,
      chave: crypto.subtle.importKey(
        "raw",
        codificador.encode(atual),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      ),
    };
  }
  return chaveEmCache.chave;
}

function paraBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function deBase64Url(texto: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  const preenchido =
    texto.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((texto.length + 3) % 4);
  try {
    const binario = atob(preenchido);
    const bytes = new Uint8Array(new ArrayBuffer(binario.length));
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmac(dados: string): Promise<string> {
  const assinatura = await crypto.subtle.sign(
    "HMAC",
    await chave(),
    codificador.encode(dados),
  );
  return paraBase64Url(new Uint8Array(assinatura));
}

/**
 * crypto.subtle.verify compara em tempo constante: quem martela o cookie não
 * aprende nada com o tempo de resposta.
 */
async function hmacConfere(dados: string, assinaturaB64: string): Promise<boolean> {
  const assinatura = deBase64Url(assinaturaB64);
  if (!assinatura) return false;
  return crypto.subtle.verify(
    "HMAC",
    await chave(),
    assinatura,
    codificador.encode(dados),
  );
}

/**
 * Valor de cookie: payload em base64url + "." + HMAC. O nome do cookie entra
 * no que é assinado, então um valor válido de um não serve no outro.
 */
async function assinar(nome: string, payload: object): Promise<string> {
  const corpo = paraBase64Url(codificador.encode(JSON.stringify(payload)));
  return `${corpo}.${await hmac(`${nome}.${corpo}`)}`;
}

async function abrir(nome: string, valor: string | undefined): Promise<unknown> {
  if (!valor || valor.length > 2048) return null;
  const [corpo, assinatura, sobra] = valor.split(".");
  if (!corpo || !assinatura || sobra !== undefined) return null;
  if (!(await hmacConfere(`${nome}.${corpo}`, assinatura))) return null;
  const bytes = deBase64Url(corpo);
  if (!bytes) return null;
  try {
    return JSON.parse(decodificador.decode(bytes));
  } catch {
    return null;
  }
}

/** Código de 6 dígitos sem viés de módulo (descarta o sorteio que cairia na sobra). */
export function gerarCodigo(): string {
  const faixa = 10 ** DIGITOS_CODIGO;
  const teto = Math.floor(0x1_0000_0000 / faixa) * faixa;
  const sorteio = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(sorteio);
    if (sorteio[0] < teto) {
      return String(sorteio[0] % faixa).padStart(DIGITOS_CODIGO, "0");
    }
  }
}

/**
 * O que a pessoa digitou, só com os dígitos. Copiar do e-mail ou do celular
 * traz espaço e hífen junto ("123 456", "123-456"); isso sai. Letra ou
 * tamanho fora da faixa devolve null.
 */
export function normalizarCodigo(
  bruto: unknown,
  digitos: { min: number; max: number } = {
    min: DIGITOS_CODIGO,
    max: DIGITOS_CODIGO,
  },
): string | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto.replace(/[\s\-‐-―−]/g, "");
  if (!/^\d+$/.test(limpo)) return null;
  if (limpo.length < digitos.min || limpo.length > digitos.max) return null;
  return limpo;
}

function hashDoCodigo(uid: string, enviadoEm: number, codigo: string): string {
  return `codigo.${uid}.${enviadoEm}.${codigo}`;
}

export async function assinarAparelho(
  uid: string,
  agora: number = Date.now(),
): Promise<string> {
  const aparelho: Aparelho = { uid, exp: agora + APARELHO_VALIDADE_MS };
  return assinar(COOKIE_APARELHO, aparelho);
}

/**
 * O aparelho já confirmou o código para ESTE usuário e o prazo não venceu.
 * Qualquer falha (sem segredo, cookie adulterado, outro uid) é "não".
 */
export async function aparelhoConfirmado(
  valor: string | undefined,
  uid: string,
  agora: number = Date.now(),
): Promise<boolean> {
  try {
    const dados = (await abrir(COOKIE_APARELHO, valor)) as Partial<Aparelho> | null;
    return (
      dados?.uid === uid && typeof dados.exp === "number" && dados.exp > agora
    );
  } catch {
    return false;
  }
}

export async function assinarCodigoPendente(dados: {
  uid: string;
  email: string;
  codigo: string;
  agora?: number;
}): Promise<string> {
  const enviadoEm = dados.agora ?? Date.now();
  const pendente: CodigoPendente = {
    uid: dados.uid,
    email: dados.email,
    exp: enviadoEm + CODIGO_VALIDADE_MS,
    hash: await hmac(hashDoCodigo(dados.uid, enviadoEm, dados.codigo)),
    enviadoEm,
  };
  return assinar(COOKIE_CODIGO, pendente);
}

/**
 * O código pendente deste usuário, se a assinatura confere e o prazo não
 * venceu. Vencido ou de outra conta conta como ausente.
 */
export async function lerCodigoPendente(
  valor: string | undefined,
  uid: string,
  agora: number = Date.now(),
): Promise<CodigoPendente | null> {
  let dados: Partial<CodigoPendente> | null;
  try {
    dados = (await abrir(COOKIE_CODIGO, valor)) as Partial<CodigoPendente> | null;
  } catch {
    return null;
  }
  if (
    !dados ||
    dados.uid !== uid ||
    typeof dados.email !== "string" ||
    typeof dados.hash !== "string" ||
    typeof dados.exp !== "number" ||
    typeof dados.enviadoEm !== "number" ||
    dados.exp <= agora
  ) {
    return null;
  }
  return dados as CodigoPendente;
}

export async function codigoConfere(
  pendente: CodigoPendente,
  codigo: string,
): Promise<boolean> {
  return hmacConfere(
    hashDoCodigo(pendente.uid, pendente.enviadoEm, codigo),
    pendente.hash,
  );
}

/**
 * Quanto falta, em ms, para poder pedir outro código. Medido só no relógio
 * do servidor: a tela recebe o número pronto e conta a partir de quando ele
 * chegou, sem comparar o relógio do aparelho com o do servidor (aparelho
 * atrasado mostrava "Reenviar em 660 s"). Nunca passa de REENVIO_MS, nem
 * com um enviadoEm no futuro por relógio diferente entre servidores.
 */
export function restanteParaReenvio(
  pendente: CodigoPendente | null,
  agora: number = Date.now(),
): number {
  if (!pendente) return 0;
  return Math.min(
    REENVIO_MS,
    Math.max(0, pendente.enviadoEm + REENVIO_MS - agora),
  );
}

/** Opções dos dois cookies: só o servidor lê, e só por HTTPS em produção. */
export function opcoesCookie(validadeMs: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(validadeMs / 1000),
  };
}
