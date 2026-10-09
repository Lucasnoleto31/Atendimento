import Link from "next/link";
import {
  EyeOff,
  FileUp,
  MessageSquareText,
  ScrollText,
  Send,
  Shuffle,
  Smartphone,
  Tag,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarDataCurta } from "@/lib/format";
import {
  CabecalhoPagina,
  Grupo,
  LINHA_ACAO,
  MIOLO_LINHA,
  Seta,
  ValorLinha,
} from "../configuracoes/ui";
import { contagem } from "../configuracoes/resultado";
import { caminhoDa, CAMINHO_LOG, TITULO_SUBPAGINA } from "./rotas";
import { faltaNoWebhook, type SituacaoWebhook } from "./webhook";

/*
 * O índice da Administração (pedido do Artur em 09/10/2026: uma entrada só
 * no lugar de Log de acesso, Administração e Configurações). Grupos na ordem
 * do uso, com o que a gestão mexe toda semana em cima; cada linha diz o
 * estado e abre a subpágina, que tem o "‹ Administração" para voltar.
 *
 * Sem "use client": só links, a página de servidor monta tudo.
 */

export type ResumoAdministracao = {
  ehAdmin: boolean;
  /** Contagens; null quando a leitura falhou (a linha fica sem número). */
  mensagens: number | null;
  etiquetas: number | null;
  distribuicao: boolean;
  /** null sem a coluna do rodízio (0041). */
  rodizio: { dentro: number; ativos: number } | null;
  ultimaImportacao: {
    referencia_data: string;
    status: string;
    linhas_ok: number | null;
  } | null;
  pessoas: number;
  desativadas: number;
  /** Regras de privacidade (só o admin); null se a leitura falhou. */
  regras: number | null;
  numeros: number;
  conectados: number;
  webhook: SituacaoWebhook;
  /** As variáveis do Instagram Direct estão no ambiente. */
  instagram: boolean;
};

/** Uma linha do índice: ícone, nome, estado e a seta. O fio começa no
 *  texto, depois do ícone, como nos Ajustes. O estado vai à direita
 *  (`valor`) ou embaixo (`apoio`); `tom` pinta o que estiver com ele. */
function LinhaIndice({
  href,
  icone: Icone,
  titulo,
  apoio,
  valor,
  tom = "neutro",
  apoioQuebra = false,
}: {
  href: string;
  icone: LucideIcon;
  titulo: string;
  apoio?: string;
  valor?: string;
  /** Atenção pinta o valor; sem valor, o apoio, quando o estado mora nele. */
  tom?: "neutro" | "atencao";
  /** O apoio em até duas linhas, em vez de cortado. */
  apoioQuebra?: boolean;
}) {
  const apoioEmAtencao = tom === "atencao" && !valor;
  return (
    <li className="group/linha">
      <Link href={href} className={LINHA_ACAO}>
        <span className="flex shrink-0 items-center pl-2">
          <Icone
            size={20}
            strokeWidth={1.75}
            aria-hidden
            className="text-texto-2"
          />
        </span>
        <span className={cn(MIOLO_LINHA, "ml-1.5")}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="tipo-corpo truncate text-tinta">{titulo}</span>
            {apoio ? (
              <span
                className={cn(
                  "tipo-nota",
                  apoioEmAtencao ? "text-atencao" : "text-texto-2",
                  apoioQuebra ? "line-clamp-2" : "truncate",
                )}
              >
                {apoio}
              </span>
            ) : null}
          </span>
          {valor ? <ValorLinha tom={tom}>{valor}</ValorLinha> : null}
          <Seta />
        </span>
      </Link>
    </li>
  );
}

function numero(n: number | null): string | undefined {
  return n === null ? undefined : n.toLocaleString("pt-BR");
}

