"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useComandosDaTela } from "@/components/app/paleta-global";
import { useTelaMd } from "../../conversas/folha";
import { transferirContatos, type ResultadoEmMassa } from "../acoes-lista";
import { medirEspaco } from "../medir-espaco";
import { AVISO_PASSOU, AVISO_SAIU, comAvisoLista } from "../aviso-lista";
import { precisaBusca, useCargaEquipe, type Destino } from "../carga-equipe";

// O menu traz os menus de filtro junto: carrega na primeira abertura, fora
// do JavaScript da ficha.
const PainelTrocar = dynamic(
  () => import("./painel-trocar").then((m) => m.PainelTrocar),
  { ssr: false },
);
import { voltarSemOContato } from "../voltar";
import { marcarContatoMudou } from "../rastro";

const SEM_CONEXAO = "A conexão não respondeu. Confira a internet e tente de novo.";

/** O menu com a busca, uns três nomes e o pé com o Transferir. */
const ALTURA_DO_MENU_PX = 280;

/** O que o "Trocar" precisa saber de quem troca. */
export type DadosTrocar = {
  destinos: Destino[];
  /** Admin ou gestor: veem a carga de cada pessoa. */
  gestao: boolean;
  /** Quem não vê a base inteira (o assessor): passado a outra pessoa, o
   *  contato sai da vista dele. */
  saiAoPassar: boolean;
  meuId: string;
};

/**
 * O "Trocar" da linha Responsável da ficha. Antes, trocar o dono era abrir
 * o Editar, achar o select e salvar o formulário inteiro, e esse caminho não
 * deixava a linha "Atendimento atribuído a…" no histórico da conversa. Aqui
 * abre a mesma lista de pessoas da seleção em massa (sem quem só lê, com a
 * carga para a gestão, com busca na lista comprida), e grava pela mesma
 * action (transferirContatos com um id só): as mesmas recusas, o mesmo
 * registro no histórico e o mesmo aviso de privacidade.
 *
 * Escolher a pessoa marca o item e escreve a troca no pé, com o Transferir.
 * Se o contato sai da vista de quem trocou (privacidade, ou o assessor que
 * passa um contato da carteira), a ficha não abriria mais: volta para a
 * lista com o aviso. Senão, a ficha relê os dados ali mesmo.
 */
