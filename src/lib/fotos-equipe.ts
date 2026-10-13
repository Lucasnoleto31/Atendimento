import { cache } from "react";
import { unstable_cache } from "next/cache";
import { BUCKET_FOTOS } from "@/lib/avatar";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { unstable_rethrow } from "next/navigation";

/*
 * As fotos da equipe (servidor). Cada pessoa põe a própria em Minha conta: o
 * navegador corta e reduz a imagem, a action sobe para o Storage, no bucket
 * público da mídia (midia-whatsapp, pasta equipe/<id>/), e a URL fica nos
 * metadados do Auth da pessoa (user_metadata.foto_url). O banco não muda:
 * nem coluna em profiles, nem tabela nova.
 *
 * Os metadados do Auth a própria pessoa escreve pelo navegador, sem passar
 * pelo app (supabase.auth.updateUser). Por isso a URL só vale se apontar para
 * a pasta dela no nosso bucket, com o nome de arquivo que a action grava:
 * endereço de fora viraria uma imagem carregada no navegador de toda a
 * equipe.
 */

/** A tag do cache das fotos (fotosDaEquipe). Quem põe ou tira uma foto
 *  chama updateTag com ela. */
export const TAG_FOTOS_EQUIPE = "fotos-equipe";

/** O lado da foto gravada, em px. O navegador manda sempre este quadrado
 *  (form-foto.tsx, LADO), e o servidor só aceita ele. */
export const LADO_FOTO_EQUIPE = 256;

/** A pasta das fotos de uma pessoa dentro do bucket. */
export function pastaFotoEquipe(id: string): string {
  return `equipe/${id}`;
}

/**
 * O caminho de uma foto nova. O carimbo muda o endereço a cada troca: o
 * navegador não mostra a foto velha do cache, e o arquivo pode ficar em
 * cache por um ano.
 */
export function caminhoFotoEquipe(
  id: string,
  carimbo: number,
  extensao: "webp" | "jpg",
): string {
  return `${pastaFotoEquipe(id)}/${carimbo}.${extensao}`;
}

/** O carimbo do nome do arquivo ("1760000000000.webp"), ou null. */
export function carimboDaFoto(arquivo: string): number | null {
  const achado = /^(\d{1,16})\.(?:webp|jpg)$/.exec(arquivo);
  return achado ? Number(achado[1]) : null;
}

/** A URL pública de um caminho do bucket, montada sem consulta. */
export function urlFotoEquipe(caminho: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    return new URL(
      `/storage/v1/object/public/${BUCKET_FOTOS}/${caminho}`,
      base,
    ).href;
  } catch {
    return null;
  }
}

/**
 * A URL gravada nos metadados é uma foto nossa, da pasta da própria pessoa?
 * Devolve a URL conferida ou null. Compara origem e caminho já normalizados
 * pelo parser (o "../" e o "%2e%2e" somem antes da comparação) e exige o
 * nome exato que a action grava: carimbo e extensão, nada mais.
 */
export function fotoValidaDa(id: string, valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length > 600) return null;
  if (valor.includes("..") || valor.includes("\\")) return null;
  const pasta = urlFotoEquipe(`${pastaFotoEquipe(id)}/`);
  if (!pasta) return null;
  let url: URL;
  let raiz: URL;
  try {
    url = new URL(valor);
    raiz = new URL(pasta);
  } catch {
    return null;
  }
  if (
    url.origin !== raiz.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(raiz.pathname)
  ) {
    return null;
  }
  const arquivo = url.pathname.slice(raiz.pathname.length);
  return carimboDaFoto(arquivo) === null ? null : url.href;
}

/* ── O arquivo da foto: formato e medida pelo conteúdo ────────────────── */

/** O que o cabeçalho do arquivo diz da foto. */
export type FotoLida = {
  formato: "webp" | "jpg";
  largura: number;
  altura: number;
};

type Medida = { largura: number; altura: number };

function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

function u24le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

/** Sem o "<<" no último byte: passaria de 31 bits e viraria negativo. */
function u32le(b: Uint8Array, i: number): number {
  return u24le(b, i) + b[i + 3] * 0x1000000;
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1];
}

function quatroLetras(b: Uint8Array, i: number): string {
  return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
}

/**
 * A medida de um WebP, pelos blocos do RIFF: o VP8X (a tela do arquivo), o
 * "VP8 " (com perda) e o VP8L (sem perda). Todo bloco de imagem achado
 * precisa dar a mesma medida, e tem de haver um. Animação (a flag do VP8X,
 * o ANIM ou o ANMF) fica de fora: a foto da equipe é uma imagem parada.
 * Bloco que passa do fim do arquivo também: o arquivo veio cortado.
 */
