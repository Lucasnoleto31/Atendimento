"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button, classesDoBotao } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useComandosDaTela } from "@/components/app/paleta-global";
import { cn } from "@/lib/utils";
import { Folha } from "../conversas/folha";
import { contarParaExportar } from "./acoes-lista";
import { baixarCsv, DOWNLOAD_CANCELADO } from "./baixar-csv";
import { useSelecaoLigada } from "./selecao-na-tela";

type Contagem =
  | { tipo: "contando" }
  | { tipo: "pronta"; total: number }
  | { tipo: "erro"; texto: string };

const numero = new Intl.NumberFormat("pt-BR");

const SEM_CONEXAO = "A conexão não respondeu. Confira a internet e tente de novo.";

/** "1 contato", "1.240 contatos". */
function qtd(n: number): string {
  return n === 1 ? "1 contato" : `${numero.format(n)} contatos`;
}

/**
 * O "Exportar CSV" do topo de Contatos (e o comando da paleta). Antes era um
 * link de download: um clique levava a lista filtrada inteira, sem dizer
 * quantos, e gravava a exportação no log de acesso em nome de quem clicou;
 * com a sessão caída, baixava um arquivo com o texto do erro dentro.
 *
 * Agora é o mesmo fluxo da exportação da seleção: o clique abre a
 * confirmação com o número ("Exportar 1.240 contatos com estes filtros?"),
 * contado só nessa hora (count exato, sem linhas), com Voltar e Baixar CSV.
 * O arquivo vem por fetch (baixar-csv.ts), e o erro aparece na própria
 * confirmação. A trava de papel e o registro no log continuam na rota.
 *
 * Durante o download o Voltar vira Cancelar, que para a busca e deixa a
 * confirmação aberta com o aviso do log. Esc e o toque fora também
 * cancelam, e fecham: a base grande (a rota lê em lotes de 1.000) ou a rede
 * parada não prendem ninguém no modal.
 *
 * Some na seleção, com o comando da paleta: o "Exportar" da barra da
 * seleção leva só os marcados.
 */
