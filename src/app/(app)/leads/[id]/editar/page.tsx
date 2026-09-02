import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatarTelefone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { CAMPO } from "@/components/app/form-styles";
import { ROTULO_STATUS, type LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MOTIVOS_PERDA } from "@/lib/perda";
import { atualizarLead } from "./actions";

export const metadata: Metadata = { title: "Editar lead · Zeve CRM" };

export default async function EditarLeadPage({
  params,
  searchParams,
}: PageProps<"/leads/[id]/editar">) {
  const { id } = await params;
  const busca = await searchParams;
  const aviso = typeof busca.aviso === "string" ? busca.aviso : null;

  const supabase = await createClient();

  // Sem a migração 0038 as colunas de perda não existem; a ficha abre do
  // mesmo jeito, só sem os campos preenchidos.
  async function buscarLead() {
    const completo = await supabase
      .from("leads")
      .select(
        "id, nome, telefone_e164, channel_id, campanha, stage_id, status, responsavel_id, observacao, perda_motivo, perda_detalhe",
      )
      .eq("id", id)
      .maybeSingle();
    if (completo.error?.code !== "42703") return completo;
    const basico = await supabase
      .from("leads")
      .select(
        "id, nome, telefone_e164, channel_id, campanha, stage_id, status, responsavel_id, observacao",
      )
      .eq("id", id)
      .maybeSingle();
    return {
      data: basico.data
        ? { ...basico.data, perda_motivo: null, perda_detalhe: null }
        : null,
    };
  }

  const [{ data: lead }, { data: canais }, { data: etapas }, { data: equipe }] =
    await Promise.all([
      buscarLead(),
      supabase
        .from("channels")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome"),
      supabase
        .from("pipeline_stages")
        .select("id, nome, ordem, pipeline:pipelines(nome, criado_em)")
        .order("ordem"),
      supabase
        .from("profiles")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome"),
    ]);

  if (!lead) notFound();

  // Agrupa as etapas por kanban para o select.
  const grupos = new Map<
    string,
    { id: string; nome: string; ordem: number }[]
  >();
  for (const etapa of (etapas ?? []) as unknown as {
    id: string;
    nome: string;
    ordem: number;
    pipeline: { nome: string } | null;
  }[]) {
    const kanban = etapa.pipeline?.nome ?? "Kanban";
    if (!grupos.has(kanban)) grupos.set(kanban, []);
    grupos.get(kanban)!.push(etapa);
  }

  return (
    <div className="p-2 md:p-3">
      <Link
        href={`/leads/${lead.id}`}
        className="inline-flex items-center gap-0.5 rounded-md text-sm text-neutral-600 transition-colors duration-[120ms] hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        Ficha do lead
      </Link>

      <header className="mt-1 border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Editar lead</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          Mudar o telefone refaz o cruzamento com a base de clientes.
        </p>
      </header>

      {aviso ? (
        <p
          role="alert"
          className="mt-2 max-w-[480px] rounded-md border border-danger bg-danger-bg px-1.5 py-1 text-sm text-danger"
        >
          {aviso}
        </p>
      ) : null}

      <form
        action={atualizarLead}
        className="mt-3 flex max-w-[480px] flex-col gap-2"
      >
        <input type="hidden" name="id" value={lead.id} />

        <Field
          id="nome"
          name="nome"
          label="Nome"
          required
          defaultValue={lead.nome}
        />

        <Field
          id="telefone"
          name="telefone"
          label="Telefone (WhatsApp)"
          inputMode="tel"
          defaultValue={
            lead.telefone_e164 ? formatarTelefone(lead.telefone_e164) : ""
          }
          ajuda="Deixe vazio para remover; o vínculo com cliente é refeito ao salvar."
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="channel_id"
            className="text-sm font-medium text-neutral-800"
          >
            Canal de origem
          </label>
          <select
            id="channel_id"
            name="channel_id"
            defaultValue={lead.channel_id ?? ""}
            className={cn(CAMPO, "w-full")}
          >
            <option value="">Sem canal</option>
            {((canais ?? []) as { id: string; nome: string }[]).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>

        <Field
          id="campanha"
          name="campanha"
          label="Campanha"
          defaultValue={lead.campanha ?? ""}
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="stage_id"
            className="text-sm font-medium text-neutral-800"
          >
            Etapa
          </label>
          <select
            id="stage_id"
            name="stage_id"
            defaultValue={lead.stage_id ?? ""}
            className={cn(CAMPO, "w-full")}
          >
            {[...grupos.entries()].map(([kanban, lista]) => (
              <optgroup key={kanban} label={kanban}>
                {lista.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="status"
            className="text-sm font-medium text-neutral-800"
          >
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={lead.status}
            className={cn(CAMPO, "w-full")}
          >
            {(Object.entries(ROTULO_STATUS) as [LeadStatus, string][])
              // Ninguém usa mais o status "sem resposta" — sai da escolha,
              // mas o tipo continua no banco e em lib/types.
              .filter(([valor]) => valor !== "sem_resposta")
              .map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="perda_motivo"
            className="text-sm font-medium text-neutral-800"
          >
            Motivo da perda
          </label>
          <select
            id="perda_motivo"
            name="perda_motivo"
            defaultValue={lead.perda_motivo ?? ""}
            className={cn(CAMPO, "w-full")}
          >
            <option value="">— só para status Perdido —</option>
            {Object.entries(MOTIVOS_PERDA).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-600">
            Obrigatório ao marcar Perdido; nos outros status é ignorado.
          </p>
        </div>

        <Field
          id="perda_detalhe"
          name="perda_detalhe"
          label="Detalhe da perda (opcional)"
          defaultValue={lead.perda_detalhe ?? ""}
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="responsavel_id"
            className="text-sm font-medium text-neutral-800"
          >
            Responsável
          </label>
          <select
            id="responsavel_id"
            name="responsavel_id"
            defaultValue={lead.responsavel_id ?? ""}
            className={cn(CAMPO, "w-full")}
          >
            <option value="">Sem responsável</option>
            {((equipe ?? []) as { id: string; nome: string }[]).map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="observacao"
            className="text-sm font-medium text-neutral-800"
          >
            Observação
          </label>
          <textarea
            id="observacao"
            name="observacao"
            rows={3}
            defaultValue={lead.observacao ?? ""}
            className="rounded-md border border-neutral-300 bg-neutral-0 px-1.5 py-1 text-base text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          />
        </div>

        <div className="mt-1 flex gap-1">
          <Button type="submit" size="lg">
            Salvar alterações
          </Button>
          <Button href={`/leads/${lead.id}`} variant="secondary" size="lg">
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
