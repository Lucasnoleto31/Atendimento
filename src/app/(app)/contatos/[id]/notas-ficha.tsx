"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Ban } from "lucide-react";
import { enviarMensagemLead, type ResultadoEnvio } from "@/app/(app)/chat/actions";
import { Button } from "@/components/ui/button";
import { AJUDA, AREA_TEXTO } from "@/components/app/form-styles";
import { useComandosDaTela } from "@/components/app/paleta-global";
import { dataEHora } from "../formato";

export type NotaFicha = {
  id: string;
  conteudo: string | null;
  criado_em: string;
  autor: { nome: string } | null;
  /** Apagada no chat ("Apagar para a equipe"): chega sem o texto e a ficha
   *  mostra a marca, como a bolha. */
  apagada?: { por: "contato" | "equipe"; nome: string | null } | null;
};

/** O texto da nota apagada: o mesmo da bolha (TextoApagada, no chat). */
function rotuloApagada(apagada: NonNullable<NotaFicha["apagada"]>): string {
  if (apagada.por === "contato") return "Mensagem apagada";
  return apagada.nome ? `Apagada por ${apagada.nome}` : "Apagada pela equipe";
}

const SEM_CONEXAO = "A conexão não respondeu. Confira a internet e tente de novo.";

/**
 * As notas internas da ficha, com o "Escrever nota". Antes a nota só se
 * escrevia no chat (abrir a conversa, trocar o compositor para Nota,
 * escrever e voltar); quem acabou de ligar pelo telefone da ficha agora
 * anota ali mesmo. Grava pela mesma action do chat (enviarMensagemLead com
 * modo=nota): o mesmo insert, o mesmo autor, a mesma conferência de acesso.
 * O compliance (só lê) não vê o botão.
 *
 * A nota nova entra no topo sem recarregar. A ficha mostra as 20 mais
 * recentes; havendo mais, "Ver todas na conversa" leva ao chat, onde o
 * histórico inteiro está.
 */
