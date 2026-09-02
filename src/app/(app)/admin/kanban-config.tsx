import { ArrowDown, ArrowUp, Check, Plus, Star, Trash2 } from "lucide-react";
import {
  alternarEtapaFinal,
  criarEtapa,
  criarKanban,
  definirKanbanPadrao,
  excluirEtapa,
  excluirKanban,
  moverEtapa,
  definirPrazoEtapa,
  renomearEtapa,
  renomearKanban,
} from "./kanban-actions";
import { cn } from "@/lib/utils";

export type PipelineComEtapas = {
  id: string;
  nome: string;
  padrao: boolean;
  etapas: {
    id: string;
    nome: string;
    ordem: number;
    is_final: boolean;
    prazo_dias?: number | null;
    leads: number;
  }[];
};

const CAMPO =
  "h-[40px] rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-sm text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";

const BOTAO_ICONE =
  "inline-flex h-[40px] w-[40px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent";

export function KanbanConfig({
  pipelines,
}: {
  pipelines: PipelineComEtapas[];
}) {
  return (
    <section className="mt-3" aria-labelledby="kanbans-titulo">
      <h2 id="kanbans-titulo" className="text-h3 text-neutral-900">
        Kanbans
      </h2>
      <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
        Cada kanban tem as próprias etapas. O marcado como padrão abre primeiro
        no Atendimento e recebe os leads da reativação. Etapa com leads não pode
        ser excluída — mova os leads antes.
      </p>

      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        {pipelines.map((pipeline) => (
          <article
            key={pipeline.id}
            className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
          >
            <header className="flex items-center gap-1">
              <form
                action={renomearKanban}
                className="flex flex-1 items-center gap-1"
              >
                <input type="hidden" name="id" value={pipeline.id} />
                <label htmlFor={`kanban-${pipeline.id}`} className="sr-only">
                  Nome do kanban
                </label>
                <input
                  id={`kanban-${pipeline.id}`}
                  name="nome"
                  defaultValue={pipeline.nome}
                  required
                  className={cn(CAMPO, "flex-1 font-medium")}
                />
                <button
                  type="submit"
                  aria-label={`Salvar nome do kanban ${pipeline.nome}`}
                  className={BOTAO_ICONE}
                >
                  <Check size={18} strokeWidth={1.5} aria-hidden />
                </button>
              </form>

              {pipeline.padrao ? (
                <span className="inline-flex h-[20px] shrink-0 items-center gap-0.5 rounded-sm bg-primary-50 px-1 text-xs text-primary-900">
                  <Star size={12} strokeWidth={1.5} aria-hidden />
                  padrão
                </span>
              ) : (
                <form action={definirKanbanPadrao}>
                  <input type="hidden" name="id" value={pipeline.id} />
                  <button
                    type="submit"
                    aria-label={`Definir ${pipeline.nome} como padrão`}
                    title="Definir como padrão"
                    className={BOTAO_ICONE}
                  >
                    <Star size={18} strokeWidth={1.5} aria-hidden />
                  </button>
                </form>
              )}

              <form action={excluirKanban}>
                <input type="hidden" name="id" value={pipeline.id} />
                <button
                  type="submit"
                  aria-label={`Excluir kanban ${pipeline.nome}`}
                  disabled={pipeline.padrao}
                  title={
                    pipeline.padrao
                      ? "O kanban padrão não pode ser excluído"
                      : "Excluir kanban"
                  }
                  className={cn(
                    BOTAO_ICONE,
                    "hover:bg-danger-bg hover:text-danger",
                  )}
                >
                  <Trash2 size={18} strokeWidth={1.5} aria-hidden />
                </button>
              </form>
            </header>

            <ol className="mt-2 flex flex-col gap-1">
              {pipeline.etapas.map((etapa, i) => (
                // flex-wrap: em 375px os botões descem para a segunda linha em
                // vez de esmagar o campo de nome até sumir.
                <li
                  key={etapa.id}
                  className="flex flex-wrap items-center gap-1"
                >
                  <span className="w-2 shrink-0 text-right font-mono text-xs text-neutral-400 tabular-nums">
                    {etapa.ordem}
                  </span>

                  <form
                    action={renomearEtapa}
                    className="flex min-w-[180px] flex-1 items-center gap-1"
                  >
                    <input type="hidden" name="id" value={etapa.id} />
                    <label htmlFor={`etapa-${etapa.id}`} className="sr-only">
                      Nome da etapa
                    </label>
                    <input
                      id={`etapa-${etapa.id}`}
                      name="nome"
                      defaultValue={etapa.nome}
                      required
                      className={cn(CAMPO, "min-w-0 flex-1")}
                    />
                    <button
                      type="submit"
                      aria-label={`Salvar nome da etapa ${etapa.nome}`}
                      className={BOTAO_ICONE}
                    >
                      <Check size={18} strokeWidth={1.5} aria-hidden />
                    </button>
                  </form>

                  <form
                    action={definirPrazoEtapa}
                    className="flex items-center gap-0.5"
                  >
                    <input type="hidden" name="id" value={etapa.id} />
                    <label
                      htmlFor={`prazo-${etapa.id}`}
                      className="text-xs text-neutral-600"
                      title="Prazo esperado nesta etapa. Estourou fica laranja; o dobro, vermelho. Vazio = 7 dias."
                    >
                      prazo
                    </label>
                    <input
                      id={`prazo-${etapa.id}`}
                      name="prazo"
                      type="number"
                      min={1}
                      max={365}
                      placeholder="7"
                      defaultValue={etapa.prazo_dias ?? ""}
                      className="h-[32px] w-[56px] rounded-md border border-neutral-300 bg-neutral-0 px-1 text-right font-mono text-xs text-neutral-800 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                    />
                    <span className="text-xs text-neutral-400">d</span>
                    <button
                      type="submit"
                      aria-label={`Salvar prazo de ${etapa.nome}`}
                      className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-md text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                    >
                      <Check size={14} strokeWidth={1.5} aria-hidden />
                    </button>
                  </form>

                  <span className="shrink-0 font-mono text-xs text-neutral-400 tabular-nums">
                    {etapa.leads}
                  </span>

                  <form action={alternarEtapaFinal}>
                    <input type="hidden" name="id" value={etapa.id} />
                    <button
                      type="submit"
                      aria-pressed={etapa.is_final}
                      title="Etapa final conta como encerramento (ganho/perda) nos relatórios"
                      className={cn(
                        "inline-flex h-[20px] shrink-0 items-center rounded-sm px-1 text-xs transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                        etapa.is_final
                          ? "bg-neutral-800 text-neutral-0"
                          : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
                      )}
                    >
                      final
                    </button>
                  </form>

                  <form action={moverEtapa} className="flex shrink-0">
                    <input type="hidden" name="id" value={etapa.id} />
                    <input type="hidden" name="direcao" value="-1" />
                    <button
                      type="submit"
                      aria-label={`Subir etapa ${etapa.nome}`}
                      disabled={i === 0}
                      className={BOTAO_ICONE}
                    >
                      <ArrowUp size={18} strokeWidth={1.5} aria-hidden />
                    </button>
                  </form>
                  <form action={moverEtapa} className="flex shrink-0">
                    <input type="hidden" name="id" value={etapa.id} />
                    <input type="hidden" name="direcao" value="1" />
                    <button
                      type="submit"
                      aria-label={`Descer etapa ${etapa.nome}`}
                      disabled={i === pipeline.etapas.length - 1}
                      className={BOTAO_ICONE}
                    >
                      <ArrowDown size={18} strokeWidth={1.5} aria-hidden />
                    </button>
                  </form>

                  <form action={excluirEtapa} className="flex shrink-0">
                    <input type="hidden" name="id" value={etapa.id} />
                    <button
                      type="submit"
                      aria-label={`Excluir etapa ${etapa.nome}`}
                      disabled={etapa.leads > 0 || pipeline.etapas.length <= 1}
                      title={
                        etapa.leads > 0
                          ? `${etapa.leads} lead(s) nesta etapa — mova antes de excluir`
                          : pipeline.etapas.length <= 1
                            ? "O kanban precisa de pelo menos uma etapa"
                            : "Excluir etapa"
                      }
                      className={cn(
                        BOTAO_ICONE,
                        "hover:bg-danger-bg hover:text-danger",
                      )}
                    >
                      <Trash2 size={18} strokeWidth={1.5} aria-hidden />
                    </button>
                  </form>
                </li>
              ))}
            </ol>

            <form action={criarEtapa} className="mt-2 flex items-center gap-1">
              <input type="hidden" name="pipeline_id" value={pipeline.id} />
              <label htmlFor={`nova-etapa-${pipeline.id}`} className="sr-only">
                Nome da nova etapa
              </label>
              <input
                id={`nova-etapa-${pipeline.id}`}
                name="nome"
                placeholder="Nova etapa…"
                required
                className={cn(CAMPO, "flex-1")}
              />
              <button
                type="submit"
                aria-label={`Adicionar etapa ao kanban ${pipeline.nome}`}
                className={BOTAO_ICONE}
              >
                <Plus size={18} strokeWidth={1.5} aria-hidden />
              </button>
            </form>
          </article>
        ))}

        <form
          action={criarKanban}
          className="flex h-fit items-center gap-1 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3"
        >
          <label htmlFor="novo-kanban" className="sr-only">
            Nome do novo kanban
          </label>
          <input
            id="novo-kanban"
            name="nome"
            placeholder="Novo kanban… (ex.: Reativação)"
            required
            className={cn(CAMPO, "flex-1")}
          />
          <button
            type="submit"
            aria-label="Criar kanban"
            className={BOTAO_ICONE}
          >
            <Plus size={18} strokeWidth={1.5} aria-hidden />
          </button>
        </form>
      </div>
    </section>
  );
}