function medidaDoWebp(b: Uint8Array): Medida | null {
  let medida: Medida | null = null;
  let temImagem = false;
  let i = 12;
  while (i + 8 <= b.length) {
    const tipo = quatroLetras(b, i);
    const tamanho = u32le(b, i + 4);
    const dados = i + 8;
    if (dados + tamanho > b.length) return null;
    let achada: Medida | null = null;
    if (tipo === "VP8X") {
      if (tamanho < 10 || b[dados] & 0x02) return null;
      achada = {
        largura: 1 + u24le(b, dados + 4),
        altura: 1 + u24le(b, dados + 7),
      };
    } else if (tipo === "VP8 ") {
      // Quadro-chave (bit 0 zerado) e o código de início 9D 01 2A; a medida
      // são os 14 bits de baixo de cada um dos dois números seguintes.
      if (
        tamanho < 10 ||
        b[dados] & 0x01 ||
        b[dados + 3] !== 0x9d ||
        b[dados + 4] !== 0x01 ||
        b[dados + 5] !== 0x2a
      ) {
        return null;
      }
      achada = {
        largura: u16le(b, dados + 6) & 0x3fff,
        altura: u16le(b, dados + 8) & 0x3fff,
      };
      temImagem = true;
    } else if (tipo === "VP8L") {
      // A assinatura 0x2F e, nos 28 bits seguintes, largura e altura menos 1.
      if (tamanho < 5 || b[dados] !== 0x2f) return null;
      const bits = u32le(b, dados + 1);
      achada = {
        largura: (bits & 0x3fff) + 1,
        altura: ((bits >>> 14) & 0x3fff) + 1,
      };
      temImagem = true;
    } else if (tipo === "ANIM" || tipo === "ANMF") {
      return null;
    }
    if (achada) {
      if (
        medida &&
        (medida.largura !== achada.largura || medida.altura !== achada.altura)
      ) {
        return null;
      }
      medida = achada;
    }
    // O bloco de tamanho ímpar leva um byte de enchimento.
    i = dados + tamanho + (tamanho & 1);
  }
  return temImagem ? medida : null;
}

/**
 * A medida de um JPEG, pelo primeiro SOF: anda de segmento em segmento
 * (cada um diz o próprio tamanho) até o quadro. Só os três que o canvas e
 * as câmeras geram: SOF0 (o comum), SOF1 e SOF2 (o progressivo). Os dados
 * da imagem (SOS) ou o fim (EOI) antes do quadro: arquivo que não se lê.
 */
function medidaDoJpeg(b: Uint8Array): Medida | null {
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    // FF repetido é enchimento antes do marcador.
    while (b[i + 1] === 0xff && i + 2 < b.length) i++;
    const marcador = b[i + 1];
    i += 2;
    // Marcadores sem tamanho: SOI, TEM e os RST.
    if (
      marcador === 0xd8 ||
      marcador === 0x01 ||
      (marcador >= 0xd0 && marcador <= 0xd7)
    ) {
      continue;
    }
    if (marcador === 0xd9 || marcador === 0xda) return null;
    if (i + 2 > b.length) return null;
    const tamanho = u16be(b, i);
    if (tamanho < 2 || i + tamanho > b.length) return null;
    const quadro =
      marcador >= 0xc0 &&
      marcador <= 0xcf &&
      marcador !== 0xc4 &&
      marcador !== 0xc8 &&
      marcador !== 0xcc;
    if (quadro) {
      // Tamanho (2), precisão (1), altura (2), largura (2), componentes (1).
      if (marcador > 0xc2 || tamanho < 8) return null;
      return { altura: u16be(b, i + 3), largura: u16be(b, i + 5) };
    }
    i += tamanho;
  }
  return null;
}

/**
 * O formato e a medida da foto pelo conteúdo, não pelo nome nem pelo tipo
 * que o navegador declara: WebP ("RIFF" … "WEBP") ou JPEG (FF D8 FF). O
 * JPEG vem do navegador cujo canvas não gera WebP (o Safari). null quando o
 * arquivo não é nenhum dos dois ou o cabeçalho não se lê.
 */
export function lerFotoEquipe(b: Uint8Array): FotoLida | null {
  if (
    b.length >= 12 &&
    quatroLetras(b, 0) === "RIFF" &&
    quatroLetras(b, 8) === "WEBP"
  ) {
    const medida = medidaDoWebp(b);
    return medida ? { formato: "webp", ...medida } : null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const medida = medidaDoJpeg(b);
    return medida ? { formato: "jpg", ...medida } : null;
  }
  return null;
}

/* ── Arquivos no bucket ───────────────────────────────────────────────── */

type Servico = ReturnType<typeof createServiceClient>;

/**
 * Apaga da pasta da pessoa as fotos que ficaram para trás: as anteriores à
 * nova (pelo carimbo do nome) ou, sem foto nova, todas. Pelo carimbo, e não
 * "tudo menos a nova": duas trocas quase juntas (dois aparelhos) não apagam
 * a foto uma da outra. Feita para rodar depois da resposta (after); a falha
 * vai só para o log do servidor (o que sobra é arquivo esquecido no bucket,
 * não foto errada).
 */
