import { createServiceClient } from "@/lib/supabase/server";
import { agoraEmBrasilia } from "@/lib/format";
import {
  listarTemplatesMeta,
  enviarTemplateMeta,
  metaConfigurada,
} from "@/lib/whatsapp";
import { orcamentoEnviosRestante } from "@/lib/envios";

/**
 * Resumo diário do gestor (Fase 7.2): às 18h30 de dia útil, o dia da mesa
 * chega no WhatsApp de quem gerencia — contas abertas, ativações, vendas,
 * conversas esperando 24h+ e giro em risco.
 *
 * Sem cron (decisão de sempre): roda no batimento do layout, como os outros
 * motores. O que isso significa na prática: o envio sai no PRIMEIRO
 * batimento depois das 18h30 — se ninguém abrir o CRM depois desse horário,
 * o resumo daquele dia não sai (a trava é por dia; resumo velho de manhã
 * não é enviado).
 *
 * A trava é RESERVADA antes do envio e devolvida se tudo falhar: entre
 * duas lambdas frias simultâneas (o incidente de 24/08), duplicar a reserva
 * é raro e o pior caso é uma mensagem repetida — perder o dia por corrida
 * seria pior. O envio debita do orçamento único via trilha de auditoria
 * (acao resumo_gestor), que lib/envios passou a descontar.
 */

const INTERVALO_MS = 5 * 60_000;
const NOME_TEMPLATE = "resumo_diario";
const CHAVE_TRAVA = "resumo_gestor_enviado_em";

let ultimaVerificacao = 0;