export function TrocarResponsavel({
  leadId,
  donoId,
  voltar,
  dados,
}: {
  leadId: string;
  donoId: string | null;
  /** O ?voltar= da ficha, para onde ir se o contato sair da vista. */
  voltar: string | null;
  dados: DadosTrocar;
}) {
  const router = useRouter();
  const menu = useTelaMd();
  const gatilho = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [aberta, setAberta] = useState(false);
  // Depois da primeira abertura o painel fica montado, para a folha do
  // celular descer à vista ao fechar.
  const [foiAberta, setFoiAberta] = useState(false);
  const [termo, setTermo] = useState("");
  const [escolhido, setEscolhido] = useState<{
    id: string | null;
    nome: string;
  } | null>(null);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; ver: boolean } | null>(
    null,
  );
  const { carga, ler } = useCargaEquipe(dados.gestao);
  const comBusca = precisaBusca(dados.destinos);

  const abrir = () => {
    setTermo("");
    setEscolhido(null);
    setErro(null);
    setAviso(null);
    setFoiAberta(true);
    setAberta(true);
    void ler();
  };

  const fechar = () => {
    if (pendente) return;
    setAberta(false);
  };

  async function transferir() {
    if (!escolhido || pendente) return;
    const para = escolhido;
    setPendente(true);
    setErro(null);
    let r: ResultadoEmMassa;
    try {
      r = await transferirContatos([leadId], para.id);
    } catch {
      r = { ok: false, erro: SEM_CONEXAO };
      // Sem resposta, a troca pode ter acontecido: a ficha relê, e a lista
      // também, quando voltar.
      router.refresh();
      marcarContatoMudou();
    }
    setPendente(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    if (r.mudaram === 0) {
      if (r.recusados > 0) {
        setErro(
          "Você não pode passar este contato para essa pessoa. Peça a transferência à gestão.",
        );
        return;
      }
      setAberta(false);
      setAviso({
        texto: para.id
          ? `O contato já estava com ${para.nome}.`
          : "O contato já estava sem dono.",
        ver: true,
      });
      return;
    }
    setAberta(false);
    const sai =
      r.saemDaVista ||
      (dados.saiAoPassar && para.id !== null && para.id !== dados.meuId);
    if (sai) {
      // A ficha cairia no "não encontrado": volta para a lista, que diz
      // por que o contato não está mais nela.
      router.replace(
        comAvisoLista(
          voltarSemOContato(voltar, leadId) ?? "/contatos",
          r.saemDaVista ? AVISO_PASSOU : AVISO_SAIU,
          para.id,
        ),
      );
      return;
    }
    // A lista que voltar pelo histórico relê o responsável (rastro.ts).
    marcarContatoMudou();
    setAviso(
      r.semHistorico
        ? {
            texto:
              "A troca valeu, mas o histórico da conversa não registrou a linha da troca.",
            ver: true,
          }
        : {
            texto: para.id
              ? `Contato passou para ${para.nome}.`
              : "Contato ficou sem dono.",
            ver: false,
          },
    );
    router.refresh();
  }

  // No desktop o menu desce da linha Responsável, no meio da ficha. Com a
  // altura que sobra até o pé da janela (--espaco-menu, como nos menus do
  // funil), o pé com o Transferir fica sempre à vista e só a lista rola.
  // Perto do pé da janela, onde nem a lista curta caberia, a página sobe o
  // que falta antes de abrir; e o gatilho fora de vista (o comando da
  // paleta com a ficha rolada) volta para a tela.
  useLayoutEffect(() => {
    if (!aberta || !menu) return;
    const el = caixa.current;
    if (!el) return;
    const topo = el.getBoundingClientRect().top;
    const espaco = medirEspaco(el) ?? ALTURA_DO_MENU_PX;
    const sobe =
      topo < 0 ? topo - 16 : Math.max(0, ALTURA_DO_MENU_PX - espaco);
    if (sobe === 0) return;
    window.scrollBy(0, sobe);
    medirEspaco(el);
  }, [aberta, menu]);
  // A janela mudou (o tamanho, a rolagem por fora do menu): mede de novo.
  useEffect(() => {
    if (!aberta || !menu) return;
    const medir = () => medirEspaco(caixa.current);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", medir);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, { passive: true });
    return () => {
      vv?.removeEventListener("resize", medir);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir);
    };
  }, [aberta, menu]);

  useComandosDaTela([
    {
      id: "ficha-trocar-responsavel",
      rotulo: "Trocar o responsável",
      grupo: "Este contato",
      executar: abrir,
    },
  ]);

  // A confirmação, no pé do menu (desktop) ou da folha (celular). O botão
  // não se desativa durante a troca (o foco cairia no body): fica
  // aria-disabled, com o indicador, e o toque é ignorado.
  const confirmacao = (
    <div className="flex flex-col gap-1">
      <p className="tipo-nota [overflow-wrap:anywhere] text-texto-2">
        {escolhido
          ? escolhido.id
            ? `Passar o contato para ${escolhido.nome}. A conversa registra a troca.`
            : "Deixar o contato sem dono. A conversa registra a troca."
          : "Escolha quem fica com o contato."}
      </p>
      {erro ? (
        <p role="alert" className="tipo-nota text-erro">
          {erro}
        </p>
      ) : null}
      <Button
        className="w-full pointer-coarse:h-[44px]"
        disabled={!escolhido}
        aria-disabled={pendente || undefined}
        aria-busy={pendente || undefined}
        icone={pendente ? <Spinner tamanho={16} /> : undefined}
        onClick={() => void transferir()}
      >
        {pendente ? "Transferindo…" : "Transferir"}
      </Button>
    </div>
  );

  return (
    <>
      <div ref={caixa} className="relative inline-flex">
        <Button
          ref={gatilho}
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={aberta}
          onClick={() => (aberta ? fechar() : abrir())}
          className="-my-0.5 -mr-1 px-1"
        >
          Trocar
        </Button>
        {foiAberta ? (
          <PainelTrocar
            menu={menu}
            aberta={aberta}
            aoFechar={fechar}
            gatilho={gatilho}
            comBusca={comBusca}
            termo={termo}
            aoMudarTermo={setTermo}
            confirmacao={confirmacao}
            destinos={dados.destinos}
            carga={carga}
            donoId={donoId}
            escolhidoId={escolhido ? escolhido.id : undefined}
            pendente={pendente}
            aoEscolher={(p) => {
              setErro(null);
              setEscolhido(p);
            }}
          />
        ) : null}
      </div>
      <span
        role="status"
        className={
          aviso?.ver ? "block basis-full tipo-nota text-texto-2" : "sr-only"
        }
      >
        {aviso?.texto ?? ""}
      </span>
    </>
  );
}
