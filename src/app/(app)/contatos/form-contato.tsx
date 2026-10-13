"use client";

import { useActionState, useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { semReset } from "@/app/entrar/form-acao";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  AJUDA,
  AREA_TEXTO,
  CAMPO_SELECT,
  ROTULO,
} from "@/components/app/form-styles";
import { cn } from "@/lib/utils";
import { criarContato } from "./novo/actions";
import { atualizarContato } from "./[id]/editar/actions";
import type { EstadoFormContato } from "./form-estado";
import { useVoltarPeloHistorico } from "./rastro";
import { carregarCargaEquipe } from "../conversas/lista";

/** Uma pessoa do select de responsável. */
type Opcao = { id: string; nome: string };

/** "12 abertas", "1 aberta". */
function textoCarga(n: number): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? "aberta" : "abertas"}`;
}

/**
 * O formulário do contato, no cadastro e na edição. A action vem daqui e não
 * por prop (componente de servidor não passa função para o cliente).
 *
 * Gravar fecha a tela só depois de gravar. Se falhar, o erro aparece com
 * tudo o que foi digitado ainda nos campos (kit, bloco 8): o envio passa
 * pelo onSubmit (semReset) porque o action={} do React 19 esvazia o
 * formulário depois de toda action, até a que volta com erro. Erro de um
 * campo só vai embaixo dele, e o foco vai junto.
 *
 * O Cancelar volta pelo histórico quando a entrada anterior é o destino
 * dele (rastro.ts), como o "←" do topo: a lista reaparece onde estava.
 */
export function FormContato({
  modo,
  valores,
  ocultos,
  responsaveis,
  responsavelFixo,
  foco,
  cancelar,
}: {
  modo: "novo" | "editar";
  valores: {
    nome: string;
    telefone: string;
    email: string;
    responsavelId: string;
    observacao: string;
  };
  /** Campos escondidos que a action lê (id, voltar). */
  ocultos: Record<string, string>;
  /** Sem lista, o responsável não se escolhe aqui (a action decide). */
  responsaveis: { opcoes: Opcao[]; semDono: boolean } | null;
  /** Sem lista na edição: o responsável aparece como texto, e o
   *  formulário não manda o campo (a action não mexe no dono). A troca é
   *  pelo "Trocar" da ficha, que deixa a linha no histórico da conversa. */
  responsavelFixo?: { nome: string | null; ajuda?: string };
  /** O campo que recebe o foco ao abrir: o que ficou vazio quando o
   *  cadastro vem da busca com o outro já preenchido. */
  foco?: "nome" | "telefone";
  cancelar: string;
}) {
  const voltar = useVoltarPeloHistorico(cancelar);

  // A carga de cada pessoa no select ("Ana (12 abertas)"), para a gestão,
  // que é quem escolhe o responsável. Lida no navegador depois que a página
  // abre, como no menu do chat: antes o Editar e o Novo esperavam as
  // contagens da equipe inteira para sair. Sem a carga (ainda não chegou,
  // ou falhou), o select mostra só os nomes.
  const escolhe = responsaveis !== null;
  const [carga, setCarga] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!escolhe) return;
    let vale = true;
    carregarCargaEquipe()
      .then((r) => {
        if (vale && "equipe" in r) {
          setCarga(new Map(r.equipe.map((p) => [p.id, p.abertas])));
        }
      })
      .catch(() => {
        // Sem a carga, o select segue com os nomes.
      });
    return () => {
      vale = false;
    };
  }, [escolhe]);

  // Começa sem erro. O ?aviso= da URL não entra aqui: era texto livre, e
  // um link de fora conseguia pôr qualquer frase no lugar do erro do sistema.
  const [estado, executar, pendente] = useActionState<
    EstadoFormContato,
    FormData
  >(modo === "novo" ? criarContato : atualizarContato, {
    erro: null,
    campo: null,
    vez: 0,
  });

  // O foco vai ao campo com problema a cada envio que falha nele.
  useEffect(() => {
    if (estado.vez > 0 && estado.campo) {
      document.getElementById(estado.campo)?.focus();
    }
  }, [estado.vez, estado.campo]);

  const erroDe = (campo: EstadoFormContato["campo"]) =>
    estado.campo === campo ? (estado.erro ?? undefined) : undefined;

  return (
    // method="post": antes da hidratação o envio é o nativo do navegador, e
    // sem method ele viraria GET com os dados do contato na URL.
    <form
      method="post"
      onSubmit={semReset(executar)}
      className="flex max-w-[560px] flex-col gap-2"
    >
      {Object.entries(ocultos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}

      <Field
        id="nome"
        name="nome"
        label="Nome"
        required
        autoComplete="off"
        autoCapitalize="words"
        defaultValue={valores.nome}
        // Só quando a pessoa veio da busca e tocou em "Cadastrar": o
        // teclado abrir aqui é o que ela pediu.
        autoFocus={foco === "nome"}
        erro={erroDe("nome")}
      />

      <Field
        id="telefone"
        name="telefone"
        label="Telefone (WhatsApp)"
        inputMode="tel"
        autoComplete="off"
        placeholder={modo === "novo" ? "11 98842-1170" : undefined}
        defaultValue={valores.telefone}
        autoFocus={foco === "telefone"}
        className="tabular-nums"
        ajuda={
          modo === "novo"
            ? "Com DDD. Se o número já estiver na base, a ficha existente abre. De fora do Brasil, comece com + e o código do país."
            : "Deixe vazio para remover. De fora do Brasil, comece com + e o código do país."
        }
        erro={erroDe("telefone")}
      />

      <Field
        id="email"
        name="email"
        type="email"
        label="E-mail"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={modo === "novo" ? "nome@empresa.com" : undefined}
        defaultValue={valores.email}
        erro={erroDe("email")}
      />

      {responsaveis ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="responsavel_id" className={ROTULO}>
            Responsável
          </label>
          <select
            id="responsavel_id"
            name="responsavel_id"
            defaultValue={valores.responsavelId}
            className={cn(CAMPO_SELECT, "w-full")}
          >
            {responsaveis.semDono ? <option value="">Sem dono</option> : null}
            {responsaveis.opcoes.map((p) => {
              const n = carga?.get(p.id);
              return (
                <option key={p.id} value={p.id}>
                  {n === undefined ? p.nome : `${p.nome} (${textoCarga(n)})`}
                </option>
              );
            })}
          </select>
        </div>
      ) : responsavelFixo ? (
        <div className="flex flex-col gap-1">
          <p className={ROTULO}>Responsável</p>
          <p className="tipo-corpo text-tinta">
            {responsavelFixo.nome ?? (
              <span className="text-atencao">Sem dono</span>
            )}
          </p>
          {responsavelFixo.ajuda ? (
            <p className={AJUDA}>{responsavelFixo.ajuda}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="observacao" className={ROTULO}>
          Observação
        </label>
        <textarea
          id="observacao"
          name="observacao"
          rows={3}
          defaultValue={valores.observacao}
          placeholder={
            modo === "novo"
              ? "Ex.: veio por indicação, prefere falar à tarde"
              : undefined
          }
          className={AREA_TEXTO}
        />
      </div>

      {estado.erro && !estado.campo ? (
        <p
          role="alert"
          className="flex items-start gap-1 rounded-painel bg-cartao p-2 tipo-corpo text-erro"
        >
          <CircleAlert
            size={20}
            strokeWidth={1.75}
            aria-hidden
            className="mt-px shrink-0"
          />
          {estado.erro}
        </p>
      ) : null}

      <div className="mt-1 grid grid-cols-2 gap-1.5 @md:flex">
        <Button type="submit" size="lg" carregando={pendente}>
          {modo === "novo"
            ? pendente
              ? "Cadastrando…"
              : "Cadastrar contato"
            : pendente
              ? "Salvando…"
              : "Salvar"}
        </Button>
        <Button
          href={cancelar}
          variant="secondary"
          size="lg"
          onClick={voltar}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
