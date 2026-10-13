"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { classesDoBotao } from "@/components/ui/button";
import { prepararUploadMensagemPadrao } from "./actions";

/**
 * Anexos de uma mensagem pronta (0060). O arquivo sobe NA HORA da escolha,
 * por URL assinada direto do navegador (server action tem teto de 1 MB de
 * corpo, o mesmo motivo do upload do chat), e o formulário só carrega os
 * metadados num campo escondido. Remover um anexo tira da lista; o Salvar do
 * formulário é quem grava a lista final, e um reset do formulário devolve a
 * lista salva.
 */

export type AnexoMensagem = { tipo: string; url: string; nome: string };

const MAX_ANEXOS = 5;
const MAX_TAMANHO = 16 * 1024 * 1024; // teto do WhatsApp para mídia
const MAX_IMAGEM = 5 * 1024 * 1024;

function tipoDoArquivo(mime: string): string {
  const prefixo = mime.split("/")[0];
  return prefixo === "image" || prefixo === "audio" || prefixo === "video"
    ? prefixo
    : "file";
}

export function AnexosMensagem({
  idBase,
  existentes,
}: {
  idBase: string;
  existentes: AnexoMensagem[];
}) {
  const [anexos, setAnexos] = useState<AnexoMensagem[]>(existentes);
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // O Cancelar do formulário é um reset, que não conhece este estado: a
  // lista volta à salva por aqui.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const restaurar = () => {
      setAnexos(existentes);
      setErro(null);
    };
    form.addEventListener("reset", restaurar);
    return () => form.removeEventListener("reset", restaurar);
  }, [existentes]);

  // Mexer na lista conta como mexer no formulário (é o que mostra o
  // Cancelar): o campo escondido não dispara "input" sozinho.
  const avisarMudanca = () =>
    inputRef.current?.dispatchEvent(new Event("input", { bubbles: true }));

  const escolher = async (lista: FileList | null) => {
    if (!lista || lista.length === 0) return;
    setErro(null);

    const arquivos = Array.from(lista);
    if (anexos.length + arquivos.length > MAX_ANEXOS) {
      setErro(`No máximo ${MAX_ANEXOS} anexos por mensagem.`);
      return;
    }
    for (const arquivo of arquivos) {
      if (arquivo.size > MAX_TAMANHO) {
        setErro(`“${arquivo.name}” passa de 16 MB, o limite do WhatsApp.`);
        return;
      }
      if (arquivo.type.startsWith("image/") && arquivo.size > MAX_IMAGEM) {
        setErro(
          `“${arquivo.name}” passa de 5 MB, o limite de imagem do WhatsApp.`,
        );
        return;
      }
    }

    setSubindo(true);
    try {
      const storage = createClient().storage.from("midia-whatsapp");
      const novos: AnexoMensagem[] = [];
      for (const arquivo of arquivos) {
        const preparo = await prepararUploadMensagemPadrao(arquivo.name);
        if (!preparo.caminho || !preparo.token) {
          throw new Error(preparo.erro ?? "Falha ao preparar o upload.");
        }
        const { error } = await storage.uploadToSignedUrl(
          preparo.caminho,
          preparo.token,
          arquivo,
          { contentType: arquivo.type || "application/octet-stream" },
        );
        if (error) throw new Error(error.message);
        const { data } = storage.getPublicUrl(preparo.caminho);
        novos.push({
          tipo: tipoDoArquivo(arquivo.type),
          url: data.publicUrl,
          nome: arquivo.name.slice(0, 120),
        });
      }
      setAnexos((atuais) => [...atuais, ...novos]);
      avisarMudanca();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no upload.");
    } finally {
      setSubindo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name="anexos" value={JSON.stringify(anexos)} />
      <p className="tipo-nota text-texto-2">
        Anexos{" "}
        <span className="tabular-nums">
          {anexos.length} de {MAX_ANEXOS}
        </span>
      </p>

      {anexos.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {anexos.map((anexo) => (
            <li
              key={anexo.url}
              className="tipo-nota inline-flex h-[32px] max-w-full items-center gap-0.5 rounded-chip bg-cartao pr-0.5 pl-1 text-tinta"
            >
              <Paperclip
                size={14}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-texto-2"
              />
              <span className="min-w-0 truncate">{anexo.nome}</span>
              <button
                type="button"
                aria-label={`Remover anexo ${anexo.nome}`}
                onClick={() => {
                  setAnexos((atuais) =>
                    atuais.filter((a) => a.url !== anexo.url),
                  );
                  avisarMudanca();
                }}
                className="relative inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-celula text-texto-2 transition-colors duration-[120ms] hover:bg-realce hover:text-erro focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-tinta pointer-coarse:after:absolute pointer-coarse:after:-inset-[10px]"
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <label
          htmlFor={`anexos-${idBase}`}
          className={classesDoBotao({
            variant: "secondary",
            size: "sm",
            className: cn(
              // O campo de arquivo é invisível: o anel de foco dele
              // aparece no botão que o representa.
              "cursor-pointer has-[+input:focus-visible]:outline-2 has-[+input:focus-visible]:outline-offset-2 has-[+input:focus-visible]:outline-tinta",
              (subindo || anexos.length >= MAX_ANEXOS) &&
                "pointer-events-none opacity-60",
            ),
          })}
        >
          {subindo ? "Enviando…" : "Anexar arquivo"}
        </label>
        <input
          ref={inputRef}
          id={`anexos-${idBase}`}
          type="file"
          multiple
          disabled={subindo || anexos.length >= MAX_ANEXOS}
          onChange={(e) => void escolher(e.target.files)}
          className="sr-only"
        />
        <span className="tipo-nota text-texto-2">
          Saem junto quando a mensagem é usada no chat.
        </span>
      </div>

      {erro ? (
        <p role="alert" className="tipo-nota text-erro">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
