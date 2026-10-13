import {
  ATALHOS_PERIODO,
  ehDataFila,
  escreverEtiquetasNaUrl,
  intervaloDoPeriodo,
  lerEtiquetasDaUrl,
  type AtalhoPeriodo,
  type ModoEtiquetas,
} from "@/app/(app)/chat/mensagem";

/**
 * Filtros da lista de contatos: busca, período (da última interação ou do
 * cadastro), etiquetas, responsáveis, campanha e canal. A página, o CSV
 * (api/exportar/contatos) e o alcance da seleção em massa leem daqui, para o
 * arquivo e a ação levarem exatamente o que a tela mostra.
 *
 * O jeito é o do filtro da fila do chat (chat/mensagem.ts e
 * conversas/lista.ts): escolha múltipla em etiquetas e responsáveis (o
 * contato entra com qualquer um), campanha por campanha_envios sem erro, os
 * mesmos atalhos de período e os mesmos tetos de ids. Nas etiquetas, o
 * contrato da fila na URL, pelas mesmas funções (lerEtiquetasDaUrl e
 * escreverEtiquetasNaUrl, em chat/mensagem.ts): semEtiqueta=1 (só quem não
 * tem etiqueta nenhuma) e etiquetasModo=todas (o contato precisa ter cada
 * uma; ausente, vale qualquer uma), este só com etiqueta marcada.
 *
 * Tudo roda na tabela leads, sem view: o RLS já recorta o que cada papel
 * enxerga, e a consulta fica numa ida só.
 */

export type CanalContato = "whatsapp" | "instagram";

/** Qual data o período olha. */
export type CampoData = "interacao" | "cadastro";

/** Como as etiquetas marcadas se somam: o mesmo tipo da fila. */
export type { ModoEtiquetas };

export type FiltrosContatos = {
  busca: string;
  /** ids das etiquetas, somadas pelo `etiquetasModo`. [] = sem filtro. */
  etiquetas: string[];
  /** "qualquer": o contato entra com uma das etiquetas; "todas": precisa
   *  ter cada uma. Só pesa com etiqueta marcada, e a URL só o leva nesse
   *  caso, como na fila: sem etiqueta marcada, a escolha fica na tela
   *  (filtros-lista.tsx) e vale para as próximas marcadas. */
  etiquetasModo: ModoEtiquetas;
  /** Só quem não tem etiqueta nenhuma. Exclusivo: com ele, `etiquetas`
   *  vem vazio. */
  semEtiqueta: boolean;
  /** ids dos responsáveis e, para quem não tem dono, SEM_DONO. [] = todos. */
  responsaveis: string[];
  /** Quem recebeu esta campanha (campanha_envios sem erro), ou "". */
  campanha: string;
  /** Tem WhatsApp (telefone) ou tem Instagram (@ ou IGSID), ou "". */
  canal: CanalContato | "";
  /** A data do período. Sem período, sempre "interacao". */
  data: CampoData;
  /** Começo do período: "hoje", "7d", "30d" ou AAAA-MM-DD; "" sem período. */
  de: string;
  /** Último dia (inclusive), AAAA-MM-DD, ou "". Com `de` num atalho, não
   *  vale: o atalho já vai até agora. */
  ate: string;
};

export const FILTROS_VAZIOS: FiltrosContatos = {
  busca: "",
  etiquetas: [],
  etiquetasModo: "qualquer",
  semEtiqueta: false,
  responsaveis: [],
  campanha: "",
  canal: "",
  data: "interacao",
  de: "",
  ate: "",
};

/** O valor de `responsaveis` que quer dizer "sem dono" (o mesmo "sem" dos
 *  links de antes da escolha múltipla). */
export const SEM_DONO = "sem";

/**
 * Teto de ids por lista (etiquetas, responsáveis): o mesmo da fila. Cada id
 * ocupa 37 caracteres da URL, e o menu do filtro não deixa marcar além dele.
 */
export const MAX_IDS_FILTRO = 30;

/** As campanhas que o filtro oferece, da mais recente para trás (o mesmo
 *  teto da fila). */
export const MAX_CAMPANHAS = 50;

/**
 * A data mais antiga que o período aceita. Digitar o ano no campo de data
 * passa por 0002, 0020 e 0202, que são datas válidas: sem este piso, cada
 * tecla recarregava a lista.
 */
export const DATA_MINIMA = "2020-01-01";

/** Id de linha do banco. A seleção em massa (selecao.ts) usa o mesmo. */
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(valor: unknown): string {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return typeof bruto === "string" ? bruto.trim() : "";
}

