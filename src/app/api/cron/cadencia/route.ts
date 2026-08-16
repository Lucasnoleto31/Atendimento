import { NextResponse, type NextRequest } from "next/server";
import { executarCadencia } from "@/lib/cadencia";
import { processarAgendadas } from "@/lib/agendadas";

/**
 * Gatilho da cadência de follow-up. Em produção, o cron da Vercel chama
 * a cada 15 min (vercel.json) com Authorization: Bearer CRON_SECRET.
 * Sem CRON_SECRET configurado, a rota fica fechada — a cadência ainda roda
 * pelo heartbeat do chat.
 */
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const autorizacao = request.headers.get("authorization");

  if (!segredo || autorizacao !== `Bearer ${segredo}`) {
    return new Response("Forbidden", { status: 403 });
  }

  const [resultado, agendadasEnviadas] = await Promise.all([
    executarCadencia(),
    processarAgendadas(),
  ]);
  return NextResponse.json({ ...resultado, agendadasEnviadas });
}
