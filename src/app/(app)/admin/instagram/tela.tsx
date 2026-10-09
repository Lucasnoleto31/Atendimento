import { contagem } from "../../configuracoes/resultado";
import {
  Grupo,
  LinhaInfo,
  TextoLinha,
  ValorLinha,
} from "../../configuracoes/ui";
import { BotaoCopiar } from "../copiar";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";
import type { EventosWebhook, VariavelInstagram } from "../webhook";

/*
 * Administração › Instagram Direct, no padrão da página de WhatsApp: o
 * estado em cima; para o admin, o endereço do webhook com Copiar, as
 * variáveis de ambiente (só o nome e se está lá) e os passos para conectar.
 * A gestão vê o estado e o último evento, com o "fale com o admin".
 *
 * Sem "use client": a página de servidor monta tudo (o Copiar é o único
 * pedaço de cliente).
 */

const FUSO = "America/Sao_Paulo";

const PARTES = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partes(data: Date) {
  const lista = PARTES.formatToParts(data);
  const pegar = (tipo: Intl.DateTimeFormatPartTypes) =>
    lista.find((p) => p.type === tipo)?.value ?? "";
  return {
    dia: `${pegar("day")}/${pegar("month")}`,
    ano: pegar("year"),
    hora: Number(pegar("hour")),
    minuto: pegar("minute"),
  };
}

/** "Hoje às 18h30", "Ontem às 9h", "07/10 às 14h05", "28/12/2025 à 1h":
 *  a hora em texto, em Brasília. */
function quandoChegou(iso: string, agora = new Date()): string {
  const quando = partes(new Date(iso));
  const hoje = partes(agora);
  const ontem = partes(new Date(agora.getTime() - 86_400_000));
  const hora = `${quando.hora}h${quando.minuto === "00" ? "" : quando.minuto}`;
  const as = quando.hora <= 1 ? "à" : "às";
  const mesmoDia = (a: typeof quando, b: typeof quando) =>
    a.dia === b.dia && a.ano === b.ano;
  if (mesmoDia(quando, hoje)) return `Hoje ${as} ${hora}`;
  if (mesmoDia(quando, ontem)) return `Ontem ${as} ${hora}`;
  const data =
    quando.ano === hoje.ano ? quando.dia : `${quando.dia}/${quando.ano}`;
  return `${data} ${as} ${hora}`;
}

/** Nome de variável ou de campo em código, quebrando depois do "_" quando
 *  não cabe (no telefone, INSTAGRAM_WEBHOOK_VERIFY_TOKEN não cabe numa
 *  linha, e cortado no meio da palavra ninguém lia). */
