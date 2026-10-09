"use client";

import type { ReactNode, RefObject } from "react";
import { PainelEscolha } from "../../conversas/barra-filtros";
import {
  BuscaResponsavel,
  ItensResponsavel,
  type Destino,
} from "../escolha-responsavel";

/**
 * O menu do "Trocar" da ficha (folha no celular). Vem num pedaço de JS à
 * parte, carregado na primeira vez que o menu abre: ele traz os menus de
 * filtro, que a ficha não usa em mais nada.
 */
export function PainelTrocar({
  menu,
  aberta,
  aoFechar,
  gatilho,
  comBusca,
  termo,
  aoMudarTermo,
  confirmacao,
  destinos,
  carga,
  donoId,
  escolhidoId,
  pendente,
  aoEscolher,
}: {
  menu: boolean;
  aberta: boolean;
  aoFechar: () => void;
  gatilho: RefObject<HTMLButtonElement | null>;
  comBusca: boolean;
  termo: string;
  aoMudarTermo: (termo: string) => void;
  confirmacao: ReactNode;
  destinos: Destino[];
  carga: Map<string, number> | null;
  donoId: string | null;
  escolhidoId: string | null | undefined;
  pendente: boolean;
  aoEscolher: (p: { id: string | null; nome: string }) => void;
}) {
  return (
    <PainelEscolha
      menu={menu}
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Passar para"
      gatilho={gatilho}
      alinhar="fim"
      alturaPelaTela
      topo={
        comBusca ? (
          <BuscaResponsavel valor={termo} aoMudar={aoMudarTermo} />
        ) : null
      }
      pe={confirmacao}
      rodapeFolha={confirmacao}
    >
      <ItensResponsavel
        menu={menu}
        destinos={destinos}
        carga={carga}
        termo={termo}
        atual={donoId}
        radio
        escolhido={escolhidoId}
        papel="button"
        desativado={pendente}
        aoEscolher={aoEscolher}
      />
    </PainelEscolha>
  );
}
