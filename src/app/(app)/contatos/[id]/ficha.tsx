import { CircleAlert, MessageSquare, Pencil } from "lucide-react";
import { formatarData, formatarTelefone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { AvatarContato } from "@/components/app/avatar-contato";
import { cn } from "@/lib/utils";
import { EtiquetasContato, type EtiquetaDoCatalogo } from "./etiquetas-contato";
import { ComandosFicha } from "./comandos-ficha";
import type { AvisoFicha } from "./aviso-ficha";
import { NotasFicha, type NotaFicha } from "./notas-ficha";
import { TrocarResponsavel, type DadosTrocar } from "./trocar-responsavel";
import { LinkVoltar } from "../link-voltar";
import { contatoDe, dataEHora, desdeQuando } from "../formato";
import { comVoltar, conversaDaFicha, rotuloVoltar } from "../voltar";

/** O contato já lido e traduzido pela página (origem, foto, dono). */
export type DadosFicha = {
  id: string;
  nome: string;
  /** Veio pelo Direct: tem foto guardada (veioPeloDirect). */
  foto: boolean;
  telefoneE164: string | null;
  email: string | null;
  instagram: string | null;
  observacao: string | null;
  criadoEm: string;
  ultimaInteracaoEm: string | null;
  dono: string | null;
  origem: string;
  origemDetalhe: string | null;
  /** Ids das etiquetas do contato. */
  etiquetas: string[];
  /** O responsável de agora (o "Trocar" o mostra como "Atual"). */
  donoId: string | null;
};

export type { NotaFicha };

/**
 * O desenho da ficha, sem consulta: a página lê os dados e registra o
 * acesso. Uma coluna até 896px de conteúdo; daí para cima, dados, etiquetas
 * e observação à esquerda e as notas à direita.
 */
export function FichaContato({
  contato,
  notas,
  notasCortadas,
  catalogo,
  podeEditar,
  transferir,
  voltar,
  aviso,
}: {
  contato: DadosFicha;
  notas: NotaFicha[];
  /** Há notas além das que a ficha mostra. */
  notasCortadas: boolean;
  catalogo: EtiquetaDoCatalogo[];
  podeEditar: boolean;
  /** Quem pode trocar o responsável aqui (null: não pode). */
  transferir: DadosTrocar | null;
  /** O ?voltar= já conferido (lerVoltar), ou null para o pai lógico. */
  voltar: string | null;
  /** O ?aviso= já conferido (lerAviso): só o código, o texto sai daqui. */
  aviso: AvisoFicha | null;
}) {
  const telefone = contato.telefoneE164
    ? formatarTelefone(contato.telefoneE164)
    : null;
  const digitos = contato.telefoneE164?.replace(/\D/g, "") ?? "";
  const dono = contato.dono;

  // A edição volta para esta ficha; com ?voltar=, a ficha que ela reabre
  // ainda sabe voltar para a origem.
  const editar = comVoltar(
    `/contatos/${contato.id}/editar`,
    voltar ? comVoltar(`/contatos/${contato.id}`, voltar) : null,
  );
  const conversa = conversaDaFicha(contato.id, voltar);

  return (
    <div className="@container px-2 pt-2 pb-4 md:px-3 md:pt-3">
      <ComandosFicha conversa={conversa} editar={podeEditar ? editar : null} />
      <div className="max-w-[1120px]">
        <LinkVoltar
          href={voltar ?? "/contatos"}
          rotulo={voltar ? rotuloVoltar(voltar) : "Contatos"}
        />

        {aviso ? (
          <p
            role="status"
            className="mt-2 flex max-w-[68ch] items-start gap-1 rounded-painel bg-cartao p-2 tipo-corpo text-tinta"
          >
            <CircleAlert
              size={20}
              strokeWidth={1.75}
              aria-hidden
              className="mt-px shrink-0 text-atencao"
            />
            {TEXTO_AVISO[aviso](contato)}
          </p>
        ) : null}

        <header className="mt-2 flex flex-col gap-2 @3xl:flex-row @3xl:items-center @3xl:justify-between @3xl:gap-3">
          {/* Nome longo quebra em várias linhas: o avatar fica no alto, com a
              primeira linha, e não boiando no meio. */}
          <div className="flex min-w-0 items-start gap-1.5 @3xl:items-center @3xl:gap-2">
            {/* Quem veio pelo Direct tem foto guardada, mesmo sem o @ (a
                leitura do perfil pode ter falhado na entrada). */}
            <AvatarContato
              nome={contato.nome}
              leadId={contato.id}
              instagram={contato.foto}
              className="h-[56px] w-[56px] tipo-titulo-3 @3xl:h-[64px] @3xl:w-[64px]"
            />
            <div className="min-w-0">
              <h1 className="tipo-titulo-1 [overflow-wrap:anywhere] text-tinta">
                {contato.nome}
              </h1>
              <p className="mt-0.5 tipo-subtitulo text-texto-2 tabular-nums">
                {contatoDe(contato.telefoneE164, contato.instagram) ??
                  "Sem telefone"}
              </p>
              <p className="tipo-nota text-texto-2">
                {dono ? (
                  `Com ${dono}`
                ) : (
                  <span className="text-atencao">Sem dono</span>
                )}
                {" · "}
                {contato.ultimaInteracaoEm ? (
                  <time
                    dateTime={contato.ultimaInteracaoEm}
                    title={dataEHora(contato.ultimaInteracaoEm)}
                  >
                    última interação{" "}
                    {desdeQuando(contato.ultimaInteracaoEm, "em ")}
                  </time>
                ) : (
                  "nunca conversou"
                )}
              </p>
            </div>
          </div>

          <div
            className={cn(
              "grid shrink-0 gap-1.5 @3xl:flex",
              podeEditar ? "grid-cols-[1fr_auto]" : "grid-cols-1",
            )}
          >
            <Button
              href={conversa}
              size="lg"
              icone={<MessageSquare size={18} strokeWidth={1.75} aria-hidden />}
              className="@3xl:h-[40px] @3xl:px-2 @3xl:text-sm pointer-coarse:@3xl:h-[44px]"
            >
              Abrir conversa
            </Button>
            {podeEditar ? (
              <Button
                href={editar}
                variant="secondary"
                size="lg"
                icone={<Pencil size={18} strokeWidth={1.75} aria-hidden />}
                className="@3xl:h-[40px] @3xl:px-2 @3xl:text-sm pointer-coarse:@3xl:h-[44px]"
              >
                Editar
              </Button>
            ) : null}
          </div>
        </header>

        <div className="mt-4 grid gap-4 @4xl:grid-cols-2 @4xl:items-start @4xl:gap-3">
          <div className="flex min-w-0 flex-col gap-4">
            <Grupo id="dados" titulo="Dados">
              <dl className="rounded-painel bg-cartao">
                <LinhaDado rotulo="Telefone">
                  {telefone ? (
                    <a href={`tel:+${digitos}`} className={LINK_DADO}>
                      <span className="tabular-nums">{telefone}</span>
                    </a>
                  ) : null}
                </LinhaDado>
                <LinhaDado rotulo="E-mail">
                  {contato.email ? (
                    <a href={`mailto:${contato.email}`} className={LINK_DADO}>
                      {contato.email}
                    </a>
                  ) : null}
                </LinhaDado>
                <LinhaDado rotulo="Instagram">
                  {contato.instagram
                    ? `@${contato.instagram}`
                    : null}
                </LinhaDado>
                <LinhaDado rotulo="Responsável">
                  {/* O "Trocar" ao lado do nome: a troca sem sair da
                      ficha, com a linha no histórico da conversa. */}
                  <div className="inline-flex flex-wrap items-center justify-end gap-x-1">
                    {dono ?? <span className="text-atencao">Sem dono</span>}
                    {transferir ? (
                      <TrocarResponsavel
                        leadId={contato.id}
                        donoId={contato.donoId}
                        voltar={voltar}
                        dados={transferir}
                      />
                    ) : null}
                  </div>
                </LinhaDado>
                <LinhaDado
                  rotulo="Origem"
                  detalhe={contato.origemDetalhe ?? undefined}
                >
                  {contato.origem}
                </LinhaDado>
                <LinhaDado rotulo="Na base desde">
                  <span className="tabular-nums">
                    {formatarData(contato.criadoEm)}
                  </span>
                </LinhaDado>
              </dl>
            </Grupo>

            <Grupo id="etiquetas" titulo="Etiquetas">
              <EtiquetasContato
                leadId={contato.id}
                catalogo={catalogo}
                marcadasIniciais={contato.etiquetas}
                podeEditar={podeEditar}
              />
            </Grupo>

            {contato.observacao ? (
              <Grupo id="observacao" titulo="Observação">
                <p className="rounded-painel bg-cartao p-2 tipo-corpo [overflow-wrap:anywhere] whitespace-pre-wrap text-tinta">
                  {contato.observacao}
                </p>
              </Grupo>
            ) : null}
          </div>

          <NotasFicha
            leadId={contato.id}
            iniciais={notas}
            podeEscrever={podeEditar}
            cortadas={notasCortadas}
            conversa={conversa}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * O texto de cada aviso, com o nome e o dono que esta ficha leu do banco, e
 * não o que veio na URL.
 */
const TEXTO_AVISO: Record<AvisoFicha, (contato: DadosFicha) => string> = {
  duplicado: (c) =>
    `Esse telefone já é o contato “${c.nome}”${
      c.dono ? `, com ${c.dono}` : ""
    }. Continue o atendimento por aqui.`,
};

const LINK_DADO =
  "rounded-chip underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta";

/**
 * Grupo de seção como o iOS agrupa (kit, bloco 2): o rótulo fora do cartão,
 * em caixa alta leve e apagado, alinhado ao texto de dentro.
 */
function Grupo({
  id,
  titulo,
  children,
}: {
  id: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-titulo`} className="min-w-0">
      <h2
        id={`${id}-titulo`}
        className="px-2 pb-1 tipo-nota tracking-[0.06em] text-texto-2 uppercase"
      >
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/**
 * Linha de dado: rótulo à esquerda, valor à direita, separador encaixado
 * (começa onde o texto começa). Valor vazio aparece como "—" apagado.
 */
function LinhaDado({
  rotulo,
  detalhe,
  children,
}: {
  rotulo: string;
  detalhe?: string;
  children: React.ReactNode;
}) {
  const vazio = children === null || children === undefined;
  return (
    <div className="ml-2 flex items-start justify-between gap-2 border-t border-fio py-1.5 pr-2 first:border-t-0">
      <dt className="shrink-0 tipo-corpo text-texto-2">{rotulo}</dt>
      <dd className="min-w-0 text-right tipo-corpo [overflow-wrap:anywhere] text-tinta">
        {vazio ? <span className="text-texto-3">—</span> : children}
        {detalhe ? (
          <span className="block tipo-nota text-texto-2">{detalhe}</span>
        ) : null}
      </dd>
    </div>
  );
}
