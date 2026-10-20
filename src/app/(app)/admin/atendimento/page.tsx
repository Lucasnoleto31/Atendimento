import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { tetoDeEnvios } from "@/lib/envios";
import { cargaDaEquipe } from "@/lib/distribuicao";
import {
  CHAVE_HORARIO,
  CHAVE_RESPOSTA,
  lerHorario,
  lerResposta,
} from "@/lib/automaticas";
import { exigirGestao } from "../acesso";
import { caminhoDa } from "../rotas";
import { voltarDaSubpagina } from "../subpagina";
import { TelaAtendimento, type Pessoa } from "./tela";
import { titulo } from "@/lib/marca";

export const metadata: Metadata = { title: titulo("Atendimento") };

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await exigirGestao();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: equipe, comRodizio }, { data: parametros }] =
    await Promise.all([
      // A equipe ativa e quem está no rodízio (0041).
      supabase
        .from("profiles")
        .select("id, nome, papel, recebe_leads")
        .eq("ativo", true)
        .order("nome")
        .then((r) =>
          r.error
            ? supabase
                .from("profiles")
                .select("id, nome, papel")
                .eq("ativo", true)
                .order("nome")
                .then((r2) => ({ ...r2, comRodizio: false }))
            : { ...r, comRodizio: true },
        ),
      supabase
        .from("settings")
        .select("chave, valor")
        .in("chave", [
          "distribuicao_automatica",
          "envios_teto_dia",
          CHAVE_HORARIO,
          CHAVE_RESPOSTA.fora_do_horario,
          CHAVE_RESPOSTA.boas_vindas,
        ]),
    ]);

  const pessoas = (equipe ?? []) as Pessoa[];
  // Quantas conversas abertas cada um tem: a mesma conta que o rodízio usa
  // para escolher (lib/distribuicao.ts). Falhou, a lista sai sem o número.
  const carga = await cargaDaEquipe(
    supabase,
    pessoas.map((p) => p.id),
  ).catch(() => new Map<string, number | null>());

  const valorDe = new Map(
    ((parametros ?? []) as { chave: string; valor: unknown }[]).map((p) => [
      p.chave,
      p.valor,
    ]),
  );

  return (
    <TelaAtendimento
      ehAdmin={perfil.papel === "admin"}
      equipe={pessoas.map((p) => ({ ...p, abertas: carga.get(p.id) ?? null }))}
      comRodizio={comRodizio}
      distribuicao={Number(valorDe.get("distribuicao_automatica") ?? 0) === 1}
      teto={tetoDeEnvios(valorDe.get("envios_teto_dia"))}
      horario={lerHorario(valorDe.get(CHAVE_HORARIO))}
      respostas={{
        fora_do_horario: lerResposta(
          valorDe.get(CHAVE_RESPOSTA.fora_do_horario),
          "fora_do_horario",
        ),
        boas_vindas: lerResposta(
          valorDe.get(CHAVE_RESPOSTA.boas_vindas),
          "boas_vindas",
        ),
      }}
      voltar={voltarDaSubpagina(params.voltar, caminhoDa("atendimento"))}
    />
  );
}
