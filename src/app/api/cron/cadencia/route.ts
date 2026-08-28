import { NextResponse, type NextRequest } from "next/server";
import { executarCadencia } from "@/lib/cadencia";
import { processarAgendadas } from "@/lib/agendadas";
import { executarCampanhas } from "@/lib/campanhas";

/**
 * Gatilho OPCIONAL da cadência de follow-up. O caminho normal é o batimento
 * do layout, que roda cadência, agendadas e campanhas enquanto alguém usa o
 * CRM. Esta rota só funciona se um dia configurarem CRON_SECRET (e um cron
 * externo chamando com Authorization: Bearer CRON_SECRET) — sem a variável,
 * ela fica fechada e nada depende dela.
 */
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const autorizacao = request.headers.get("authorization");

  if (!segredo || autorizacao !== `Bearer ${segredo}`) {
    return new Response("Forbidden", { status: 403 });
  }

  const [resultado, agendadasEnviadas, campanhas] = await Promise.all([
    executarCadencia(),
    processarAgendadas(),
    executarCampanhas(),
  ]);
  return NextResponse.json({ ...resultado, agendadasEnviadas, campanhas });
}
