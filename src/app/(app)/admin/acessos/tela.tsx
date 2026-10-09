import { Download } from "lucide-react";
import { classesDoBotao } from "@/components/ui/button";
import { comVoltar } from "@/app/(app)/contatos/voltar";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";
import type { LinhaLog } from "./consulta";
import { FiltrosLog, type GrupoDoFiltro } from "./filtros";
import { ListaLog } from "./lista";
import {
  parametrosDoLog,
  periodoPadrao,
  urlDoLog,
  type AvisoExportacao,
  type FiltrosLog as Filtros,
} from "./url";

/** O que a exportação deixou dito quando o CSV não saiu. */
const TEXTO_AVISO: Record<AvisoExportacao, string> = {
  grande:
    "Período grande demais para um arquivo só: o CSV leva até 50.000 registros. Divida o período pelas datas no filtro e exporte cada parte.",
  erro: "Não deu para exportar o log. Tente de novo em instantes.",
};

/*
 * O Log de acesso, separado da busca (page.tsx): o funil com os filtros
 * ligados em pílulas, a exportação com os mesmos filtros e os registros por
 * dia. É subpágina da Administração ("‹ Administração" no alto); para o
 * compliance é a entrada, e não há para onde voltar.
 *
 * Sem "use client": os filtros e a lista são as partes de cliente.
 */
export function TelaLog({
  filtros,
  rotuloPeriodo,
  linhas,
  temMais,
  pessoas,
  grupos,
  nomeDoLead,
  erro,
  avisoExportacao = null,
  hoje,
  ontem,
  raiz,
  voltar,
}: {
  filtros: Filtros;
  rotuloPeriodo: string;
  linhas: LinhaLog[];
  temMais: boolean;
  pessoas: { id: string; nome: string }[];
  grupos: GrupoDoFiltro[];
  /** O nome do contato do ?lead=; null sem ele (ou sem acesso). */
  nomeDoLead: string | null;
  erro: string | null;
  /** A exportação voltou sem CSV (período grande demais ou falha). */
  avisoExportacao?: AvisoExportacao | null;
  /** O dia de hoje e o de ontem (dd/mm/aaaa), para o nome do grupo. */
  hoje: string;
  ontem: string;
  /** É a entrada do papel (o compliance): sem o "‹ Administração". */
  raiz: boolean;
  voltar: string | null;
}) {
  const query = parametrosDoLog(filtros).toString();
  const aqui = comVoltar(urlDoLog(filtros), voltar);
  const comFiltros =
    filtros.quem.length > 0 ||
    filtros.acoes.length > 0 ||
    Boolean(filtros.contato || filtros.lead);

  return (
    <MolduraSubpagina comVolta={!raiz || Boolean(voltar)}>
      <div className="max-w-[880px]">
        <CabecalhoSubpagina
          titulo="Log de acesso"
          raiz={raiz}
          voltar={voltar}
          acoes={
            // Formulário (POST) e não link: link é pré-carregado e pode
            // vir num ?voltar= montado, e cada abertura gravaria no log
            // uma exportação que ninguém pediu.
            <form method="post" action="/admin/acessos/exportar">
              {[...parametrosDoLog(filtros).entries()].map(([nome, valor]) => (
                <input key={nome} type="hidden" name={nome} value={valor} />
              ))}
              {/* O período padrão não vai na URL; na exportação ele vai
                  escrito, para o arquivo e o registro dizerem qual foi. */}
              {periodoPadrao(filtros) ? (
                <input type="hidden" name="dias" value={filtros.dias} />
              ) : null}
              {/* Se o CSV não sair, a volta para cá guarda o ?voltar=. */}
              {voltar ? (
                <input type="hidden" name="voltar" value={voltar} />
              ) : null}
              <button
                type="submit"
                className={classesDoBotao({
                  variant: "secondary",
                  size: "sm",
                  className: "pointer-coarse:h-[44px]",
                })}
              >
                <Download size={16} strokeWidth={1.75} aria-hidden />
                Exportar CSV
              </button>
            </form>
          }
        />

        {avisoExportacao ? (
          <p
            role="alert"
            className="tipo-corpo mt-2 rounded-painel bg-cartao px-2 py-1.5 text-erro"
          >
            {TEXTO_AVISO[avisoExportacao]}
          </p>
        ) : null}

        <div className="mt-3">
          <FiltrosLog
            filtros={filtros}
            rotuloPeriodo={rotuloPeriodo}
            pessoas={pessoas}
            grupos={grupos}
            nomeDoLead={nomeDoLead}
            voltar={voltar}
          />
        </div>

        {erro ? (
          <p role="alert" className="tipo-corpo mt-3 text-erro">
            Não deu para ler o log: {erro}
          </p>
        ) : (
          <ListaLog
            // Filtro novo, lista nova: o "Carregar mais" não mistura
            // registros de dois filtros.
            key={query}
            inicial={linhas}
            temMaisInicial={temMais}
            query={query}
            periodo={rotuloPeriodo}
            hoje={hoje}
            ontem={ontem}
            aqui={aqui}
            comFiltros={comFiltros}
          />
        )}
      </div>
    </MolduraSubpagina>
  );
}