export async function apagarFotosDaPasta(
  service: Servico,
  id: string,
  nova: number | null,
): Promise<void> {
  try {
    const pasta = pastaFotoEquipe(id);
    const { data, error } = await service.storage
      .from(BUCKET_FOTOS)
      .list(pasta, { limit: 100 });
    if (error || !data) return;
    const velhas = data
      .filter((f) => {
        const carimbo = carimboDaFoto(f.name);
        return nova === null || (carimbo !== null && carimbo < nova);
      })
      .map((f) => `${pasta}/${f.name}`);
    if (velhas.length > 0) {
      await service.storage.from(BUCKET_FOTOS).remove(velhas);
    }
  } catch (erro) {
    console.error(
      "[fotos-equipe] fotos antigas ficaram no bucket:",
      erro instanceof Error ? erro.message : erro,
    );
  }
}

/* ── Leitura ──────────────────────────────────────────────────────────── */

/** Quantas pessoas o Auth devolve por página, e até quantas páginas lê. */
const POR_PAGINA = 200;
const MAX_PAGINAS = 10;

/** Rede de segurança do cache: quem muda os metadados fora do app (pelo
 *  navegador, direto no Auth) aparece em até uma hora. */
const VALIDADE_CACHE_S = 60 * 60;

/**
 * Lê as fotos nos metadados do Auth, com o service client. Erro sobe (e não
 * vira objeto vazio aqui dentro): o unstable_cache não guarda o que falhou,
 * e a próxima tela tenta de novo.
 */
async function lerFotosDoAuth(): Promise<Record<string, string>> {
  const service = createServiceClient();
  const fotos: Record<string, string> = {};
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const { data, error } = await service.auth.admin.listUsers({
      page: pagina,
      perPage: POR_PAGINA,
    });
    if (error) throw error;
    for (const pessoa of data.users) {
      const url = fotoValidaDa(pessoa.id, pessoa.user_metadata?.foto_url);
      if (url) fotos[pessoa.id] = url;
    }
    if (data.users.length < POR_PAGINA) break;
  }
  return fotos;
}

/** A leitura guardada entre requests. Só o mapa de quem tem foto vai para
 *  o cache, nunca a lista de usuários do Auth. */
const fotosEmCache = unstable_cache(lerFotosDoAuth, ["fotos-equipe-v1"], {
  tags: [TAG_FOTOS_EQUIPE],
  revalidate: VALIDADE_CACHE_S,
});

/**
 * As fotos da equipe: id do perfil (o mesmo id do Auth) para a URL pública
 * da foto, só de quem tem foto. A lista fica no cache do Next entre
 * requests (a tag TAG_FOTOS_EQUIPE, que salvar e tirar foto invalidam): o
 * menu de toda tela lê daqui sem ir ao Auth a cada navegação. O cache() do
 * React junta as chamadas do mesmo request. Qualquer falha (sem a chave de
 * serviço, como na máquina local, ou o Auth fora) devolve o objeto vazio, e
 * a tela mostra as iniciais.
 */
let avisouFalha = false;

export const fotosDaEquipe = cache(
  async (): Promise<Record<string, string>> => {
    // Sem a chave (ou com o texto provisório do .env.local de quem ainda
    // não colou a chave), nem tenta: na máquina local seria um erro por tela.
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!chave || chave.startsWith("COLE")) return {};
    try {
      return await fotosEmCache();
    } catch (erro) {
      unstable_rethrow(erro);
      // Uma vez por processo: a falha se repetiria em toda tela.
      if (!avisouFalha) {
        avisouFalha = true;
        console.warn(
          "[fotos-equipe] leitura das fotos falhou:",
          erro instanceof Error ? erro.message : erro,
        );
      }
      return {};
    }
  },
);

/**
 * A foto de quem está logado, lida pela sessão (getUser, que vai ao Auth e
 * traz os metadados de agora). Para Minha conta: não precisa da chave de
 * serviço, então a foto aparece também na máquina local, e não lê a equipe
 * inteira para achar uma pessoa. Devolve o id junto, para a página conferir
 * que é o mesmo do perfil.
 */
export async function fotoDaSessao(): Promise<{
  id: string;
  foto: string | null;
} | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return { id: user.id, foto: fotoValidaDa(user.id, user.user_metadata?.foto_url) };
  } catch (erro) {
    // O Next marca a rota como dinâmica por uma exceção dele (cookies() no
    // build): ela tem de seguir, senão vira um "erro" no log e a marca some.
    unstable_rethrow(erro);
    console.error(
      "[fotos-equipe] foto da sessão não leu:",
      erro instanceof Error ? erro.message : erro,
    );
    return null;
  }
}
