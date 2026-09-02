"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Plus, UserCheck, UserX } from "lucide-react";
import { CAMPO, BOTAO_ICONE } from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import { PAPEIS, type Papel } from "@/lib/papeis";
import {
  alternarRecebeLeads,
  alternarUsuarioAtivo,
  criarUsuario,
  mudarPapel,
  resetar2fa,
  resetarSenha,
  type ResultadoUsuario,
} from "./usuarios-actions";

const ESTADO: ResultadoUsuario = {};

export type UsuarioLinha = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  recebe_leads?: boolean | null;
};

function SenhaGerada({ estado }: { estado: ResultadoUsuario }) {
  if (estado.erro) {
    return (
      <p role="alert" className="text-xs text-danger">
        {estado.erro}
      </p>
    );
  }
  if (estado.ok && estado.senha) {
    return (
      <p
        role="status"
        className="rounded-md border border-success bg-success-bg px-1.5 py-1 text-sm text-success"
      >
        Senha de <span className="font-medium">{estado.email}</span>:{" "}
        <code className="font-mono">{estado.senha}</code> — anote agora, ela não
        aparece de novo.
      </p>
    );
  }
  return null;
}

function BotaoCriar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[40px] items-center gap-0.5 rounded-md bg-primary-600 px-2 text-sm font-medium text-neutral-0 transition-colors duration-[120ms] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Plus size={18} strokeWidth={1.5} aria-hidden />
      {pending ? "Criando…" : "Criar usuário"}
    </button>
  );
}

function ResetSenha({ usuario }: { usuario: UsuarioLinha }) {
  const [estado, formAction] = useActionState(resetarSenha, ESTADO);

  return (
    <div className="flex flex-col items-end gap-0.5">
      <form action={formAction}>
        <input type="hidden" name="id" value={usuario.id} />
        <input type="hidden" name="email" value={usuario.email} />
        <button
          type="submit"
          aria-label={`Gerar nova senha para ${usuario.nome}`}
          title="Gerar nova senha"
          className={BOTAO_ICONE}
        >
          <KeyRound size={18} strokeWidth={1.5} aria-hidden />
        </button>
      </form>
      <SenhaGerada estado={estado} />
    </div>
  );
}

