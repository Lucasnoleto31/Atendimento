"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Folha, SAIDA_MS } from "./folha";
import { CamposRitmo, ritmoDe, type RitmoEditavel } from "./campos-ritmo";
import { editarRitmoCampanha } from "./actions";
import { ConfirmacaoExclusao } from "./excluir";
import { abrirCampanhaParecida, type BaseParecida } from "./nova-campanha";
import { erroDoRitmo, type Relogio, type Ritmo } from "./regras";

/** O texto que a campanha manda, montado com as variáveis gravadas, ou o
 *  porquê de não dar para montar. */
export type TextoDaCampanha =
  | { previa: string; semNome: string | null }
  | { indisponivel: string };

export type CampanhaEditavel = {
  id: string;
  nome: string;
  /** "Enviando", "Pausada", "Concluída", "Parada", "Sem público". */
  estado: string;
  concluida: boolean;
  publico: string;
  template: string;
  criadaEm: string;
  ritmo: Ritmo;
  faltam: number;
  jaHoje: number;
  /** Envios sem erro e recusas, para a confirmação de excluir dizer o que
   *  some junto. */
  recebidos: number;
  recusadas: number;
  texto: TextoDaCampanha;
};

/**
 * O editor de uma campanha (kit, bloco 8: editar é resumo em linhas, com o
 * salvar e a ação destrutiva no mesmo lugar). Público e mensagem aparecem
 * só para leitura, com o texto que está saindo (as variáveis gravadas no
 * template, ‹nome› no lugar do nome); o ritmo se edita; "Criar parecida"
 * abre uma nova campanha com tudo desta copiado (público e mensagem não
 * mudam numa campanha criada); Excluir fica por último, separado, e pede
 * confirmação no lugar com o que some junto. Concluída não tem ritmo para
 * editar.
 */
