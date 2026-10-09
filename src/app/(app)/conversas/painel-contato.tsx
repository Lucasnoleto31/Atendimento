"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarData, formatarTelefone } from "@/lib/format";
import { veioPeloDirect } from "@/lib/avatar";
import { Button } from "@/components/ui/button";
import { Etiqueta } from "@/components/ui/etiqueta";
import { AvatarContato } from "@/components/app/avatar-contato";
import { BOTAO_ICONE } from "@/components/app/form-styles";
import { pontoDaEtiqueta } from "@/app/(app)/contatos/cor-etiqueta";
import {
  carregarContato,
  type ContatoConversa,
  type EtiquetaDoContato,
} from "./contato";
import { Grupo, RotuloGrupo } from "./folha";
import { hrefContatoDoChat } from "./links";

// Os mesmos rótulos da ficha em /contatos: o valor cru de
// leads.entrada_motivo vira o canal por onde a pessoa chegou.
const ROTULO_ENTRADA: Record<string, string> = {
  manual: "Cadastro manual",
  importacao: "Importação de planilha",
  webhook_meta: "WhatsApp",
  webhook_instagram: "Instagram Direct",
  formulario: "Formulário",
  meta_lead_ads: "Anúncio da Meta",
  queda_lotes: "Reativação da base",
  sem_giro: "Reativação da base",
};

const ROTULO_CANAL: Record<NonNullable<ContatoConversa["canal"]>, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram Direct",
};

/** Uma linha do grupo: rótulo curto em cima, valor embaixo, ação à direita.
 *  Separador encaixado entre as linhas. */
function Dado({
  rotulo,
  children,
  acao,
}: {
  rotulo: string;
  children: React.ReactNode;
  acao?: React.ReactNode;
}) {
  return (
    <div className="group/linha flex items-center pl-1.5">
      <div className="flex min-h-[56px] min-w-0 flex-1 items-center gap-1 border-t border-fio py-1 pr-1 group-first/linha:border-t-0">
        <div className="min-w-0 flex-1">
          <p className="tipo-nota text-texto-2">{rotulo}</p>
          <div className="tipo-corpo break-words text-tinta">{children}</div>
        </div>
        {acao}
      </div>
    </div>
  );
}

/** A linha que muda o dado: o mesmo desenho do Dado, com a seta, e o toque
 *  abre a escolha (o ⋯ da conversa, na seção dela). */
function DadoQueAbre({
  rotulo,
  dica,
  aoAbrir,
  children,
}: {
  rotulo: string;
  /** O que o toque faz ("Trocar o atendente"). */
  dica: string;
  aoAbrir: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group/linha">
      <button
        type="button"
        onClick={aoAbrir}
        aria-haspopup="dialog"
        title={dica}
        className="flex w-full items-center pl-1.5 text-left transition-colors duration-[120ms] outline-none hover:bg-realce active:bg-pressionado focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-tinta"
      >
        <span className="flex min-h-[56px] min-w-0 flex-1 items-center gap-1 border-t border-fio py-1 pr-1 group-first/linha:border-t-0">
          <span className="block min-w-0 flex-1">
            <span className="tipo-nota block text-texto-2">{rotulo}</span>
            <span className="tipo-corpo block break-words text-tinta">
              {children}
            </span>
            <span className="sr-only">. {dica}</span>
          </span>
          <ChevronRight
            size={18}
            strokeWidth={1.75}
            aria-hidden
            className="shrink-0 text-texto-3"
          />
        </span>
      </button>
    </div>
  );
}