export async function processarResumoGestor(): Promise<void> {
  const agora = Date.now();
  if (agora - ultimaVerificacao < INTERVALO_MS) return;
  ultimaVerificacao = agora;

  const hoje = agoraEmBrasilia();
  if (hoje.fimDeSemana) return;
  if (hoje.hora < 18 || (hoje.hora === 18 && hoje.minuto < 30)) return;
  // Sem a Meta configurada não há por onde enviar — o motor fica quieto.
  if (!metaConfigurada()) return;

  const service = createServiceClient();

  // Toda a checagem barata ANTES de reservar a trava — desligado, sem
  // destino ou sem template não podem "gastar" o dia.
  const { data: cfg } = await service
    .from("settings")
    .select("valor")
    .eq("chave", "resumo_gestor_ativo")
    .maybeSingle();
  if (Number(cfg?.valor ?? 0) !== 1) return;

  const { data: trava } = await service
    .from("settings")
    .select("valor")
    .eq("chave", CHAVE_TRAVA)
    .maybeSingle();
  const valorAnterior = (trava?.valor ?? null) as string | null;
  if (valorAnterior === hoje.dia) return; // já foi hoje

  const { data: gestores, error: erroGestores } = await service
    .from("profiles")
    .select("id, nome, whatsapp_e164")
    .eq("ativo", true)
    .in("papel", ["admin", "gestor"])
    .not("whatsapp_e164", "is", null);
  // Sem a 0057 a coluna não existe: o motor simplesmente não faz nada.
  if (erroGestores) return;
  const destinos = (gestores ?? []).filter(
    (g) => (g.whatsapp_e164 ?? "").replaceAll(/\D/g, "").length >= 10,
  );
  if (destinos.length === 0) return;

  const template = (await listarTemplatesMeta().catch(() => [])).find(
    (t) => t.nome === NOME_TEMPLATE,
  );
  if (!template) return; // ainda não aprovado na WABA

  // Template incompatível (6+ variáveis, ou parâmetros NOMEADOS — o envio
  // é posicional): todo destino falharia e o motor viraria um loop mudo de
  // retentativa até meia-noite. Melhor não tentar e deixar rastro.
  const compativel =
    template.parametros.length <= 5 &&
    template.parametros.every((t) => /^\d+$/.test(t));
  if (!compativel) {
    await registrarFalhaDoDia(service, hoje.inicioDoDia, "template_incompativel");
    return;
  }

  if ((await orcamentoEnviosRestante(service)) < destinos.length) return;

  const { data: numerosBrutos, error: erroRpc } = await service.rpc(
    "resumo_do_dia",
    { p_inicio: hoje.inicioDoDia },
  );
  if (erroRpc || !numerosBrutos) return;
  const n = numerosBrutos as {
    contas: number;
    ativacoes: number;
    vendas: number;
    aguardando_24h: number;
    giro_risco: number;
  };

  // Reserva ATÔMICA da trava — quem não conseguir gravar NÃO envia. No
  // primeiro dia a linha não existe: o insert perde para o 23505 de outra
  // lambda; nos demais, o update condicional só passa se o valor ainda for
  // o que este batimento leu (compare-and-swap; jsonb string exige o
  // JSON.stringify no filtro — testado contra o PostgREST).
  if (valorAnterior === null) {
    const { error: erroReserva } = await service.from("settings").insert({
      chave: CHAVE_TRAVA,
      valor: hoje.dia,
      atualizado_em: new Date().toISOString(),
    });
    if (erroReserva) return;
  } else {
    const { data: reservadas, error: erroReserva } = await service
      .from("settings")
      .update({ valor: hoje.dia, atualizado_em: new Date().toISOString() })
      .eq("chave", CHAVE_TRAVA)
      .eq("valor", JSON.stringify(valorAnterior))
      .select("chave");
    if (erroReserva || (reservadas ?? []).length === 0) return;
  }

  // As variáveis do template são preenchidas POR POSIÇÃO, na ordem fixa:
  // {{1}} contas · {{2}} ativações · {{3}} vendas · {{4}} aguardando 24h+
  // · {{5}} giro em risco. O template pode ter menos variáveis — sobra cai.
  const ordem = [
    String(n.contas ?? 0),
    String(n.ativacoes ?? 0),
    String(n.vendas ?? 0),
    String(n.aguardando_24h ?? 0),
    String(n.giro_risco ?? 0),
  ];
  const valores = Object.fromEntries(
    template.parametros.map((token, i) => [token, ordem[i] ?? ""]),
  );

  let enviados = 0;
  for (const gestor of destinos) {
    const para = (gestor.whatsapp_e164 ?? "").replaceAll(/\D/g, "");
    try {
      const id = await enviarTemplateMeta(para, template, valores);
      if (id) {
        enviados += 1;
        // O débito no orçamento único: lib/envios desconta estas linhas.
        // A mensagem JÁ SAIU — se o registro falhar, tenta uma segunda vez
        // (sem ele, o envio fica para sempre fora da conta do teto).
        const debito = {
          quem: gestor.id,
          acao: "resumo_gestor",
          detalhes: { para, numeros: n },
        };
        const { error: erroDebito } = await service
          .from("auditoria")
          .insert(debito);
        if (erroDebito) await service.from("auditoria").insert(debito);
      }
    } catch {
      // um destino falhou; os outros ainda recebem
    }
  }

  // Nada saiu: devolve a trava para o próximo batimento tentar de novo e
  // deixa rastro na trilha. No primeiro dia "devolver" é apagar a linha —
  // settings.valor é NOT NULL, upsert com null estouraria em silêncio.
  if (enviados === 0) {
    await registrarFalhaDoDia(service, hoje.inicioDoDia, "envio_falhou");
    if (valorAnterior === null) {
      await service.from("settings").delete().eq("chave", CHAVE_TRAVA);
    } else {
      await service
        .from("settings")
        .update({
          valor: valorAnterior,
          atualizado_em: new Date().toISOString(),
        })
        .eq("chave", CHAVE_TRAVA);
    }
  }
}

/**
 * Um registro de falha POR DIA na trilha (acao resumo_gestor_falha): o
 * gestor consegue ver por que o resumo não chegou sem o motor inundar a
 * auditoria a cada batimento. Melhor esforço — erro aqui não interrompe.
 */
async function registrarFalhaDoDia(
  service: ReturnType<typeof createServiceClient>,
  inicioDoDia: string,
  motivo: string,
): Promise<void> {
  const { count, error } = await service
    .from("auditoria")
    .select("id", { count: "exact", head: true })
    .eq("acao", "resumo_gestor_falha")
    .gte("criado_em", inicioDoDia);
  if (error || (count ?? 0) > 0) return;
  await service.from("auditoria").insert({
    quem: null,
    acao: "resumo_gestor_falha",
    detalhes: { motivo },
  });
}