function Codigo({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const partes = children.split("_");
  return (
    <code className={className}>
      {partes.map((parte, i) => (
        <span key={i}>
          {parte}
          {i < partes.length - 1 ? (
            <>
              _<wbr />
            </>
          ) : null}
        </span>
      ))}
    </code>
  );
}

/** A segunda linha da variável: de onde ela vem ou o que fazer. */
function notaDaVariavel(v: VariavelInstagram): string | null {
  if (v.ok && v.pelaDoWhatsapp) return `Vale a ${v.pelaDoWhatsapp}, do WhatsApp.`;
  if (v.ok) return null;
  if (v.emBranco && v.reserva) {
    return `Está em branco no ambiente. Apague para valer a ${v.reserva}, ou preencha.`;
  }
  if (v.emBranco) return "Está em branco no ambiente. Preencha.";
  if (v.reserva) return `Ou a ${v.reserva}, se o app for o mesmo do WhatsApp.`;
  return null;
}

export function TelaInstagram({
  ehAdmin,
  configurado,
  variaveis,
  webhookUrl,
  eventos,
  voltar,
}: {
  ehAdmin: boolean;
  /** As quatro variáveis estão no ambiente (não diz se o token vale). */
  configurado: boolean;
  /** Só para o admin; null para a gestão. */
  variaveis: VariavelInstagram[] | null;
  /** O endereço completo do webhook; null para a gestão. */
  webhookUrl: string | null;
  /** O último evento e os que falharam; null sem como ler. */
  eventos: EventosWebhook | null;
  voltar: string | null;
}) {
  const faltam = variaveis ? variaveis.filter((v) => !v.ok).length : 0;
  const prontas = variaveis ? variaveis.length - faltam : 0;

  return (
    <MolduraSubpagina>
      <CabecalhoSubpagina titulo="Instagram Direct" voltar={voltar} />

      <div className="mt-3 flex max-w-[720px] flex-col gap-4">
        {/* "Configurado", não "Conectado": a tela só sabe que as variáveis
            estão no ambiente. O token vence em 60 dias e, vencido, os
            eventos continuam chegando (o webhook não usa o token): o
            último evento segue em dia e só as respostas falham. A nota
            diz isso no estado bom. */}
        <Grupo
          id="grupo-instagram"
          titulo="Conexão"
          nota={
            configurado
              ? "O token do Instagram vence a cada 60 dias. Vencido, as mensagens do Direct continuam chegando ao chat, mas as respostas não saem."
              : "Sem a conexão, as mensagens do Direct não chegam ao chat e as respostas não saem."
          }
        >
          <LinhaInfo>
            <TextoLinha
              titulo="Situação"
              apoio={
                configurado
                  ? undefined
                  : ehAdmin
                    ? faltam === 1
                      ? "Falta 1 variável de ambiente"
                      : `Faltam ${faltam.toLocaleString("pt-BR")} variáveis de ambiente`
                    : "Fale com o admin para configurar."
              }
            />
            <ValorLinha tom={configurado ? "neutro" : "atencao"}>
              {configurado ? "Configurado" : "Falta configurar"}
            </ValorLinha>
          </LinhaInfo>
          {/* A linha do último evento é a que diz se a Meta está mandando. */}
          {eventos ? (
            <LinhaInfo>
              <TextoLinha titulo="Último evento recebido" />
              <ValorLinha>
                {eventos.ultimo ? quandoChegou(eventos.ultimo) : "Nenhum"}
              </ValorLinha>
            </LinhaInfo>
          ) : null}
          {eventos && eventos.comErro > 0 ? (
            <LinhaInfo>
              <TextoLinha
                titulo="Sem gravar nas últimas 48 horas"
                apoio="O sistema tenta de novo sozinho."
              />
              <ValorLinha tom="atencao">
                {contagem(eventos.comErro, "evento", "eventos")}
              </ValorLinha>
            </LinhaInfo>
          ) : null}
        </Grupo>

        {ehAdmin && variaveis ? (
          <>
            <Grupo id="grupo-webhook-instagram" titulo="Webhook do Instagram">
              {/* O endereço inteiro, quebrando onde precisar: cortado com
                  reticências, ninguém conferia o que estava colando. */}
              <LinhaInfo>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="tipo-corpo text-tinta">Endereço</span>
                  <code className="tipo-nota break-all text-texto-2">
                    {webhookUrl}
                  </code>
                </span>
                {webhookUrl ? (
                  <BotaoCopiar
                    texto={webhookUrl}
                    rotulo="Copiar o endereço do webhook do Instagram"
                  />
                ) : null}
              </LinhaInfo>
            </Grupo>

            <Grupo
              id="grupo-variaveis-instagram"
              titulo="Variáveis de ambiente"
              direita={`${prontas.toLocaleString("pt-BR")} de ${variaveis.length.toLocaleString("pt-BR")}`}
              nota="Os valores ficam só no painel da Vercel, nunca no chat, por e-mail ou WhatsApp. Aqui aparece só o nome."
            >
              {variaveis.map((v) => {
                const nota = notaDaVariavel(v);
                return (
                  <LinhaInfo key={v.nome}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Codigo className="tipo-corpo wrap-anywhere text-tinta">
                        {v.nome}
                      </Codigo>
                      <span className="tipo-nota text-texto-2">{v.papel}</span>
                      {nota ? (
                        <span className="tipo-nota text-texto-2">{nota}</span>
                      ) : null}
                    </span>
                    <ValorLinha tom={v.ok ? "neutro" : "atencao"}>
                      {v.ok ? "Configurada" : "Falta"}
                    </ValorLinha>
                  </LinhaInfo>
                );
              })}
            </Grupo>

            <section aria-labelledby="titulo-passos-instagram">
              <div className="px-2 pb-1">
                <h2
                  id="titulo-passos-instagram"
                  className="tipo-nota tracking-[0.04em] text-texto-2 uppercase"
                >
                  Como conectar
                </h2>
              </div>
              <ol className="tipo-corpo flex list-decimal flex-col gap-1 rounded-painel bg-cartao py-2.5 pr-2.5 pl-5 text-tinta wrap-anywhere marker:text-texto-2 marker:tabular-nums">
                <li>
                  No Meta for Developers, abra o app com o produto Instagram e a
                  permissão <Codigo>instagram_business_manage_messages</Codigo>,
                  ligado à conta profissional do perfil.
                </li>
                <li>
                  Gere o token de acesso da conta e copie o ID da conta
                  profissional. O token vale 60 dias: renove antes de vencer e
                  troque no mesmo lugar.
                </li>
                <li>
                  No painel da Vercel, em Settings › Environment Variables,
                  preencha <Codigo>INSTAGRAM_TOKEN</Codigo> e{" "}
                  <Codigo>INSTAGRAM_ACCOUNT_ID</Codigo>. Se o app do Instagram não
                  for o do WhatsApp, preencha também{" "}
                  <Codigo>INSTAGRAM_APP_SECRET</Codigo> e{" "}
                  <Codigo>INSTAGRAM_WEBHOOK_VERIFY_TOKEN</Codigo>. Depois, publique
                  de novo.
                </li>
                <li>
                  Em Webhooks, no produto Instagram, cole o endereço acima e o
                  token de verificação, e assine os campos{" "}
                  <Codigo>messages</Codigo>, <Codigo>message_reactions</Codigo>,{" "}
                  <Codigo>message_edit</Codigo> e <Codigo>messaging_seen</Codigo>.
                </li>
                <li>
                  Para conferir, escreva para o perfil pelo Direct de outra
                  conta: a conversa aparece no chat e o último evento muda aqui.
                </li>
              </ol>
            </section>
          </>
        ) : null}
      </div>
    </MolduraSubpagina>
  );
}
