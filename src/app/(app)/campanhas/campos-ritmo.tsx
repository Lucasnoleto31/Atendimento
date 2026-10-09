"use client";

import { cn } from "@/lib/utils";
import {
  AJUDA,
  CAMPO,
  CAMPO_SELECT,
  ERRO_CAMPO,
  ROTULO,
} from "@/components/app/form-styles";
import {
  erroDoRitmo,
  frasePrevisao,
  numero,
  previsaoTermino,
  rotuloHora,
  type Relogio,
  type Ritmo,
} from "./regras";

/** O ritmo como a tela edita: o número por dia fica em texto enquanto a
 *  pessoa digita (vazio é um estado válido do campo, não do ritmo). */
export type RitmoEditavel = {
  porDia: string;
  horaInicio: number;
  horaFim: number;
  diasUteis: boolean;
};

export function ritmoDe(v: RitmoEditavel): Ritmo {
  return {
    porDia: Number(v.porDia.trim() || NaN),
    horaInicio: v.horaInicio,
    horaFim: v.horaFim,
    diasUteis: v.diasUteis,
  };
}

const HORAS_INICIO = Array.from({ length: 24 }, (_, h) => h);
const HORAS_FIM = Array.from({ length: 24 }, (_, h) => h + 1);

/**
 * Envios por dia, horário e dias úteis, com o que o ritmo dá: quando a fila
 * acaba e quanto as campanhas ativas somam contra o teto do número. É o
 * passo "Ritmo" da nova campanha e o editor de uma campanha existente.
 */
export function CamposRitmo({
  id,
  valor,
  aoMudar,
  mostrarErro,
  faltam,
  jaHoje,
  relogio,
  teto,
  somaOutras,
}: {
  id: string;
  valor: RitmoEditavel;
  aoMudar: (v: RitmoEditavel) => void;
  /** O erro aparece depois da primeira tentativa de seguir, não enquanto a
   *  pessoa ainda digita. */
  mostrarErro: boolean;
  /** Quantos ainda vão receber (o público elegível que falta). */
  faltam: number;
  jaHoje: number;
  relogio: Relogio;
  teto: number;
  /** Envios por dia das OUTRAS campanhas ativas. */
  somaOutras: number;
}) {
  const ritmo = ritmoDe(valor);
  const erro = erroDoRitmo(ritmo);
  const erroPorDia = erro?.startsWith("Envios") ? erro : null;
  const erroHorario = erro && !erroPorDia ? erro : null;
  const previsao = erro
    ? null
    : frasePrevisao(previsaoTermino({ ...ritmo, faltam, jaHoje }, relogio));
  const soma = somaOutras + (Number.isFinite(ritmo.porDia) ? ritmo.porDia : 0);
  const passaDoTeto = soma > teto;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-por-dia`} className={ROTULO}>
          Envios por dia
        </label>
        <input
          id={`${id}-por-dia`}
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          step={1}
          value={valor.porDia}
          onChange={(e) => aoMudar({ ...valor, porDia: e.target.value })}
          aria-invalid={mostrarErro && erroPorDia ? true : undefined}
          aria-describedby={`${id}-por-dia-ajuda`}
          className={cn(CAMPO, "w-[136px] tabular-nums")}
        />
        <p
          id={`${id}-por-dia-ajuda`}
          className={mostrarErro && erroPorDia ? ERRO_CAMPO : AJUDA}
        >
          {mostrarErro && erroPorDia
            ? erroPorDia
            : "Ritmo baixo protege a qualidade do número."}
        </p>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className={cn(ROTULO, "mb-1")}>Horário</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor={`${id}-inicio`} className="tipo-nota text-texto-2">
              Das
            </label>
            <select
              id={`${id}-inicio`}
              value={valor.horaInicio}
              onChange={(e) =>
                aoMudar({ ...valor, horaInicio: Number(e.target.value) })
              }
              className={cn(CAMPO_SELECT, "w-full tabular-nums")}
            >
              {HORAS_INICIO.map((h) => (
                <option key={h} value={h}>
                  {rotuloHora(h)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor={`${id}-fim`} className="tipo-nota text-texto-2">
              Até
            </label>
            <select
              id={`${id}-fim`}
              value={valor.horaFim}
              onChange={(e) =>
                aoMudar({ ...valor, horaFim: Number(e.target.value) })
              }
              aria-invalid={mostrarErro && erroHorario ? true : undefined}
              className={cn(CAMPO_SELECT, "w-full tabular-nums")}
            >
              {HORAS_FIM.map((h) => (
                <option key={h} value={h}>
                  {rotuloHora(h)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {mostrarErro && erroHorario ? (
          <p className={ERRO_CAMPO}>{erroHorario}</p>
        ) : null}
      </fieldset>

      <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 tipo-corpo text-tinta">
        <input
          type="checkbox"
          checked={valor.diasUteis}
          onChange={(e) => aoMudar({ ...valor, diasUteis: e.target.checked })}
          className="h-[20px] w-[20px] shrink-0"
        />
        Só de segunda a sexta
      </label>

      <div className="flex flex-col gap-0.5 rounded-painel bg-cartao px-2 py-1.5">
        <p className="tipo-nota text-texto-2 tabular-nums">
          <span className="font-semibold text-tinta">{numero(faltam)}</span>{" "}
          {faltam === 1 ? "contato na fila" : "contatos na fila"}
          {previsao ? ` · ${previsao}` : null}
        </p>
        <p className="tipo-nota text-texto-2 tabular-nums">
          Com as campanhas ativas:{" "}
          <span
            className={cn(
              "font-semibold",
              passaDoTeto ? "text-atencao" : "text-tinta",
            )}
          >
            {numero(soma)}
          </span>{" "}
          de {numero(teto)} por dia
          {passaDoTeto
            ? ". O que passar do teto fica para o dia seguinte."
            : null}
        </p>
      </div>
    </div>
  );
}