export function TelaIndice({ resumo }: { resumo: ResumoAdministracao }) {
  const r = resumo;
  const atendimento = [
    r.distribuicao ? "Distribuição ligada" : "Distribuição desligada",
    r.rodizio
      ? `${r.rodizio.dentro.toLocaleString("pt-BR")} de ${r.rodizio.ativos.toLocaleString("pt-BR")} no rodízio`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const imp = r.ultimaImportacao;
  const importacao = !imp
    ? "Nenhuma importação ainda"
    : imp.status === "concluida"
      ? `Última em ${formatarDataCurta(imp.referencia_data)} · ${contagem(imp.linhas_ok ?? 0, "contato", "contatos")}`
      : imp.status === "falhou"
        ? `A última, de ${formatarDataCurta(imp.referencia_data)}, falhou`
        : `Uma importação em andamento`;

  const equipe = [
    contagem(r.pessoas, "pessoa", "pessoas"),
    r.desativadas > 0
      ? contagem(r.desativadas, "desativada", "desativadas")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const numerosOk = r.numeros > 0 && r.conectados === r.numeros;
  const falta = faltaNoWebhook(r.webhook);

  return (
    <div className="px-2 pt-3 pb-6 md:px-3 lg:pt-4">
      <CabecalhoPagina titulo="Administração" />

      <div className="mt-3 flex max-w-[720px] flex-col gap-4">
        <Grupo id="grupo-conversas" titulo="Conversas">
          <LinhaIndice
            href={caminhoDa("mensagens")}
            icone={MessageSquareText}
            titulo={TITULO_SUBPAGINA.mensagens}
            valor={numero(r.mensagens)}
          />
          <LinhaIndice
            href={caminhoDa("etiquetas")}
            icone={Tag}
            titulo={TITULO_SUBPAGINA.etiquetas}
            valor={numero(r.etiquetas)}
          />
          <LinhaIndice
            href={caminhoDa("atendimento")}
            icone={Shuffle}
            titulo={TITULO_SUBPAGINA.atendimento}
            apoio={atendimento}
          />
        </Grupo>

        <Grupo id="grupo-contatos" titulo="Contatos">
          <LinhaIndice
            href={caminhoDa("importar")}
            icone={FileUp}
            titulo={TITULO_SUBPAGINA.importar}
            apoio={importacao}
          />
        </Grupo>

        <Grupo id="grupo-pessoas" titulo="Pessoas e acesso">
          {r.ehAdmin ? (
            <LinhaIndice
              href={caminhoDa("equipe")}
              icone={Users}
              titulo={TITULO_SUBPAGINA.equipe}
              apoio={equipe}
            />
          ) : null}
          {r.ehAdmin ? (
            <LinhaIndice
              href={caminhoDa("privacidade")}
              icone={EyeOff}
              titulo={TITULO_SUBPAGINA.privacidade}
              apoio={
                r.regras === null
                  ? undefined
                  : r.regras === 0
                    ? "Nenhuma regra"
                    : contagem(r.regras, "regra", "regras")
              }
            />
          ) : null}
          <LinhaIndice
            href={CAMINHO_LOG}
            icone={ScrollText}
            titulo={TITULO_SUBPAGINA.acessos}
            apoio="Quem abriu conversa ou ficha, exportou, apagou ou mudou algo"
            apoioQuebra
          />
        </Grupo>

        <Grupo id="grupo-meta" titulo="Conexão com a Meta">
          <LinhaIndice
            href={caminhoDa("whatsapp")}
            icone={Smartphone}
            titulo="Números de WhatsApp"
            apoio={
              r.numeros === 0
                ? "Nenhum número cadastrado"
                : "Com o phone_number_id preenchido"
            }
            valor={
              r.numeros === 0
                ? undefined
                : `${r.conectados.toLocaleString("pt-BR")} de ${r.numeros.toLocaleString("pt-BR")}`
            }
            // Sem número, o apoio diz e fica no cinza, como sempre ficou.
            tom={r.numeros > 0 && !numerosOk ? "atencao" : "neutro"}
          />
          {/* O estado embaixo, não à direita: no telefone de 375px, o
              título e o estado dividem 245px, e "Webhook do WhatsApp"
              (200px na Poppins de 17) com "Configurado" (107) cortava o
              título. Embaixo, o título fica inteiro em todos os estados. */}
          <LinhaIndice
            href={`${caminhoDa("whatsapp")}#grupo-webhook`}
            icone={Webhook}
            titulo="Webhook do WhatsApp"
            apoio={falta ?? "Configurado"}
            tom={falta ? "atencao" : "neutro"}
          />
          {/* "Configurado", não "Conectado": a linha só sabe que as
              variáveis estão no ambiente, não se o token ainda vale. */}
          <LinhaIndice
            href={caminhoDa("instagram")}
            icone={Send}
            titulo={TITULO_SUBPAGINA.instagram}
            apoio={r.instagram ? "Configurado" : "Falta configurar"}
            tom={r.instagram ? "neutro" : "atencao"}
          />
        </Grupo>
      </div>
    </div>
  );
}
