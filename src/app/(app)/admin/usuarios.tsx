"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PAPEIS, type Papel } from "@/lib/papeis";
import { ConfirmarAntes } from "../configuracoes/cancelar";
import { avisar, useEditor } from "../configuracoes/editor";
import type { ResultadoAcao } from "../configuracoes/resultado";
import { GrupoEscolha, OpcaoEscolha, TextoLinha } from "../configuracoes/ui";
import {
  corrigirUsuario,
  criarUsuario,
  resetarSenha,
  type ResultadoUsuario,
} from "./usuarios-actions";

const ESTADO: ResultadoUsuario = {};

const SENHA_SOME = "A senha some ao fechar. Fechar mesmo assim?";
const SENHA_GERANDO = "A senha está sendo gerada. Fechar mesmo assim?";

/**
 * Enquanto a senha temporária está a caminho ou na tela, o editor fica
 * travado: fechar pelo X, Esc, fundo, arrasto, abrindo outra linha ou
 * seguindo um link da lista pergunta antes. Sem isso a conta ficava com uma
 * senha que ninguém viu.
 */
function useTravaDaSenha(mostrando: boolean, gerando: boolean) {
  const travar = useEditor()?.travar;
  const motivo = gerando ? SENHA_GERANDO : mostrando ? SENHA_SOME : null;
  useEffect(() => {
    if (!motivo || !travar) return;
    travar(motivo);
    return () => travar(null);
  }, [motivo, travar]);
}

export type UsuarioLinha = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  recebe_leads?: boolean | null;
};

/** O que cada papel vê, na linha de escolha. O texto mora em lib/papeis;
 *  aqui só a pontuação da tela (vírgula no lugar do travessão). */
function detalheDoPapel(detalhe: string) {
  return detalhe.replace(/\s+—\s+/g, ", ");
}

/** As opções de papel em linhas, com o que cada um vê. */
export function OpcoesPapel({
  selecionado,
  desativado = false,
}: {
  selecionado: string;
  desativado?: boolean;
}) {
  return (
    <GrupoEscolha rotulo="Papel">
      {PAPEIS.map((p) => (
        <OpcaoEscolha
          key={p.papel}
          name="papel"
          value={p.papel}
          defaultChecked={p.papel === selecionado}
          disabled={desativado}
        >
          <TextoLinha titulo={p.rotulo} apoio={detalheDoPapel(p.detalhe)} />
        </OpcaoEscolha>
      ))}
    </GrupoEscolha>
  );
}

/**
 * A senha que acabou de ser gerada, uma única vez, com o botão de copiar:
 * ditar 12 caracteres pelo telefone é onde o erro de digitação acontece.
 */
function SenhaMostrada({ email, senha }: { email?: string; senha: string }) {
  const [copiada, setCopiada] = useState(false);
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-painel bg-cartao p-2.5"
    >
      <p className="tipo-nota text-texto-2">
        Senha de <span className="text-tinta">{email}</span>
      </p>
      <p className="tipo-titulo-3 font-codigo break-all text-tinta select-all">
        {senha}
      </p>
      <p className="tipo-nota text-texto-2">
        Anote agora: ela não aparece de novo.
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-0.5 self-start"
        onClick={() => {
          void navigator.clipboard?.writeText(senha).then(
            () => setCopiada(true),
            () => setCopiada(false),
          );
        }}
      >
        {copiada ? "Copiada" : "Copiar senha"}
      </Button>
    </div>
  );
}

/**
 * Criar usuário, dentro da folha. Deu certo, a folha mostra a senha
 * temporária e só o "Concluir" fecha direto (o resto pergunta antes); deu
 * errado, o erro fica acima do botão com o que foi digitado (o envio sai
 * pelo onSubmit, sem o reset automático do <form action>).
 */