/** "a,b,c" (ou o parâmetro repetido) em lista, sem vazio nem repetido. */
function varios(valor: unknown): string[] {
  const brutos = Array.isArray(valor) ? valor : [valor];
  return [
    ...new Set(
      brutos
        .filter((v): v is string => typeof v === "string")
        .flatMap((v) => v.split(","))
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** Ordem fixa: a mesma escolha feita em outra ordem dá a mesma URL, e o
 *  corte no teto tira sempre os mesmos. */
function ordenados(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

export function ehAtalhoPeriodo(valor: string): valor is AtalhoPeriodo {
  return (ATALHOS_PERIODO as readonly string[]).includes(valor);
}

/** Data que o período aceita: existe no calendário e não é anterior ao piso. */
export function ehDataDoPeriodo(valor: unknown): valor is string {
  return ehDataFila(valor) && valor >= DATA_MINIMA;
}

/**
 * Lê os filtros da URL. Valor torto vira "sem filtro": id que não é uuid
 * faria o PostgREST devolver erro em vez de lista. Os nomes de antes da
 * escolha múltipla (?etiqueta= e ?responsavel=, de link guardado num
 * ?voltar=) entram nas listas.
 */
export function lerFiltros(
  params: Record<string, string | string[] | undefined>,
): FiltrosContatos {
  const etiquetas = ordenados(
    [...varios(params.etiquetas), ...varios(params.etiqueta)].filter((id) =>
      UUID.test(id),
    ),
  ).slice(0, MAX_IDS_FILTRO);
  const responsaveis = ordenados(
    [...varios(params.responsaveis), ...varios(params.responsavel)].filter(
      (id) => id === SEM_DONO || UUID.test(id),
    ),
  ).slice(0, MAX_IDS_FILTRO);
  const campanha = texto(params.campanha).toLowerCase();
  const canal = texto(params.canal);
  // "Sem etiqueta" e etiquetas não andam juntos: no link montado à mão com
  // os dois, vale o "Sem etiqueta". A leitura é a da fila.
  const { semEtiqueta, etiquetasModo } = lerEtiquetasDaUrl(params);

  // O período: atalho ou data; a data final só com data (o atalho já vai
  // até agora). Invertidas, as duas trocam de lugar.
  const deBruto = texto(params.de);
  const ateBruto = texto(params.ate);
  let de =
    ehAtalhoPeriodo(deBruto) || ehDataDoPeriodo(deBruto) ? deBruto : "";
  let ate = !ehAtalhoPeriodo(de) && ehDataDoPeriodo(ateBruto) ? ateBruto : "";
  if (de && ate && de > ate) [de, ate] = [ate, de];

  return {
    busca: texto(params.busca).slice(0, 120),
    etiquetas: semEtiqueta ? [] : etiquetas,
    etiquetasModo,
    semEtiqueta,
    responsaveis,
    campanha: UUID.test(campanha) ? campanha : "",
    canal: canal === "whatsapp" || canal === "instagram" ? canal : "",
    // A data só quer dizer algo com período: sem ele, volta ao padrão e a
    // URL fica a mesma.
    data:
      (de || ate) && texto(params.data) === "cadastro" ? "cadastro" : "interacao",
    de,
    ate,
  };
}

/**
 * Quantos filtros estão ligados: um por etiqueta e responsável escolhidos,
 * mais "Sem etiqueta", período, campanha e canal. Com algum, a barra mostra
 * o "Limpar filtros". A busca tem o campo dela e não conta, nem o modo das
 * etiquetas sozinho (sem etiqueta marcada, ele não muda a lista).
 */
export function contarFiltros(f: FiltrosContatos): number {
  return (
    f.etiquetas.length +
    (f.semEtiqueta ? 1 : 0) +
    f.responsaveis.length +
    (f.campanha ? 1 : 0) +
    (f.canal ? 1 : 0) +
    (f.de || f.ate ? 1 : 0)
  );
}

/** Algum filtro ou busca ligado? */
export function temFiltro(f: FiltrosContatos): boolean {
  return Boolean(f.busca) || contarFiltros(f) > 0;
}

/** As etiquetas do filtro que são uuid, com a do link de antes da escolha
 *  múltipla. selectComFiltros e aplicarFiltros contam com a mesma lista, na
 *  mesma ordem: no modo "todas", o apelido de cada embed é a posição. */
function etiquetasDoFiltro(f: FiltrosAplicaveis): string[] {
  if (f.semEtiqueta) return [];
  return [...(f.etiquetas ?? []), ...(f.etiqueta ? [f.etiqueta] : [])].filter(
    (id) => UUID.test(id),
  );
}

/** "Todas" só muda a consulta com duas ou mais: com uma, é a mesma lista. */
function exigeTodas(f: FiltrosAplicaveis, etiquetas: string[]): boolean {
  return f.etiquetasModo === "todas" && etiquetas.length > 1;
}

/**
 * O pedaço do select que os filtros por vínculo exigem. Etiqueta e campanha
 * filtram por um embed com !inner, com apelido próprio (f_*): o embed que a
 * tela mostra continua trazendo TODAS as etiquetas do contato, não só as
 * filtradas.
 *
 * Etiquetas no modo "todas": um embed !inner por etiqueta (f_etiqueta_0,
 * f_etiqueta_1…), cada um preso a uma delas, e o contato só passa se casar
 * com todos. "Sem etiqueta": o embed sem !inner e o filtro is.null nele, o
 * contato sem linha nenhuma em lead_tags. Os dois sem colunas (o "()"
 * vazio): servem só ao filtro e não pesam na resposta.
 */
export function selectComFiltros(colunas: string, f: FiltrosContatos): string {
  const embutidos: string[] = [];
  const etiquetas = etiquetasDoFiltro(f);
  if (f.semEtiqueta) {
    embutidos.push("f_sem_etiqueta:lead_tags()");
  } else if (exigeTodas(f, etiquetas)) {
    etiquetas.forEach((_, i) => {
      embutidos.push(`f_etiqueta_${i}:lead_tags!inner()`);
    });
  } else if (etiquetas.length > 0) {
    embutidos.push("f_etiquetas:lead_tags!inner(tag_id)");
  }
  if (f.campanha) {
    embutidos.push("f_campanha:campanha_envios!inner(campanha_id)");
  }
  return [colunas, ...embutidos].join(", ");
}

/** As letras que aceitam acento, com as variantes (maiúsculas incluídas: o
 *  ~* do Postgres só ignora a caixa com certeza no ASCII). */
const VARIANTES: Record<string, string> = {
  a: "aáàâãäAÁÀÂÃÄ",
  e: "eéèêëEÉÈÊË",
  i: "iíìîïIÍÌÎÏ",
  o: "oóòôõöOÓÒÔÕÖ",
  u: "uúùûüUÚÙÛÜ",
  c: "cçCÇ",
  n: "nñNÑ",
};

/**
 * O termo da busca como expressão regular do Postgres que casa o nome com
 * ou sem acento: "joao" e "joão" viram j[oóòôõö…][aáàâãä…][oóòôõö…], e
 * acham "João" e "Joao". Sem mudar o banco (unaccent pediria extensão).
 *
 * O caractere que é sintaxe de regex vai entre colchetes, onde vale como
 * ele mesmo. Os que nem assim são seguros dentro das aspas do .or() (aspas,
 * barra invertida, circunflexo e colchetes) viram "." (qualquer um): nome
 * quase nunca os tem, e a busca continua achando quem tem.
 */
export function padraoSemAcento(termo: string): string {
  let padrao = "";
  for (const letra of termo) {
    const base = letra
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    const variantes = VARIANTES[base];
    if (variantes) padrao += `[${variantes}]`;
    else if (/[.*+?$|{}]/.test(letra)) padrao += `[${letra}]`;
    else if (/["\\^[\]]/.test(letra)) padrao += ".";
    else padrao += letra;
  }
  return padrao;
}

/**
 * O que aplicarFiltros aceita: os filtros inteiros, ou só a busca. A busca
 * única (busca/actions.ts) passa a busca com os dois campos de antes da
 * escolha múltipla, vazios; eles continuam aceitos aqui, com o mesmo
 * sentido de uma lista de um.
 */
type FiltrosAplicaveis = Partial<FiltrosContatos> & {
  busca: string;
  /** Legado: uma etiqueta só (pede o select de selectComFiltros com ela). */
  etiqueta?: string;
  /** Legado: um responsável só, ou SEM_DONO. */
  responsavel?: string;
};

/**
 * Aplica os filtros a uma consulta em leads montada com selectComFiltros.
 * Cada um soma ao outro com E; dentro de responsáveis, vale qualquer um dos
 * escolhidos; dentro de etiquetas, qualquer uma ou todas, pelo modo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- corta a recursão de tipos do builder
export function aplicarFiltros(q: any, f: FiltrosAplicaveis): any {
  const etiquetas = etiquetasDoFiltro(f);
  if (f.semEtiqueta) {
    q = q.is("f_sem_etiqueta", null);
  } else if (exigeTodas(f, etiquetas)) {
    etiquetas.forEach((id, i) => {
      q = q.eq(`f_etiqueta_${i}.tag_id`, id);
    });
  } else if (etiquetas.length > 0) {
    q = q.in("f_etiquetas.tag_id", etiquetas);
  }

  const responsaveis = [
    ...(f.responsaveis ?? []),
    ...(f.responsavel ? [f.responsavel] : []),
  ];
  const donos = responsaveis.filter((id) => UUID.test(id));
  const semDono = responsaveis.includes(SEM_DONO);
  if (donos.length > 0 && semDono) {
    q = q.or(`responsavel_id.in.(${donos.join(",")}),responsavel_id.is.null`);
  } else if (donos.length > 0) {
    q = q.in("responsavel_id", donos);
  } else if (semDono) {
    q = q.is("responsavel_id", null);
  }

  // Campanha: quem recebeu. O envio que falhou (na hora ou avisado depois
  // pela Meta) grava o erro e não conta, como na fila.
  if (f.campanha && UUID.test(f.campanha)) {
    q = q
      .eq("f_campanha.campanha_id", f.campanha)
      .is("f_campanha.erro", null);
  }

  // Canal. WhatsApp: tem telefone. Instagram: tem o @ ou veio pelo Direct
  // (IGSID), o mesmo critério da foto (veioPeloDirect).
  if (f.canal === "whatsapp") q = q.not("telefone_e164", "is", null);
  if (f.canal === "instagram") {
    q = q.or("instagram_id.not.is.null,instagram_usuario.not.is.null");
  }

  // Período, no fuso de Brasília: `desde` inclusive, `ateAntes` exclusivo.
  if (f.de || f.ate) {
    const { desde, ateAntes } = intervaloDoPeriodo(f.de ?? "", f.ate ?? "");
    const coluna = f.data === "cadastro" ? "criado_em" : "ultima_interacao_em";
    if (desde) q = q.gte(coluna, desde);
    if (ateAntes) q = q.lt(coluna, ateAntes);
  }

  if (f.busca) {
    // Vírgula e parênteses quebram a sintaxe do .or() do PostgREST.
    const termo = f.busca.replace(/[,()]/g, " ").trim();
    const digitos = termo.replace(/\D/g, "");
    // O @Instagram fica guardado sem a arroba.
    const usuario = termo.replace(/^@/, "");
    if (termo) {
      // O nome com ou sem acento: "joao" acha "João" (imatch é o ~* do
      // Postgres). Entre aspas, o padrão pode ter colchete e ponto sem
      // virar sintaxe do .or(). E-mail e @ não têm acento: seguem no ilike.
      const alvos = [
        `nome.imatch."${padraoSemAcento(termo)}"`,
        `email.ilike.%${termo}%`,
      ];
      if (usuario) alvos.push(`instagram_usuario.ilike.%${usuario}%`);
      // Com poucos dígitos, "11" casaria meia base pelo DDD.
      if (digitos.length >= 4) alvos.push(`telefone_e164.ilike.%${digitos}%`);
      q = q.or(alvos.join(","));
    }
  }
  return q;
}

/** Os parâmetros dos filtros, na ordem fixa de sempre. */
function parametros(f: FiltrosContatos): URLSearchParams {
  const p = new URLSearchParams();
  if (f.busca) p.set("busca", f.busca);
  // As etiquetas como a fila escreve: "Sem etiqueta" vence, e o modo só vai
  // com etiqueta marcada (sem ela, o modo não muda a lista nem o endereço).
  escreverEtiquetasNaUrl(p, {
    semEtiqueta: f.semEtiqueta,
    etiquetas: ordenados(f.etiquetas),
    etiquetasModo: f.etiquetasModo,
  });
  const responsaveis = ordenados(f.responsaveis);
  if (responsaveis.length > 0) p.set("responsaveis", responsaveis.join(","));
  if (f.campanha) p.set("campanha", f.campanha);
  if (f.canal) p.set("canal", f.canal);
  if (f.de || f.ate) {
    if (f.data === "cadastro") p.set("data", "cadastro");
    if (f.de) p.set("de", f.de);
    if (f.ate && !ehAtalhoPeriodo(f.de)) p.set("ate", f.ate);
  }
  return p;
}

/** URL da lista com os filtros que estão valendo. Canônica: os mesmos
 *  filtros dão sempre o mesmo endereço (a seleção recomeça por ele). */
export function urlContatos(f: FiltrosContatos, pagina = 1): string {
  const p = parametros(f);
  if (pagina > 1) p.set("pagina", String(pagina));
  const q = p.toString();
  return q ? `/contatos?${q}` : "/contatos";
}

/** Mesmos filtros, apontados para o CSV. */
export function urlExportar(f: FiltrosContatos): string {
  const q = consultaDosFiltros(f);
  return q ? `/api/exportar/contatos?${q}` : "/api/exportar/contatos";
}

/**
 * Os filtros como a query da URL, sem a página: o que a seleção manda ao
 * servidor no "Marcar os N deste filtro" (o servidor relê por lerFiltros e
 * percorre a mesma consulta da lista).
 */
export function consultaDosFiltros(f: FiltrosContatos): string {
  return parametros(f).toString();
}
