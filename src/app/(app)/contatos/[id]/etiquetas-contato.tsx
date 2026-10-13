"use client";

import { useState } from "react";
import { alternarEtiquetaChat } from "@/app/(app)/chat/actions";
import { Chip, Etiqueta } from "@/components/ui/etiqueta";
import { pontoDaEtiqueta } from "../cor-etiqueta";
import { marcarContatoMudou } from "../rastro";

export type EtiquetaDoCatalogo = {
  id: string;
  nome: string;
  cor: string | null;
  ativo: boolean;
};

/**
 * Etiquetas da ficha: tocar marca ou desmarca, com a MESMA action do chat.
 * A tela muda na hora e volta atrás se o servidor recusar; a ficha não
 * recarrega a cada toque.
 *
 * Cada etiqueta espera a resposta dela antes de aceitar outro toque (dois
 * toques rápidos na mesma chegariam fora de ordem); as outras continuam
 * livres, e nenhuma apaga enquanto espera.
 */
export function EtiquetasContato({
  leadId,
  catalogo,
  marcadasIniciais,
  podeEditar,
}: {
  leadId: string;
  catalogo: EtiquetaDoCatalogo[];
  marcadasIniciais: string[];
  podeEditar: boolean;
}) {
  const [marcadas, setMarcadas] = useState(() => new Set(marcadasIniciais));
  const [esperando, setEsperando] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [erro, setErro] = useState<string | null>(null);

  // Arquivada some da escolha, mas continua à vista enquanto estiver no
  // contato, senão não haveria como tirá-la.
  const visiveis = catalogo.filter((t) => t.ativo || marcadas.has(t.id));

  if (!podeEditar) {
    const doContato = visiveis.filter((t) => marcadas.has(t.id));
    return doContato.length === 0 ? (
      <p className="rounded-painel bg-cartao p-2 tipo-corpo text-texto-2">
        Sem etiquetas.
      </p>
    ) : (
      <ul className="flex flex-wrap gap-1 px-2" aria-label="Etiquetas">
        {doContato.map((t) => (
          <li key={t.id} className="min-w-0">
            <Etiqueta cor={pontoDaEtiqueta(t.cor)}>{t.nome}</Etiqueta>
          </li>
        ))}
      </ul>
    );
  }

  if (visiveis.length === 0) {
    return (
      <p className="rounded-painel bg-cartao p-2 tipo-corpo text-texto-2">
        Nenhuma etiqueta cadastrada. Elas são criadas em Configurações.
      </p>
    );
  }

  const mudar = (
    conjunto: ReadonlySet<string>,
    tagId: string,
    ligar: boolean,
  ) => {
    const proximo = new Set(conjunto);
    if (ligar) proximo.add(tagId);
    else proximo.delete(tagId);
    return proximo;
  };

  async function alternar(tagId: string) {
    if (esperando.has(tagId)) return;
    const marcar = !marcadas.has(tagId);
    setErro(null);
    setMarcadas((atual) => mudar(atual, tagId, marcar));
    setEsperando((atual) => mudar(atual, tagId, true));
    let r: { ok?: boolean; erro?: string };
    try {
      r = await alternarEtiquetaChat(leadId, tagId, marcar);
    } catch {
      r = { erro: "O servidor não respondeu. Confira a internet e tente de novo." };
    }
    setEsperando((atual) => mudar(atual, tagId, false));
    if (r.erro) {
      setMarcadas((atual) => mudar(atual, tagId, !marcar));
      setErro(r.erro);
      return;
    }
    // A action do chat não pede a lista de novo: a lista que voltar pelo
    // histórico relê (rastro.ts), senão mostraria as etiquetas velhas.
    marcarContatoMudou();
  }

  return (
    <div className="px-2">
      <div
        role="group"
        aria-label="Etiquetas do contato"
        className="flex flex-wrap gap-1 pointer-coarse:gap-1.5"
      >
        {visiveis.map((t) => (
          <Chip
            key={t.id}
            ativo={marcadas.has(t.id)}
            cor={pontoDaEtiqueta(t.cor)}
            aria-busy={esperando.has(t.id) || undefined}
            onClick={() => alternar(t.id)}
          >
            {t.nome}
          </Chip>
        ))}
      </div>
      {erro ? (
        <p role="alert" className="mt-1 tipo-nota text-erro">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