export function NotasFicha({
  leadId,
  iniciais,
  podeEscrever,
  cortadas,
  conversa,
}: {
  leadId: string;
  iniciais: NotaFicha[];
  podeEscrever: boolean;
  /** Há notas além das que a ficha mostra. */
  cortadas: boolean;
  /** A conversa no chat, com o caminho de volta para esta ficha. */
  conversa: string;
}) {
  const [notas, setNotas] = useState(iniciais);
  // A ficha releu os dados (o "Trocar", por exemplo): vale a lista nova,
  // que já traz as notas salvas aqui. Ajuste na renderização, sem efeito.
  const [lidas, setLidas] = useState(iniciais);
  if (iniciais !== lidas) {
    setLidas(iniciais);
    setNotas(iniciais);
  }
  const [escrevendo, setEscrevendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const botao = useRef<HTMLButtonElement>(null);
  const idCampo = useId();
  const idAjuda = useId();

  const abrir = () => {
    setErro(null);
    setAviso("");
    setEscrevendo(true);
  };

  const fechar = () => {
    if (pendente) return;
    setEscrevendo(false);
    setTexto("");
    setErro(null);
  };

  // O campo fechou (Cancelar, Esc ou a nota salva) e levou o foco junto:
  // ele volta ao "Escrever nota", que reaparece no lugar.
  const escrevendoAntes = useRef(false);
  useEffect(() => {
    const antes = escrevendoAntes.current;
    escrevendoAntes.current = escrevendo;
    if (!antes || escrevendo) return;
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body && ativo.isConnected) return;
    botao.current?.focus({ preventScroll: true });
  }, [escrevendo]);

  async function salvar() {
    const limpo = texto.trim();
    if (!limpo || pendente) return;
    setPendente(true);
    setErro(null);
    const dados = new FormData();
    dados.set("lead_id", leadId);
    dados.set("texto", limpo);
    dados.set("modo", "nota");
    let r: ResultadoEnvio;
    try {
      r = await enviarMensagemLead({}, dados);
    } catch {
      r = { erro: SEM_CONEXAO };
    }
    setPendente(false);
    if (r.erro || !r.ok) {
      setErro(r.erro ?? "A nota não foi salva. Tente de novo.");
      return;
    }
    const criada = r.interacao;
    setNotas((atual) => [
      criada
        ? {
            id: criada.id,
            conteudo: criada.conteudo,
            criado_em: criada.criado_em,
            autor: criada.autor ? { nome: criada.autor } : null,
          }
        : {
            id: `nova-${Date.now()}`,
            conteudo: limpo,
            criado_em: new Date().toISOString(),
            autor: null,
          },
      ...atual,
    ]);
    setTexto("");
    setEscrevendo(false);
    setAviso("Nota salva.");
  }

  useComandosDaTela(
    podeEscrever
      ? [
          {
            id: "ficha-escrever-nota",
            rotulo: "Escrever nota interna",
            grupo: "Este contato",
            executar: abrir,
          },
        ]
      : [],
  );

  return (
    <section aria-labelledby="notas-titulo" className="min-w-0">
      <div className="flex min-h-[32px] items-end justify-between gap-1 px-2 pb-1">
        <h2
          id="notas-titulo"
          className="tipo-nota tracking-[0.06em] text-texto-2 uppercase"
        >
          Notas internas
        </h2>
        {podeEscrever && !escrevendo ? (
          <Button
            ref={botao}
            variant="ghost"
            size="sm"
            onClick={abrir}
            className="-mr-1 -mb-0.5 px-1"
          >
            Escrever nota
          </Button>
        ) : null}
      </div>

      <p role="status" className="sr-only">
        {aviso}
      </p>

      {escrevendo ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
          className="mb-2 rounded-painel bg-cartao p-2"
        >
          <label htmlFor={idCampo} className="sr-only">
            Nota interna
          </label>
          <textarea
            id={idCampo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // ⌘Enter / Ctrl+Enter salva, como no compositor do chat; Esc
              // desiste.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void salvar();
              } else if (e.key === "Escape") {
                e.preventDefault();
                fechar();
              }
            }}
            // Quem tocou em "Escrever nota" quer escrever: o teclado abrir
            // aqui é o que a pessoa pediu.
            autoFocus
            rows={3}
            maxLength={4096}
            aria-describedby={idAjuda}
            placeholder="Ex.: ligou e pediu retorno amanhã de manhã"
            className={AREA_TEXTO}
          />
          <p id={idAjuda} className={`mt-0.5 ${AJUDA}`}>
            Só a equipe vê. A nota também aparece na conversa.
          </p>
          {erro ? (
            <p role="alert" className="mt-0.5 tipo-nota text-erro">
              {erro}
            </p>
          ) : null}
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button
              type="button"
              variant="secondary"
              disabled={pendente}
              onClick={fechar}
              className="pointer-coarse:h-[44px]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              carregando={pendente}
              disabled={!texto.trim()}
              className="pointer-coarse:h-[44px]"
            >
              {pendente ? "Salvando…" : "Salvar nota"}
            </Button>
          </div>
        </form>
      ) : null}

      {notas.length === 0 ? (
        escrevendo ? null : (
          <p className="rounded-painel bg-cartao p-2 tipo-corpo text-texto-2">
            Nenhuma nota.
          </p>
        )
      ) : (
        <ul className="rounded-painel bg-cartao">
          {notas.map((n) => (
            <li
              key={n.id}
              className="ml-2 border-t border-fio py-1.5 pr-2 first:border-t-0"
            >
              {n.apagada ? (
                <p className="flex items-center gap-0.5 tipo-corpo text-texto-2">
                  <Ban
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden
                    className="shrink-0"
                  />
                  {rotuloApagada(n.apagada)}
                </p>
              ) : (
                <p className="tipo-corpo [overflow-wrap:anywhere] whitespace-pre-wrap text-tinta">
                  {n.conteudo ?? ""}
                </p>
              )}
              <p className="mt-0.5 tipo-nota text-texto-2 tabular-nums">
                {n.autor?.nome ?? "Sem autor"} ·{" "}
                <time dateTime={n.criado_em}>{dataEHora(n.criado_em)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}

      {cortadas ? (
        <Button
          href={conversa}
          variant="ghost"
          size="sm"
          className="mt-1 ml-1 px-1"
        >
          Ver todas na conversa
        </Button>
      ) : null}
    </section>
  );
}
