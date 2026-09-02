"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { criarCampanha } from "./actions";

export type TemplateOpcao = {
  nome: string;
  idioma: string;
  categoria: string;
  corpo: string;
  parametros: string[];
};

const CAMPO =
  "h-[40px] w-full rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-base text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500";
const ROTULO = "text-sm font-medium text-neutral-800";

function BotaoCriar() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="md" disabled={pending}>
      {pending ? "Criando…" : "Criar campanha"}
    </Button>
  );
}

/**
 * Criação da campanha. O template escolhido decide o resto do formulário:
 * cada variável do corpo vira um campo, e a prévia mostra a mensagem como
 * o lead vai receber.
 */
export function NovaCampanha({
  templates,
  etiquetas,
}: {
  templates: TemplateOpcao[];
  etiquetas: { id: string; nome: string; leads: number }[];
}) {
  const [escolhido, setEscolhido] = useState("");
  const [valores, setValores] = useState<Record<string, string>>({});
  const id = useId();

  const template = templates.find((t) => `${t.nome}|${t.idioma}` === escolhido);

  const preencher = (token: string) =>
    valores[token] ?? (template?.parametros.length === 1 ? "{nome}" : "");

  const previa = template?.corpo.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (bloco, token: string) =>
      preencher(token).replace(/\{nome\}/gi, "Fabricio") || bloco,
  );

  return (
    <form
      action={criarCampanha}
      className="rounded-lg border border-neutral-200 bg-neutral-0 p-3 shadow-sm"
    >
      <h2 className="text-h3 text-neutral-900">Nova campanha</h2>
      <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
        O público é uma etiqueta. A campanha manda o template no ritmo que você
        definir e para sozinha quando a lista acabar.
      </p>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-nome`} className={ROTULO}>
            Nome
          </label>
          <input
            id={`${id}-nome`}
            name="nome"
            type="text"
            required
            placeholder="Comunidade Instagram — agosto"
            className={CAMPO}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-etiqueta`} className={ROTULO}>
            Público (etiqueta)
          </label>
          <select
            id={`${id}-etiqueta`}
            name="etiqueta_id"
            required
            defaultValue=""
            className={CAMPO}
          >
            <option value="" disabled>
              Escolha a etiqueta…
            </option>
            {etiquetas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome} ({e.leads} lead{e.leads === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor={`${id}-template`} className={ROTULO}>
            Template aprovado
          </label>
          <select
            id={`${id}-template`}
            name="template"
            required
            value={escolhido}
            onChange={(e) => {
              setEscolhido(e.target.value);
              setValores({});
            }}
            className={CAMPO}
          >
            <option value="" disabled>
              Escolha o template…
            </option>
            {templates.map((t) => (
              <option
                key={`${t.nome}|${t.idioma}`}
                value={`${t.nome}|${t.idioma}`}
              >
                {t.nome} · {t.idioma} · {t.categoria.toLowerCase()}
              </option>
            ))}
          </select>
          {templates.length === 0 ? (
            <p className="text-xs text-warning">
              Nenhum template aprovado no canal. Aprove um na Meta antes de
              criar a campanha.
            </p>
          ) : null}
        </div>

        {template?.parametros.map((token) => (
          <div key={token} className="flex flex-col gap-1">
            <label htmlFor={`${id}-p-${token}`} className={ROTULO}>
              Variável {`{{${token}}}`}
            </label>
            <input
              id={`${id}-p-${token}`}
              name={`param_${token}`}
              type="text"
              value={preencher(token)}
              onChange={(e) =>
                setValores((v) => ({ ...v, [token]: e.target.value }))
              }
              className={CAMPO}
            />
            <p className="text-xs text-neutral-600">
              Use <code className="font-mono">{"{nome}"}</code> para o primeiro
              nome do lead.
            </p>
          </div>
        ))}

        {previa ? (
          <div className="md:col-span-2">
            <p className={ROTULO}>Prévia</p>
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-neutral-50 p-1.5 text-sm text-neutral-800">
              {previa}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-por-dia`} className={ROTULO}>
            Envios por dia
          </label>
          <input
            id={`${id}-por-dia`}
            name="por_dia"
            type="number"
            min={1}
            max={500}
            defaultValue={30}
            className={CAMPO}
          />
          <p className="text-xs text-neutral-600">
            Ritmo baixo protege a qualidade do número.
          </p>
        </div>

        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`${id}-inicio`} className={ROTULO}>
              Das
            </label>
            <input
              id={`${id}-inicio`}
              name="hora_inicio"
              type="number"
              min={0}
              max={23}
              defaultValue={9}
              className={CAMPO}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`${id}-fim`} className={ROTULO}>
              Às
            </label>
            <input
              id={`${id}-fim`}
              name="hora_fim"
              type="number"
              min={1}
              max={24}
              defaultValue={18}
              className={CAMPO}
            />
          </div>
        </div>

        <label className="flex min-h-[40px] items-center gap-1 text-sm text-neutral-800 md:col-span-2">
          <input
            name="dias_uteis"
            type="checkbox"
            defaultChecked
            className="h-[16px] w-[16px] accent-primary-600"
          />
          Só de segunda a sexta
        </label>
      </div>

      <div className="mt-2">
        <BotaoCriar />
      </div>
    </form>
  );
}
