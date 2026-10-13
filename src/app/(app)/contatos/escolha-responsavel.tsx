"use client";

import {
  CampoBuscaMenu,
  filtrarPorNome,
  MensagemMenu,
} from "../conversas/barra-filtros";
import { ItemAcao, ItemSecao, ItensSecao } from "../conversas/folha";

/*
 * Para quem passar um contato: a mesma lista do Transferir do chat, usada na
 * seleção em massa de Contatos e no "Trocar" da ficha. "Sem dono" no topo e
 * a equipe ativa sem quem só lê (o compliance não atende: o contato passado
 * para ele ficaria sem ninguém que responda), com a carga de conversas
 * abertas de cada pessoa ao lado do nome para a gestão, e a busca quando a
 * lista passa de ITENS_SEM_BUSCA. Quem decide se a troca vale continua sendo
 * o servidor (transferirContatos); aqui é só a tela, igual à fila.
 */

export { precisaBusca, useCargaEquipe, type Destino } from "./carga-equipe";
import type { Destino } from "./carga-equipe";

/** A busca do topo do menu, quando a lista pede. */
export function BuscaResponsavel({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (valor: string) => void;
}) {
  return (
    <CampoBuscaMenu
      valor={valor}
      aoMudar={aoMudar}
      rotulo="Buscar pessoa"
      placeholder="Buscar pessoa"
    />
  );
}

/**
 * Os itens: "Sem dono" e a equipe, filtrados pela busca. `atual` (a ficha)
 * marca o dono de agora com "Atual" e não deixa escolhê-lo; com `radio`
 * (quando a escolha espera a confirmação no pé), o `escolhido` ganha a
 * marca de rádio.
 */
export function ItensResponsavel({
  menu,
  destinos,
  carga,
  termo,
  atual,
  radio = false,
  escolhido,
  papel,
  desativado = false,
  aoEscolher,
}: {
  menu: boolean;
  destinos: Destino[];
  carga: Map<string, number> | null;
  termo: string;
  /** O dono de agora; undefined quando não se aplica (a seleção). */
  atual?: string | null;
  /** A escolha espera a confirmação no pé: os itens viram rádio. */
  radio?: boolean;
  /** O escolhido no rádio (null é "Sem dono"); undefined, nenhum. */
  escolhido?: string | null;
  papel: "menuitem" | "button";
  desativado?: boolean;
  aoEscolher: (pessoa: { id: string | null; nome: string }) => void;
}) {
  const variante = menu ? "menu" : "folha";
  const opcoes = filtrarPorNome(
    [{ id: "", nome: "Sem dono" }, ...destinos],
    termo,
  );
  if (opcoes.length === 0) {
    return (
      <MensagemMenu menu={menu}>Ninguém com “{termo.trim()}”.</MensagemMenu>
    );
  }
  return (
    <ItensSecao menu={menu}>
      {opcoes.map((p) => {
        const id = p.id || null;
        const ehAtual = atual !== undefined && atual === id;
        const abertas = id ? carga?.get(id) : undefined;
        const marcado = radio
          ? escolhido !== undefined && escolhido === id
          : undefined;
        return (
          <ItemSecao key={p.id || "sem-dono"} menu={menu}>
            <ItemAcao
              variante={variante}
              papel={papel}
              marcado={marcado}
              aria-pressed={papel === "button" ? marcado : undefined}
              disabled={desativado || ehAtual}
              detalhe={
                ehAtual ? (
                  "Atual"
                ) : abertas !== undefined ? (
                  <>
                    {abertas.toLocaleString("pt-BR")}
                    <span className="sr-only">
                      {abertas === 1 ? " aberta" : " abertas"}
                    </span>
                  </>
                ) : undefined
              }
              onClick={() => aoEscolher({ id, nome: p.nome })}
            >
              {id === null ? (
                <span className="text-atencao">Sem dono</span>
              ) : (
                p.nome
              )}
            </ItemAcao>
          </ItemSecao>
        );
      })}
    </ItensSecao>
  );
}