export function Usuarios({
  usuarios,
  meuId,
  doisFatores = {},
}: {
  usuarios: UsuarioLinha[];
  meuId: string;
  /** id → tem segundo fator verificado (vem do admin API, fora do RLS). */
  doisFatores?: Record<string, boolean>;
}) {
  const [estadoCriar, acaoCriar] = useActionState(criarUsuario, ESTADO);

  return (
    <section className="mt-3" aria-labelledby="usuarios-titulo">
      <h2 id="usuarios-titulo" className="text-h3 text-neutral-900">
        Usuários
      </h2>
      <p className="mt-1 max-w-[68ch] text-sm text-neutral-600">
        Quem cria conta é a administração — não existe cadastro público. A senha
        temporária aparece uma única vez.
      </p>

      <div className="mt-2 flex flex-col gap-1">
        {usuarios.map((usuario) => (
          <div key={usuario.id} className="flex flex-wrap items-center gap-1">
            <span className="min-w-[180px] flex-1">
              <span className="block truncate text-sm font-medium text-neutral-800">
                {usuario.nome}
                {usuario.id === meuId ? (
                  <span className="ml-0.5 text-xs text-neutral-400">
                    (você)
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-xs text-neutral-600">
                {usuario.email}
              </span>
            </span>

            {doisFatores[usuario.id] ? (
              <span className="inline-flex h-[20px] items-center rounded-sm bg-success-bg px-1 text-xs font-medium text-success">
                2FA ativo
              </span>
            ) : (
              <span className="inline-flex h-[20px] items-center rounded-sm bg-warning-bg px-1 text-xs font-medium text-warning">
                2FA pendente
              </span>
            )}

            <form action={mudarPapel} className="flex items-center gap-1">
              <input type="hidden" name="id" value={usuario.id} />
              <label htmlFor={`papel-${usuario.id}`} className="sr-only">
                Papel de {usuario.nome}
              </label>
              <select
                id={`papel-${usuario.id}`}
                name="papel"
                defaultValue={usuario.papel}
                disabled={usuario.id === meuId}
                className={cn(CAMPO, "w-[176px]")}
              >
                {PAPEIS.map((p) => (
                  <option key={p.papel} value={p.papel}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
              {usuario.id !== meuId ? (
                <button
                  type="submit"
                  aria-label={`Salvar papel de ${usuario.nome}`}
                  className="inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-xs font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  Salvar
                </button>
              ) : null}
            </form>

            <form action={alternarUsuarioAtivo}>
              <input type="hidden" name="id" value={usuario.id} />
              <button
                type="submit"
                disabled={usuario.id === meuId}
                aria-pressed={usuario.ativo}
                aria-label={
                  usuario.ativo
                    ? `Desativar ${usuario.nome}`
                    : `Reativar ${usuario.nome}`
                }
                title={usuario.ativo ? "Desativar acesso" : "Reativar acesso"}
                className={cn(
                  "inline-flex h-[20px] items-center gap-0.5 rounded-sm px-1 text-xs transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed",
                  usuario.ativo
                    ? "bg-success-bg text-success"
                    : "bg-neutral-100 text-neutral-400",
                )}
              >
                {usuario.ativo ? (
                  <UserCheck size={12} strokeWidth={1.5} aria-hidden />
                ) : (
                  <UserX size={12} strokeWidth={1.5} aria-hidden />
                )}
                {usuario.ativo ? "ativo" : "inativo"}
              </button>
            </form>

            <form action={alternarRecebeLeads}>
              <input type="hidden" name="id" value={usuario.id} />
              <button
                type="submit"
                aria-pressed={Boolean(usuario.recebe_leads)}
                title={
                  usuario.recebe_leads
                    ? "Está no rodízio: lead novo pode cair com esta pessoa"
                    : "Fora do rodízio: não recebe lead novo automaticamente"
                }
                className={cn(
                  "inline-flex h-[20px] items-center rounded-sm px-1 text-xs transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                  usuario.recebe_leads
                    ? "bg-primary-50 text-primary-900"
                    : "bg-neutral-100 text-neutral-400",
                )}
              >
                {usuario.recebe_leads ? "no rodízio" : "fora do rodízio"}
              </button>
            </form>

            <ResetSenha usuario={usuario} />
            {doisFatores[usuario.id] && usuario.id !== meuId ? (
              <form action={resetar2fa}>
                <input type="hidden" name="id" value={usuario.id} />
                <button
                  type="submit"
                  title="Apaga o segundo fator — a pessoa cadastra de novo no próximo login"
                  className="inline-flex h-[32px] items-center rounded-md border border-neutral-300 bg-neutral-0 px-1.5 text-xs font-medium text-neutral-800 transition-colors duration-[120ms] hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                >
                  Resetar 2FA
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </div>

      <form
        action={acaoCriar}
        className="mt-2 flex flex-wrap items-center gap-1 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2"
      >
        <label htmlFor="novo-usuario-nome" className="sr-only">
          Nome do novo usuário
        </label>
        <input
          id="novo-usuario-nome"
          name="nome"
          placeholder="Nome…"
          required
          className={cn(CAMPO, "min-w-[140px] flex-1")}
        />
        <label htmlFor="novo-usuario-email" className="sr-only">
          E-mail do novo usuário
        </label>
        <input
          id="novo-usuario-email"
          name="email"
          type="email"
          placeholder="email@zeve.com.br"
          required
          className={cn(CAMPO, "min-w-[200px] flex-1")}
        />
        <label htmlFor="novo-usuario-papel" className="sr-only">
          Papel do novo usuário
        </label>
        <select
          id="novo-usuario-papel"
          name="papel"
          defaultValue="vendedor"
          className={cn(CAMPO, "w-[176px]")}
        >
          {PAPEIS.map((p) => (
            <option key={p.papel} value={p.papel}>
              {p.rotulo}
            </option>
          ))}
        </select>
        <BotaoCriar />
        <div className="w-full">
          <SenhaGerada estado={estadoCriar} />
        </div>
      </form>
    </section>
  );
}
