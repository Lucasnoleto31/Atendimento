"use client";

import type { ConfigPrivacidade } from "@/lib/privacidade-regra";
import { MestreDetalhe, type Editor } from "../../configuracoes/editor";
import {
  COMANDOS_PRIVACIDADE,
  editoresDaPrivacidade,
  SecoesPrivacidade,
} from "../privacidade";
import type { PessoaPrivacidade } from "../privacidade-texto";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";

/*
 * Administração › Privacidade (só o admin): as regras ("Aikon não vê as
 * conversas de Artur e Lucas") e, embaixo, os grupos. A regra para várias
 * pessoas cria o grupo ali mesmo, no campo Quem.
 */
export function TelaPrivacidade({
  equipe,
  privacidade,
  voltar,
}: {
  equipe: PessoaPrivacidade[];
  /** null: a leitura falhou. */
  privacidade: ConfigPrivacidade | null;
  voltar: string | null;
}) {
  const editores: Record<string, Editor> = privacidade
    ? editoresDaPrivacidade(privacidade, equipe)
    : {};

  return (
    <MolduraSubpagina>
      <CabecalhoSubpagina titulo="Privacidade" voltar={voltar} />

      <div className="mt-3">
        <MestreDetalhe
          editores={editores}
          voltar={voltar}
          grupoComandos="Administração"
          comandos={COMANDOS_PRIVACIDADE}
        >
          <div className="flex flex-col gap-4">
            <SecoesPrivacidade config={privacidade} equipe={equipe} />
          </div>
        </MestreDetalhe>
      </div>
    </MolduraSubpagina>
  );
}