function BotaoCopiar({ valor, rotulo }: { valor: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);
  return (
    <button
      type="button"
      aria-label={copiado ? `${rotulo} copiado` : `Copiar ${rotulo}`}
      title={copiado ? "Copiado" : `Copiar ${rotulo}`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(valor)
          .then(() => setCopiado(true))
          .catch(() => setCopiado(false));
      }}
      className={BOTAO_ICONE}
    >
      {copiado ? (
        <Check size={18} strokeWidth={2.25} aria-hidden className="text-tinta" />
      ) : (
        <Copy size={18} strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}

/**
 * Os dados do contato da conversa: como falar com ele (telefone, e-mail e
 * Instagram com copiar), quem atende, etiquetas, observação, por onde chegou
 * e os templates já gastos. Grupos de linhas, como os Ajustes do iOS.
 *
 * `coluna`: a coluna da direita do desktop largo, com o próprio cabeçalho.
 * `folha`: o miolo da folha (celular) ou da gaveta (tablet); o título com o
 * nome e o X são da folha.
 *
 * Carrega SOZINHO, depois da conversa (uma leitura: carregarContato), e só
 * ao trocar de contato. Atendente e etiquetas vêm do palco quando ele já os
 * tem: o menu ⋯ muda os dois, e o painel acompanha sem ir ao servidor. Com
 * `aoTrocarAtendente` e `aoTrocarEtiquetas` (quem edita; o compliance não),
 * as duas linhas viram botões que abrem a mesma escolha do ⋯.
 */
export function PainelContato({
  leadId,
  nome,
  instagram,
  responsavelNome,
  etiquetas,
  voltar,
  forma,
  aoTrocarAtendente,
  aoTrocarEtiquetas,
  somenteLeitura = false,
}: {
  leadId: string;
  nome: string;
  /** Se a fila já sabe que o contato veio pelo Direct: a foto aparece antes
   *  de o contato carregar. */
  instagram?: boolean;
  /** O que o palco sabe agora (undefined = ainda não sabe: vale o carregado). */
  responsavelNome?: string | null;
  etiquetas?: EtiquetaDoContato[] | null;
  /** A conversa com a fila em uso: a ficha e a edição voltam para cá. */
  voltar: string;
  forma: "coluna" | "folha";
  /** Abre o ⋯ da conversa na seção Atendente; sem ele, a linha só lê. */
  aoTrocarAtendente?: () => void;
  /** Abre o ⋯ da conversa na seção Etiquetas; sem ele, a linha só lê. */
  aoTrocarEtiquetas?: () => void;
  /** O compliance só lê: sem o "Editar" da observação. */
  somenteLeitura?: boolean;
}) {
  const [dados, setDados] = useState<ContatoConversa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      let r: Awaited<ReturnType<typeof carregarContato>>;
      try {
        r = await carregarContato(leadId);
      } catch {
        // Rede caiu: sem este catch o painel ficava preso em "Carregando…"
        // para sempre, sem erro e sem retentativa.
        r = { erro: "A conexão não respondeu. Tente de novo." };
      }
      if (!vivo) return; // trocou de contato: resposta velha, descarta
      if ("erro" in r) {
        setErro(r.erro);
        setDados(null);
      } else {
        setErro(null);
        setDados(r);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [leadId, tentativa]);

  const atendente =
    responsavelNome !== undefined
      ? responsavelNome
      : (dados?.responsavelNome ?? null);
  const etiquetasNaTela =
    etiquetas !== undefined && etiquetas !== null
      ? etiquetas
      : (dados?.etiquetas ?? []);
  // O mesmo critério das outras telas (veioPeloDirect), somado ao que a fila
  // já sabe: o painel nunca contradiz a linha ao lado.
  const doInstagram =
    (instagram ?? false) ||
    (dados !== null &&
      (veioPeloDirect({
        instagramUsuario: dados.instagram,
        entradaMotivo: dados.entradaMotivo,
      }) ||
        dados.canal === "instagram"));
  const ficha = hrefContatoDoChat(leadId, voltar);
  const editar = hrefContatoDoChat(leadId, voltar, "editar");
  const valorAtendente = atendente ?? (
    <span className="text-atencao">Sem dono</span>
  );
  const valorEtiquetas =
    etiquetasNaTela.length > 0 ? (
      <span className="mt-0.5 flex flex-wrap gap-0.5">
        {etiquetasNaTela.map((t) => (
          <Etiqueta key={t.id} cor={pontoDaEtiqueta(t.cor)}>
            {t.nome}
          </Etiqueta>
        ))}
      </span>
    ) : (
      <span className="text-texto-2">Nenhuma</span>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {forma === "coluna" ? (
        <div className="flex h-[64px] shrink-0 items-center gap-1.5 border-b border-fio px-2">
          <AvatarContato
            nome={nome}
            leadId={leadId}
            instagram={doInstagram}
            className="h-[40px] w-[40px] tipo-nota font-semibold"
          />
          <h2 className="tipo-destaque min-w-0 flex-1 truncate text-tinta">
            {nome}
          </h2>
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1",
          forma === "coluna" && "overflow-y-auto overscroll-contain px-2 pb-3",
        )}
      >
        {erro ? (
          <div className="pt-2">
            <p role="alert" className="tipo-corpo text-erro">
              {erro}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-1"
              onClick={() => {
                setErro(null);
                setTentativa((t) => t + 1);
              }}
            >
              Tentar de novo
            </Button>
          </div>
        ) : null}

        {!dados && !erro ? (
          <div aria-busy="true" aria-label="Carregando o contato">
            {[0, 1].map((g) => (
              <div key={g}>
                <div className="h-[32px]" />
                <div className="h-[112px] rounded-painel bg-cartao motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        ) : null}

        {dados ? (
          <>
            <RotuloGrupo>Contato</RotuloGrupo>
            <Grupo>
              {dados.telefone ? (
                <Dado
                  rotulo="WhatsApp"
                  acao={<BotaoCopiar valor={dados.telefone} rotulo="telefone" />}
                >
                  <span className="tabular-nums">
                    {formatarTelefone(dados.telefone)}
                  </span>
                </Dado>
              ) : null}
              {dados.email ? (
                <Dado
                  rotulo="E-mail"
                  acao={<BotaoCopiar valor={dados.email} rotulo="e-mail" />}
                >
                  {dados.email}
                </Dado>
              ) : null}
              {dados.instagram ? (
                <Dado
                  rotulo="Instagram"
                  acao={
                    <BotaoCopiar
                      valor={`@${dados.instagram}`}
                      rotulo="Instagram"
                    />
                  }
                >
                  @{dados.instagram}
                </Dado>
              ) : null}
              {!dados.telefone && !dados.email && !dados.instagram ? (
                <p className="tipo-corpo px-1.5 py-1.5 text-texto-2">
                  Sem telefone, e-mail nem Instagram.
                </p>
              ) : null}
            </Grupo>

            <RotuloGrupo>Atendimento</RotuloGrupo>
            <Grupo>
              {aoTrocarAtendente ? (
                <DadoQueAbre
                  rotulo="Atendente"
                  dica="Trocar o atendente"
                  aoAbrir={aoTrocarAtendente}
                >
                  {valorAtendente}
                </DadoQueAbre>
              ) : (
                <Dado rotulo="Atendente">{valorAtendente}</Dado>
              )}
              {aoTrocarEtiquetas ? (
                <DadoQueAbre
                  rotulo="Etiquetas"
                  dica="Mudar as etiquetas"
                  aoAbrir={aoTrocarEtiquetas}
                >
                  {valorEtiquetas}
                </DadoQueAbre>
              ) : (
                <Dado rotulo="Etiquetas">{valorEtiquetas}</Dado>
              )}
              <Dado rotulo="Conversa por">
                {dados.canal ? ROTULO_CANAL[dados.canal] : "Sem canal"}
              </Dado>
              <Dado rotulo="Entrou por">
                {ROTULO_ENTRADA[dados.entradaMotivo] ?? dados.entradaMotivo}
              </Dado>
              <Dado rotulo="Na base desde">
                <span className="tabular-nums">
                  {formatarData(dados.criadoEm)}
                </span>
              </Dado>
            </Grupo>

            <RotuloGrupo
              acao={
                somenteLeitura ? undefined : (
                  <Link
                    href={editar}
                    className="tipo-nota -my-1 inline-flex h-[32px] items-center rounded-controle px-1 font-semibold text-tinta transition-colors duration-[120ms] hover:bg-realce focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta pointer-coarse:h-[44px]"
                  >
                    Editar
                  </Link>
                )
              }
            >
              Observação
            </RotuloGrupo>
            <Grupo className="px-1.5 py-1.5">
              <p
                className={cn(
                  "tipo-corpo break-words whitespace-pre-wrap",
                  dados.observacao ? "text-tinta" : "text-texto-2",
                )}
              >
                {dados.observacao ?? "Sem observação."}
              </p>
            </Grupo>

            {/* Cada template custa na Meta: o número fica à vista. */}
            <RotuloGrupo>Templates enviados</RotuloGrupo>
            <Grupo className="px-1.5 py-1.5">
              {dados.templates.falhou ? (
                <p className="tipo-corpo text-texto-2">
                  A contagem não carregou.
                </p>
              ) : dados.templates.total === 0 ? (
                <p className="tipo-corpo text-texto-2">Nenhum.</p>
              ) : (
                <p className="tipo-corpo text-tinta">
                  <span className="font-semibold tabular-nums">
                    {dados.templates.total.toLocaleString("pt-BR")}
                  </span>
                  {dados.templates.ultimoEm ? (
                    <span className="text-texto-2">
                      {" · último em "}
                      <span className="tabular-nums">
                        {formatarData(dados.templates.ultimoEm)}
                      </span>
                      {dados.templates.ultimoNome
                        ? ` · ${dados.templates.ultimoNome}`
                        : ""}
                    </span>
                  ) : null}
                </p>
              )}
            </Grupo>

            <Button
              href={ficha}
              variant="secondary"
              className="mt-2 w-full pointer-coarse:h-[44px]"
            >
              Ver ficha do contato
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