export function EditarCampanha({
  campanha,
  relogio,
  teto,
  somaOutras,
  parecida,
}: {
  campanha: CampanhaEditavel;
  relogio: Relogio;
  teto: number;
  /** Envios por dia das OUTRAS campanhas ativas. */
  somaOutras: number;
  /** O molde para "Criar parecida"; null quando não dá para criar campanha
   *  agora (sem template aprovado). */
  parecida: BaseParecida | null;
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const inicial: RitmoEditavel = {
    porDia: String(campanha.ritmo.porDia),
    horaInicio: campanha.ritmo.horaInicio,
    horaFim: campanha.ritmo.horaFim,
    diasUteis: campanha.ritmo.diasUteis,
  };
  const [ritmo, setRitmo] = useState<RitmoEditavel>(inicial);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  // Cada abertura monta a confirmação de exclusão do zero (fechada, sem o
  // erro da vez anterior).
  const [abertura, setAbertura] = useState(0);

  function abrir() {
    // Abre sempre com o que está salvo: o que ficou de uma edição
    // abandonada não volta.
    setRitmo(inicial);
    setTentou(false);
    setErro(null);
    setAbertura((n) => n + 1);
    setAberta(true);
  }

  function concluir(mensagem: string) {
    setAberta(false);
    router.replace(
      `/campanhas?ok=${encodeURIComponent(mensagem)}&t=${Date.now()}`,
      { scroll: false },
    );
  }

  function criarParecida() {
    if (!parecida) return;
    // Uma folha por vez: esta desce, devolve o foco ao Editar e solta a
    // página; só então a nova campanha sobe, e ao fechar ela devolve o foco
    // ao mesmo Editar.
    setAberta(false);
    window.setTimeout(() => abrirCampanhaParecida(parecida), SAIDA_MS + 40);
  }

  function salvar() {
    setTentou(true);
    const valido = ritmoDe(ritmo);
    if (erroDoRitmo(valido)) return;
    setErro(null);
    iniciarTransicao(async () => {
      // Rede que cai no meio vira erro acima do botão, com o ritmo ainda
      // preenchido, em vez da página de erro.
      let r: Awaited<ReturnType<typeof editarRitmoCampanha>>;
      try {
        r = await editarRitmoCampanha({ id: campanha.id, ...valido });
      } catch {
        r = {
          erro: "A conexão não respondeu. Confira a internet e tente de novo.",
        };
      }
      if ("erro" in r) return setErro(r.erro);
      concluir(r.ok);
    });
  }

  const linhas: [string, string][] = [
    ["Público", campanha.publico],
    ["Mensagem", campanha.template],
    ["Criada em", campanha.criadaEm],
  ];
  const texto = campanha.texto;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-label={`${campanha.concluida ? "Detalhes de" : "Editar"} ${campanha.nome}`}
        className="pointer-coarse:h-[44px]"
      >
        {campanha.concluida ? "Detalhes" : "Editar"}
      </Button>

      <Folha
        aberta={aberta}
        aoFechar={() => setAberta(false)}
        titulo={campanha.nome}
        apoio={campanha.estado}
        rodape={
          campanha.concluida ? null : (
            <div className="flex flex-col gap-1">
              {erro ? (
                <p role="alert" className="tipo-nota text-erro">
                  {erro}
                </p>
              ) : null}
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={salvar}
                carregando={pendente}
              >
                {pendente ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          )
        }
      >
        <ul className="overflow-hidden rounded-painel bg-cartao">
          {linhas.map(([rotulo, valor]) => (
            <li key={rotulo} className="group pl-2">
              <div className="flex min-h-[48px] items-center gap-1 border-t border-fio py-1 pr-2 group-first:border-t-0">
                <span className="w-[96px] shrink-0 tipo-corpo text-texto-2">
                  {rotulo}
                </span>
                <span className="min-w-0 flex-1 tipo-corpo break-words text-tinta tabular-nums">
                  {valor}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <section aria-labelledby={`texto-${campanha.id}`} className="mt-2">
          <h3
            id={`texto-${campanha.id}`}
            className="px-2 tipo-nota text-texto-2"
          >
            {campanha.concluida ? "Texto que saiu" : "Texto que sai"}
          </h3>
          {"previa" in texto ? (
            <>
              <p className="mt-0.5 rounded-painel bg-cartao px-2 py-1.5 tipo-corpo break-words whitespace-pre-wrap text-tinta">
                {texto.previa}
              </p>
              {texto.semNome ? (
                <p className="mt-0.5 px-2 tipo-nota text-texto-2">
                  Para quem não tem nome:{" "}
                  <span className="text-tinta">{texto.semNome}</span>
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-0.5 rounded-painel bg-cartao px-2 py-1.5 tipo-corpo text-texto-2">
              {texto.indisponivel}
            </p>
          )}
        </section>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1 px-2">
          <p className="min-w-0 flex-1 basis-[200px] tipo-nota text-texto-2">
            Público e mensagem não mudam numa campanha criada.
            {parecida ? " A parecida abre com tudo desta preenchido." : ""}
          </p>
          {parecida ? (
            <Button
              type="button"
              variant="secondary"
              onClick={criarParecida}
              aria-haspopup="dialog"
              className="pointer-coarse:h-[44px]"
            >
              Criar parecida
            </Button>
          ) : null}
        </div>

        {campanha.concluida ? null : (
          <section aria-labelledby={`ritmo-${campanha.id}`} className="mt-3">
            <h3
              id={`ritmo-${campanha.id}`}
              className="mb-1.5 tipo-titulo-3 text-tinta"
            >
              Ritmo
            </h3>
            <CamposRitmo
              id={`editar-${campanha.id}`}
              valor={ritmo}
              aoMudar={setRitmo}
              mostrarErro={tentou}
              faltam={campanha.faltam}
              jaHoje={campanha.jaHoje}
              relogio={relogio}
              teto={teto}
              somaOutras={somaOutras}
            />
          </section>
        )}

        {/* A destrutiva por último e separada (kit, bloco 7). */}
        <div className="mt-4 border-t border-fio pt-2">
          <ConfirmacaoExclusao
            key={abertura}
            campanha={{
              id: campanha.id,
              nome: campanha.nome,
              recebidos: campanha.recebidos,
              recusadas: campanha.recusadas,
              faltam: campanha.faltam,
              concluida: campanha.concluida,
            }}
            rotulo="Excluir campanha"
            aoExcluir={concluir}
          />
        </div>
      </Folha>
    </>
  );
}
