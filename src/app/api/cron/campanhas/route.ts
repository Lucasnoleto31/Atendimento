import { NextResponse, type NextRequest } from "next/server";
import { executarCampanhas } from "@/lib/campanhas";

/**
 * Gatilho OPCIONAL do disparo em massa. O motor já roda no batimento do
 * layout e logo depois de ativar ou editar uma campanha; esta rota só
 * funciona se um dia configurarem CRON_SECRET (e um cron externo chamando com
 * Authorization: Bearer CRON_SECRET) — sem a variável, ela fica fechada e
 * nada depende dela.
 */
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const autorizacao = request.headers.get("authorization");

  if (!segredo || autorizacao !== `Bearer ${segredo}`) {
    return new Response("Forbidden", { status: 403 });
  }

  return NextResponse.json(await executarCampanhas());
}