export function ExportarLista({
  url,
  filtrando,
}: {
  /** O endereço do CSV com os filtros da lista (urlExportar). */
  url: string;
  /** Há busca ou filtro: sem nenhum, o arquivo é a base inteira. */
  filtrando: boolean;
}) {
  const selecionando = useSelecaoLigada();
  const [aberta, setAberta] = useState(false);
  const [contagem, setContagem] = useState<Contagem>({ tipo: "contando" });
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelado, setCancelado] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  // A contagem que chega depois de fechar (ou de pedir de novo) não vale.
  const pedido = useRef(0);
  // O download em curso. Quem cancela tira daqui e arruma a tela; a
  // resposta que chega depois disso não mexe em nada.
  const controle = useRef<AbortController | null>(null);

  // Saiu da tela no meio do download: o arquivo não aparece depois.
  useEffect(
    () => () => {
      controle.current?.abort();
    },
    [],
  );

  async function contar() {
    pedido.current += 1;
    const vez = pedido.current;
    setContagem({ tipo: "contando" });
    let r: Awaited<ReturnType<typeof contarParaExportar>>;
    try {
      r = await contarParaExportar(url.split("?")[1] ?? "");
    } catch {
      r = { ok: false, erro: SEM_CONEXAO };
    }
    if (vez !== pedido.current) return;
    setContagem(
      r.ok ? { tipo: "pronta", total: r.total } : { tipo: "erro", texto: r.erro },
    );
  }

  const abrir = () => {
    setErro(null);
    setCancelado(false);
    setAberta(true);
    void contar();
  };

  /** Para o download em curso, se houver. */
  const parar = () => {
    controle.current?.abort();
    controle.current = null;
    setBaixando(false);
  };

  // Voltar, Esc e toque fora. No meio do download, cancela e fecha.
  const fechar = () => {
    parar();
    pedido.current += 1;
    setAberta(false);
    setErro(null);
    setCancelado(false);
  };

  // O Cancelar do download: a confirmação fica, com o aviso do log.
  const cancelar = () => {
    parar();
    setCancelado(true);
  };

  async function baixar() {
    controle.current?.abort();
    const c = new AbortController();
    controle.current = c;
    setBaixando(true);
    setErro(null);
    setCancelado(false);
    const r = await baixarCsv(url, c.signal);
    if (controle.current !== c) return;
    controle.current = null;
    setBaixando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    pedido.current += 1;
    setAberta(false);
  }

  useComandosDaTela(
    selecionando
      ? []
      : [
          {
            id: "contatos-exportar",
            rotulo: "Exportar CSV desta lista",
            grupo: "Contatos",
            executar: abrir,
          },
        ],
  );

  const vazia = contagem.tipo === "pronta" && contagem.total === 0;

  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-haspopup="dialog"
        title="Exportar CSV com os filtros desta lista"
        onClick={abrir}
        className={cn(
          classesDoBotao({ variant: "secondary", size: "md" }),
          "w-[40px] px-0 pointer-coarse:h-[44px] pointer-coarse:w-[44px] @xl:w-auto @xl:px-2 pointer-coarse:@xl:w-auto group-has-[[data-selecionando]]/contatos:hidden",
        )}
      >
        <Download size={18} strokeWidth={1.75} aria-hidden />
        <span className="sr-only @xl:not-sr-only">Exportar CSV</span>
      </button>

      <Folha
        aberta={aberta}
        aoFechar={fechar}
        titulo="Exportar CSV"
        forma="centro"
        retorno={botao}
        rodape={
          <div className="flex flex-col gap-1">
            {erro ? (
              <p role="alert" className="tipo-nota text-erro">
                {erro}
              </p>
            ) : null}
            {/* Sempre no DOM: a região anuncia o texto quando ele chega. */}
            <p
              role="status"
              className={cancelado ? "tipo-nota text-texto-2" : "sr-only"}
            >
              {cancelado ? DOWNLOAD_CANCELADO : ""}
            </p>
            <div className="flex justify-end gap-1.5">
              <Button
                variant="secondary"
                onClick={baixando ? cancelar : fechar}
                className="pointer-coarse:h-[44px]"
              >
                {baixando ? "Cancelar" : "Voltar"}
              </Button>
              <Button
                carregando={baixando}
                disabled={contagem.tipo === "contando" || vazia}
                onClick={() => void baixar()}
                className="pointer-coarse:h-[44px]"
              >
                {baixando ? "Baixando…" : "Baixar CSV"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-1 pt-1" aria-live="polite">
          {contagem.tipo === "contando" ? (
            <p className="flex items-center gap-1 tipo-corpo text-texto-2">
              <Spinner tamanho={16} />
              Contando os contatos…
            </p>
          ) : contagem.tipo === "erro" ? (
            <>
              <p className="tipo-corpo text-tinta">
                {filtrando
                  ? "Exportar a lista com estes filtros?"
                  : "Exportar a base inteira?"}
              </p>
              <p className="flex flex-wrap items-center gap-x-1 tipo-nota text-erro">
                {contagem.texto}
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-1 px-1"
                  onClick={() => void contar()}
                >
                  Contar de novo
                </Button>
              </p>
            </>
          ) : vazia ? (
            <p className="tipo-corpo text-tinta">
              Nenhum contato com estes filtros: o arquivo sairia vazio.
            </p>
          ) : (
            <p className="tipo-corpo text-tinta tabular-nums">
              {filtrando
                ? `Exportar ${qtd(contagem.total)} com estes filtros?`
                : `Exportar a base inteira, ${qtd(contagem.total)}?`}
            </p>
          )}
          <p className="tipo-nota text-texto-2">
            A exportação fica registrada no log de acesso, em seu nome.
          </p>
        </div>
      </Folha>
    </>
  );
}
