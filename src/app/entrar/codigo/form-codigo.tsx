"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  confirmarCodigo,
  enviarCodigo,
  type EstadoConfirmacao,
  type EstadoEnvio,
} from "./actions";
import { semReset, useIrPara } from "../form-acao";
import {
  BOTAO_CINZA,
  BOTAO_ESPERA_PREENCHER,
  CAIXA_AVISO,
  CAIXA_ERRO,
  CAMPO_CODIGO,
  LINK_DISCRETO,
  ROTULO_LINHA,
} from "../estilos";

/**
 * Relógio da espera do "Reenviar": quantos ms se passaram desde que a tela
 * montou, de segundo em segundo. A conta nunca compara o relógio do
 * aparelho com o do servidor: o servidor manda quanto falta e a tela conta
 * a partir de quando a resposta chegou, neste eixo. performance.now()
 * porque só importa o tempo decorrido, e ele não pula se alguém acertar o
 * relógio do aparelho no meio da espera.
 *
 * No servidor e na hidratação vale null (o botão nasce travado, sem número):
 * um número no render daria texto diferente entre servidor e navegador.
 */
function criarRelogio() {
  let inicio: number | null = null;
  let decorrido: number | null = null;
  const medir = () => (inicio === null ? 0 : performance.now() - inicio);
  return {
    assinar(avisar: () => void) {
      inicio ??= performance.now();
      const marcar = () => {
        decorrido = medir();
        avisar();
      };
      marcar();
      const id = window.setInterval(marcar, 1000);
      return () => window.clearInterval(id);
    },
    ler: () => decorrido,
    lerNoServidor: (): number | null => null,
    /** O agora no mesmo eixo de ler(), para carimbar a chegada de respostas. */
    agora: medir,
  };
}

/**
 * Ordem de chegada das respostas, contando envio e confirmação juntos: é o
 * que diz qual das duas falou por último sobre o código pendente.
 */
let chegadas = 0;

type EnvioNaTela = EstadoEnvio & {
  /** Quando a resposta chegou, no eixo do relógio da tela (0 = montagem). */
  recebidoEm: number;
  ordem: number;
};

type ConfirmacaoNaTela = EstadoConfirmacao & { ordem: number };

