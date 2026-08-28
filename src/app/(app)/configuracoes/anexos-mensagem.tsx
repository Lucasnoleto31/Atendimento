"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { prepararUploadMensagemPadrao } from "./actions";

/**
 * Anexos de uma mensagem padrão (0060). O arquivo sobe NA HORA da escolha,
 * por URL assinada direto do navegador (server action tem teto de 1MB de
 * corpo — o mesmo motivo do upload do chat), e o formulário só carrega os
 * metadados num campo escondido. Remover um chip tira da lista; o Salvar do
 * formulário é quem grava a lista final.
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
        setErro(`"${arquivo.name}" passa de 16MB — o WhatsApp não aceita.`);
        return;
      }
      if (arquivo.type.startsWith("image/") && arquivo.size > MAX_IMAGEM) {
        setErro(`"${arquivo.name}" passa de 5MB — o WhatsApp limita imagem a 5MB.`);
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
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no upload.");
    } finally {
      setSubindo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <input type="hidden" name="anexos" value={JSON.stringify(anexos)} />

      {anexos.length > 0 ? (
        <ul className="flex flex-wrap gap-0.5">
          {anexos.map((anexo) => (
            <li
              key={anexo.url}
              className="inline-flex h-[24px] max-w-[220px] items-center gap-0.5 rounded-sm bg-neutral-100 px-1 text-xs text-neutral-800"
            >
              <Paperclip
                size={12}
                strokeWidth={1.5}
                aria-hidden
                className="shrink-0 text-neutral-400"
              />
              <span className="truncate">{anexo.nome}</span>
              <button
                type="button"
                aria-label={`Remover anexo ${anexo.nome}`}
                onClick={() =>
                  setAnexos((atuais) =>
                    atuais.filter((a) => a.url !== anexo.url),
                  )
                }
                className="shrink-0 rounded-sm text-neutral-400 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-1">
        <label
          htmlFor={`anexos-${idBase}`}
          className={cn(
            "inline-flex h-[32px] cursor-pointer items-center gap-0.5 rounded-md border border-neutral-300 bg-neutral-0 px-1 text-xs font-medium text-neutral-600 transition-colors duration-[120ms] hover:bg-neutral-100 hover:text-neutral-800",
            subindo && "cursor-wait opacity-60",
          )}
        >
          <Paperclip size={14} strokeWidth={1.5} aria-hidden />
          {subindo ? "Enviando…" : "Anexar arquivo"}
        </label>
        <input
          ref={inputRef}
          id={`anexos-${idBase}`}
          type="file"
          multiple
          disabled={subindo}
          onChange={(e) => void escolher(e.target.files)}
          className="sr-only"
        />
        <span className="text-xs text-neutral-400">
          sai junto ao usar a mensagem no chat
        </span>
      </div>

      {erro ? (
        <p role="alert" className="text-xs text-danger">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
