"use client";

import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { CampoSenha } from "@/app/entrar/campo-senha";
import { avisar, useEditor } from "../configuracoes/editor";
import { trocarSenha, type EstadoSenha } from "./actions";

const ESTADO: EstadoSenha = {};

/**
 * Trocar a própria senha, dentro do editor (folha no celular, painel no
 * desktop). Deu certo: aviso curto e o editor fecha. Deu errado: o erro de
 * cada campo fica embaixo dele e o resto acima do botão, com tudo o que foi
 * digitado (o envio sai pelo onSubmit, sem o reset automático do
 * <form action>). method="post": antes da hidratação, o envio nativo sem
 * method seria um GET com as senhas na URL.
 */
export function FormSenha({ email }: { email: string }) {
  const editor = useEditor();
  const [estado, despachar, pendente] = useActionState(
    async (anterior: EstadoSenha, dados: FormData) => {
      const resultado = await trocarSenha(anterior, dados);
      if (resultado.ok) {
        avisar(resultado.ok);
        // Gravou e fecha (com ?voltar=, volta à origem), sem o "Descartar?".
        editor?.concluir();
      }
      return resultado;
    },
    ESTADO,
  );
  const erros = pendente ? {} : (estado.erros ?? {});

  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        if (pendente) return;
        const dados = new FormData(e.currentTarget);
        startTransition(() => despachar(dados));
      }}
      className="flex flex-col gap-2"
    >
      {/* O e-mail da conta, escondido, para o gerenciador de senhas saber
          de qual conta é a senha nova. Sem name: não vai no envio. */}
      <input
        type="email"
        autoComplete="username"
        value={email}
        readOnly
        hidden
      />
      <CampoSenha
        id="conta-senha-atual"
        name="atual"
        label="Senha atual"
        autoComplete="current-password"
        required
        maxLength={72}
        erro={erros.atual}
      />
      <CampoSenha
        id="conta-senha-nova"
        name="nova"
        label="Nova senha"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={72}
        ajuda="Mínimo de 8 caracteres. Os outros aparelhos saem da conta."
        erro={erros.nova}
      />
      <CampoSenha
        id="conta-senha-confirmacao"
        name="confirmacao"
        label="Repita a nova senha"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={72}
        erro={erros.confirmacao}
      />
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
        {pendente ? "Trocando…" : "Trocar senha"}
      </Button>
    </form>
  );
}