export function FormCodigo({
  email,
  temCodigo: temCodigoInicial,
  restanteMs,
  falha,
  proximo,
}: {
  email: string;
  /** Há código pendente quando a página abriu. */
  temCodigo: boolean;
  /** Quanto faltava para liberar o "Reenviar" quando a página foi montada
   *  no servidor; conta a partir da montagem no navegador. */
  restanteMs: number;
  /** Por que o código do login não saiu, se não saiu. */
  falha?: string;
  proximo: string;
}) {
  const [relogio] = useState(criarRelogio);
  const decorrido = useSyncExternalStore(
    relogio.assinar,
    relogio.ler,
    relogio.lerNoServidor,
  );

  const [envio, enviar, enviando] = useActionState<EnvioNaTela>(
    async () => {
      const resposta = await enviarCodigo(proximo);
      return { ...resposta, recebidoEm: relogio.agora(), ordem: ++chegadas };
    },
    {
      temCodigo: temCodigoInicial,
      restanteMs,
      erro: falha,
      recebidoEm: 0,
      ordem: 0,
    },
  );
  const [confirmacao, confirmar, confirmando] = useActionState<
    ConfirmacaoNaTela,
    FormData
  >(
    async (_anterior, dados) => ({
      ...(await confirmarCodigo(dados)),
      ordem: ++chegadas,
    }),
    { ordem: 0 },
  );
  const [codigo, setCodigo] = useState("");
  // Depois de pedir outro código, o erro do código anterior sai da tela.
  const [mostrarErroCodigo, setMostrarErroCodigo] = useState(true);
  const campoRef = useRef<HTMLInputElement>(null);
  const enviarRef = useRef<HTMLButtonElement>(null);

  const destino = confirmacao.ir ?? envio.ir;
  useIrPara(destino);

  // O ?falha= do login já está guardado no estado inicial do envio: sai da
  // barra assim que a tela monta. Ficando lá, recarregar depois de o código
  // morrer na conferência (venceu, ou o freio apagou) traria de volta um
  // motivo que já não vale. No setTimeout porque o efeito do filho roda
  // antes do efeito do App Router que intercepta o replaceState: chamado
  // antes disso, o router não fica sabendo e devolve o ?falha= na próxima
  // atualização dele.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("falha")) return;
      url.searchParams.delete("falha");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const destinatario = email || "o seu e-mail";
  // Confirmação que chegou depois do último envio e disse que o código
  // morreu (venceu, ou o freio apagou depois de "Muitas tentativas"): a tela
  // volta ao "Enviar código". Um envio novo que dê certo traz o campo de volta.
  const codigoMorto =
    confirmacao.semCodigo === true && confirmacao.ordem > envio.ordem;
  const temCodigo = envio.temCodigo && !codigoMorto;

  // O foco não cai no body. Código morto: o form com o campo e o botão
  // focados sai da tela, e o foco vai para o "Enviar código" que entra no
  // lugar dele.
  useEffect(() => {
    if (codigoMorto) enviarRef.current?.focus();
  }, [codigoMorto]);

  // Resposta de envio: o botão que pediu ficou desabilitado enquanto enviava,
  // e o navegador tira o foco de botão desabilitado. Deu certo: o foco vai
  // para o campo, já esvaziado e pronto para o código novo. Não há código
  // pendente (o envio falhou): volta para o "Enviar código".
  useEffect(() => {
    if (envio.ordem === 0) return;
    if (!envio.temCodigo) enviarRef.current?.focus();
    else if (envio.aviso) campoRef.current?.focus();
  }, [envio]);

  const espera =
    decorrido === null
      ? null
      : Math.max(
          0,
          Math.ceil((envio.recebidoEm + envio.restanteMs - decorrido) / 1000),
        );
  const reenvioTravado = enviando || espera === null || espera > 0;

  const pedirCodigo = () => {
    setMostrarErroCodigo(false);
    setCodigo("");
    startTransition(() => enviar());
  };

  const erroCodigo = mostrarErroCodigo ? confirmacao.erro : undefined;
  // O erro ou o aviso do envio só aparece se o envio for a resposta mais
  // nova: depois de "Muitas tentativas" ou "Este código venceu", o "Código
  // enviado para…" de antes desmentiria a tela. Na montagem as duas ordens
  // são 0, e vale o ?falha= do login.
  const envioFala = envio.ordem >= confirmacao.ordem;

  return (
    <div className="flex flex-col gap-3">
      {temCodigo ? (
        // method="post": envio antes da hidratação não põe o código na URL
        // (ver semReset).
        <form
          method="post"
          onSubmit={(e) => {
            setMostrarErroCodigo(true);
            semReset(confirmar)(e);
          }}
          className="group/form flex flex-col gap-3"
        >
          <p className="tipo-corpo text-texto-2">
            Mandamos um código de 6 dígitos para{" "}
            <span className="break-all text-tinta">{destinatario}</span>. Ele
            vale por 10 minutos.
          </p>

          <input type="hidden" name="proximo" value={proximo} />
          {/* Rótulo, campo e erro juntos; o grupo se afasta do resto pelos
              24px do formulário. */}
          <div className="flex flex-col gap-0.5">
            <label htmlFor="codigo-acesso" className={ROTULO_LINHA}>
              Código de acesso
            </label>
            <input
              ref={campoRef}
              id="codigo-acesso"
              name="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={codigo}
              // Colar "123 456" ou "123-456" do e-mail vira "123456". Sem
              // maxLength no campo: ele cortaria o texto colado antes de limpar.
              onChange={(e) =>
                setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              aria-invalid={erroCodigo ? true : undefined}
              aria-describedby={erroCodigo ? "codigo-acesso-erro" : undefined}
              data-texto-grande=""
              className={CAMPO_CODIGO}
            />
            {erroCodigo ? (
              <p
                id="codigo-acesso-erro"
                role="alert"
                className={cn(CAIXA_ERRO, "mt-1")}
              >
                {erroCodigo}
              </p>
            ) : null}
          </div>

          {/* Cinza até os 6 dígitos, e não só com o campo vazio. */}
          <Button
            type="submit"
            size="lg"
            disabled={confirmando || Boolean(confirmacao.ir)}
            className={cn(
              "mt-1 w-full",
              BOTAO_ESPERA_PREENCHER,
              codigo.length < 6 && BOTAO_CINZA,
            )}
          >
            {confirmando || confirmacao.ir ? "Confirmando…" : "Entrar"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="tipo-corpo text-texto-2">
            Para entrar neste aparelho, digite o código que vamos mandar para{" "}
            <span className="break-all text-tinta">{destinatario}</span>.
          </p>
          {erroCodigo ? (
            <p role="alert" className={CAIXA_ERRO}>
              {erroCodigo}
            </p>
          ) : null}
          <Button
            ref={enviarRef}
            type="button"
            size="lg"
            onClick={pedirCodigo}
            disabled={enviando}
            className="w-full"
          >
            {enviando ? "Enviando…" : "Enviar código"}
          </Button>
        </div>
      )}

      {!envioFala ? null : envio.erro ? (
        <p role="alert" className={CAIXA_ERRO}>
          {envio.erro}
        </p>
      ) : envio.aviso ? (
        <p role="status" className={CAIXA_AVISO}>
          {envio.aviso}
        </p>
      ) : null}

      {/* O "Entrar com outra conta" mora acima do título (page.tsx): no
          celular, o teclado do campo cobre o que fica aqui embaixo. */}
      {temCodigo ? (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={pedirCodigo}
            disabled={reenvioTravado}
            className={LINK_DISCRETO}
          >
            {enviando
              ? "Enviando…"
              : espera
                ? `Reenviar em ${espera} s`
                : "Reenviar código"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