export function NovoUsuario() {
  const editor = useEditor();
  const [estado, despachar, pendente] = useActionState(criarUsuario, ESTADO);
  useTravaDaSenha(Boolean(estado.ok && estado.senha), pendente);

  if (estado.ok && estado.senha) {
    return (
      <div className="flex flex-col gap-3">
        <p className="tipo-corpo text-tinta">Conta criada.</p>
        <SenhaMostrada email={estado.email} senha={estado.senha} />
        <Button
          type="button"
          size="lg"
          onClick={() => {
            editor?.travar(null);
            editor?.fechar();
          }}
          className="w-full lg:h-[40px] lg:w-auto lg:self-start lg:px-2 lg:text-sm"
        >
          Concluir
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pendente) return;
        const dados = new FormData(e.currentTarget);
        startTransition(() => despachar(dados));
      }}
      className="flex flex-col gap-2"
    >
      <Field
        id="novo-usuario-nome"
        name="nome"
        label="Nome"
        autoComplete="off"
        required
      />
      <Field
        id="novo-usuario-email"
        name="email"
        type="email"
        label="E-mail"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        ajuda="A senha temporária aparece aqui depois de criar."
        required
      />
      <OpcoesPapel selecionado="vendedor" />
      {estado.erro && !pendente ? (
        <p role="alert" className="tipo-nota text-erro">
          {estado.erro}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        carregando={pendente}
        className="w-full lg:h-[40px] lg:w-auto lg:self-start lg:px-2 lg:text-sm"
      >
        {pendente ? "Criando…" : "Criar usuário"}
      </Button>
    </form>
  );
}

/**
 * Nome e e-mail de alguém da equipe, para corrigir. O botão é secundário:
 * o principal do editor é o "Salvar papel". Deu certo, aviso curto e o
 * editor fica aberto e os campos remontam pela key com o valor gravado (o
 * form não remonta: o foco fica no botão); deu
 * errado, o erro fica acima do botão com o que foi digitado.
 */
export function DadosUsuario({
  id,
  nome,
  email,
}: {
  id: string;
  nome: string;
  email: string;
}) {
  const editor = useEditor();
  const formulario = useRef<HTMLFormElement>(null);
  const [estado, despachar, pendente] = useActionState(
    async (anterior: ResultadoAcao, dados: FormData) => {
      const resultado = await corrigirUsuario(anterior, dados);
      if (resultado.ok) {
        avisar(resultado.ok);
        // Gravado: fechar o editor depois não pergunta "Descartar?".
        editor?.gravou(formulario.current);
      }
      return resultado;
    },
    {},
  );

  return (
    <form
      ref={formulario}
      aria-label={`Nome e e-mail de ${nome}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (pendente) return;
        const dados = new FormData(e.currentTarget);
        startTransition(() => despachar(dados));
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <Field
        key={nome}
        id={`usuario-nome-${id}`}
        name="nome"
        label="Nome"
        defaultValue={nome}
        autoComplete="off"
        maxLength={80}
        required
      />
      <Field
        key={email}
        id={`usuario-email-${id}`}
        name="email"
        type="email"
        label="E-mail"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        defaultValue={email}
        ajuda="É com ele que a pessoa entra e recebe o código."
        required
      />
      {estado.erro && !pendente ? (
        <p role="alert" className="tipo-nota text-erro">
          {estado.erro}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        carregando={pendente}
        className="w-full lg:h-[40px] lg:w-auto lg:self-start lg:px-2 lg:text-sm"
      >
        {pendente ? "Salvando…" : "Salvar nome e e-mail"}
      </Button>
    </form>
  );
}

/** Senha nova para alguém da equipe: confirma antes (a atual morre no
 *  clique) e mostra a nova uma vez, com o editor travado enquanto ela está
 *  sendo gerada e na tela. */
export function SenhaNova({
  id,
  email,
  nome,
}: {
  id: string;
  email: string;
  nome: string;
}) {
  const [estado, acao, pendente] = useActionState(resetarSenha, ESTADO);
  useTravaDaSenha(Boolean(estado.ok && estado.senha), pendente);
  return (
    <div className="flex flex-col gap-2">
      {estado.ok && estado.senha ? (
        <SenhaMostrada email={estado.email} senha={estado.senha} />
      ) : null}
      <form action={acao}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="email" value={email} />
        <ConfirmarAntes
          tom="principal"
          texto="Gerar senha nova"
          rotulo={`Gerar senha nova para ${nome}`}
          pergunta="A senha atual deixa de valer na hora."
          confirmar="Gerar senha"
          confirmarGravando="Gerando…"
        />
      </form>
      {estado.erro ? (
        <p role="alert" className="tipo-nota text-erro">
          {estado.erro}
        </p>
      ) : null}
    </div>
  );
}
