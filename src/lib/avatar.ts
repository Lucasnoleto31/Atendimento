/**
 * O avatar do contato: cor e iniciais para quem não tem foto, e o endereço da
 * foto do perfil do Instagram guardada no Storage.
 *
 * Arquivo puro, sem import de servidor: a tela monta a URL e o webhook grava
 * no mesmo caminho, e nenhum dos dois consulta o banco para isso.
 */

/** O bucket público da mídia das conversas; as fotos ficam numa pasta dele. */
export const BUCKET_FOTOS = "midia-whatsapp";

/**
 * Um arquivo por contato, sempre no mesmo caminho: a foto renovada
 * sobrescreve a anterior e o endereço não muda, por isso não precisa de
 * coluna no banco.
 */
export function caminhoFotoContato(leadId: string): string {
  return `avatares/${leadId}.jpg`;
}

/**
 * O contato tem foto guardada? Tem quem chegou pelo Direct: o webhook copia a
 * foto de todo contato que ele acha pelo IGSID (instagram_id), com @ ou sem
 * (a leitura do perfil pode ter falhado na entrada). O @ e a entrada
 * "webhook_instagram" só existem em quem tem IGSID, por isso servem à tela
 * que não lê a coluna. É o critério de todas as telas: fila, cabeçalho,
 * painel, lista de contatos e ficha.
 *
 * Telefone vazio sozinho não serve: o cadastro manual aceita contato sem
 * telefone, e cada um desses viraria um pedido que volta 404.
 */
export function veioPeloDirect(c: {
  instagramId?: string | null;
  instagramUsuario?: string | null;
  entradaMotivo?: string | null;
}): boolean {
  return (
    Boolean(c.instagramId) ||
    Boolean(c.instagramUsuario) ||
    c.entradaMotivo === "webhook_instagram"
  );
}

/** URL pública da foto, montada sem consulta. null sem a URL do Supabase. */
export function urlFotoContato(leadId: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !leadId) return null;
  const raiz = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${raiz}/storage/v1/object/public/${BUCKET_FOTOS}/${caminhoFotoContato(encodeURIComponent(leadId))}`;
}

/**
 * Tom fixo por nome: a mesma pessoa tem o mesmo tom em toda tela. Na ficha
 * padrão (monocromática) são quatro cinzas, com as iniciais na tinta; os
 * valores mudam com o tema e moram no globals.css (--color-avatar-1 a 4).
 * Quatro cinzas e não dez matizes: cor por pessoa em cada linha da fila seria
 * o "selo colorido" que a direção recusa, e o estado (não lida, sem dono) é
 * quem tem de pesar na linha.
 */
const PALETA_AVATAR = [
  "var(--color-avatar-1)",
  "var(--color-avatar-2)",
  "var(--color-avatar-3)",
  "var(--color-avatar-4)",
];

export function corDoAvatar(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return PALETA_AVATAR[h % PALETA_AVATAR.length];
}

/**
 * Duas iniciais, das duas primeiras palavras. Pontuação e símbolo não são
 * inicial: "Rafael (Direct)" dá "RD", e não "R(", e "@ana" ou um emoji na
 * frente do nome não viram letra. A palavra só de símbolos sai da conta.
 */
export function iniciaisDoNome(nome: string): string {
  const palavras = nome
    .normalize("NFC")
    .split(/\s+/)
    .map((p) => p.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
  // Array.from e não [0]: letra fora do plano básico tem duas metades.
  const inicial = (p: string | undefined) => (p ? Array.from(p)[0] : "");
  return (inicial(palavras[0]) + inicial(palavras[1])).toUpperCase() || "?";
}
