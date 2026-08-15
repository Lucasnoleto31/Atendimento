import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { perfilAtual } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { CAMPO } from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import { criarLead } from "./actions";

export const metadata: Metadata = { title: "Novo lead · Zeve CRM" };

export default async function NovoLeadPage({
  searchParams,
}: PageProps<"/leads/novo">) {
  const perfil = await perfilAtual();
  const params = await searchParams;
  const aviso = typeof params.aviso === "string" ? params.aviso : null;

  const supabase = await createClient();
  const [{ data: canais }, { data: pipelines }, { data: equipe }] =
    await Promise.all([
      supabase.from("channels").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("pipelines").select("id, nome, padrao").order("criado_em"),
      supabase
        .from("profiles")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome"),
    ]);

  const kanbanPadrao =
    ((pipelines ?? []) as { id: string; padrao: boolean }[]).find((p) => p.padrao)
      ?.id ?? "";

  return (
    <div className="p-2 md:p-3">
      <Link
        href="/leads"
        className="inline-flex items-center gap-0.5 rounded-md text-sm text-neutral-600 transition-colors duration-[120ms] hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        Leads
      </Link>

      <header className="mt-1 border-b border-neutral-200 pb-2">
        <h1 className="text-h1 text-neutral-900">Novo lead</h1>
        <p className="mt-1 max-w-[68ch] text-base text-neutral-600">
          Se o telefone estiver na base de clientes, o vínculo é feito na hora.
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

      <form action={criarLead} className="mt-3 flex max-w-[480px] flex-col gap-2">
        <Field id="nome" name="nome" label="Nome" required placeholder="Nome do lead" />

        <Field
          id="telefone"
          name="telefone"
          label="Telefone (WhatsApp)"
          placeholder="11 98842-1170"
          inputMode="tel"
          ajuda="Opcional, mas é ele que cruza o lead com a base de clientes."
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="channel_id" className="text-sm font-medium text-neutral-800">
            Canal de origem
          </label>
          <select
            id="channel_id"
            name="channel_id"
            defaultValue=""
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

        <Field id="campanha" name="campanha" label="Campanha" placeholder="ex.: conta-pj-agosto" />

        <div className="flex flex-col gap-1">
          <label htmlFor="pipeline_id" className="text-sm font-medium text-neutral-800">
            Kanban
          </label>
          <select
            id="pipeline_id"
            name="pipeline_id"
            defaultValue={kanbanPadrao}
            className={cn(CAMPO, "w-full")}
          >
            {((pipelines ?? []) as { id: string; nome: string }[]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-600">
            O lead entra na primeira etapa do kanban escolhido.
          </p>
        </div>

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
            defaultValue={perfil?.id ?? ""}
            className={cn(CAMPO, "w-full")}
          >
            {((equipe ?? []) as { id: string; nome: string }[]).map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="observacao" className="text-sm font-medium text-neutral-800">
            Observação
          </label>
          <textarea
            id="observacao"
            name="observacao"
            rows={3}
            placeholder="Contexto do contato…"
            className="rounded-md border border-neutral-300 bg-neutral-0 px-1.5 py-1 text-base text-neutral-800 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          />
        </div>

        <div className="mt-1 flex gap-1">
          <Button type="submit" size="lg">
            Cadastrar lead
          </Button>
          <Button href="/leads" variant="secondary" size="lg">
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
