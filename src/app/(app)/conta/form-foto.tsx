"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { AvatarPessoa } from "@/components/app/avatar-pessoa";
import { ConfirmarAntes } from "../configuracoes/cancelar";
import { avisar, FormAcao, useEditor } from "../configuracoes/editor";
import { ZonaPerigo } from "../configuracoes/ui";
import { salvarMinhaFoto, tirarMinhaFoto } from "./actions";

/*
 * A própria foto, dentro do editor de Minha conta (folha no celular, painel
 * no desktop). O navegador prepara a imagem antes de mandar: corta o
 * quadrado do centro e reduz para 256×256 no canvas, em WebP (no navegador
 * que não gera WebP no canvas, como o Safari, sai JPEG). Uma foto de celular de 4 MB vira um
 * arquivo de dezenas de KB, e o servidor recebe sempre o mesmo formato.
 *
 * A foto escolhida aparece na prévia e só vale depois do "Salvar foto".
 * Fechar com ela escolhida e não salva pergunta antes (a trava do editor).
 *
 * Com `soRemover` (o compliance que já tinha foto), o editor só mostra a
 * foto e o "Remover foto": a conta é só leitura, mas a imagem da pessoa
 * precisa de um caminho de saída.
 */

/** O lado da foto gravada, em px. O servidor só aceita esta medida
 *  (LADO_FOTO_EQUIPE, em lib/fotos-equipe.ts): mudar aqui é mudar lá. */
const LADO = 256;
/** O maior lado de canvas que o Safari do iPhone aceita sem falhar. */
const LADO_MAX_CANVAS = 4096;
const QUALIDADE = 0.85;
/** O teto da foto pronta (o servidor confere o mesmo). */
const MAX_FOTO = 1024 * 1024;
/** O teto do arquivo escolhido, antes de reduzir. */
const MAX_ORIGINAL = 30 * 1024 * 1024;

const NAO_ABRIU =
  "Não deu para abrir esta imagem. Escolha uma foto em JPG, PNG ou WebP.";
const DESCARTAR_FOTO = "Descartar a foto escolhida?";

/** Os botões do editor: largura toda e 48px no celular; no desktop, do
 *  tamanho do rótulo e com 40px, como o botão do FormAcao. */
const BOTAO = "w-full lg:h-[40px] lg:w-auto lg:px-2 lg:text-sm";

function novoCanvas(lado: number) {
  const canvas = document.createElement("canvas");
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador não prepara a foto. Tente outro.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

function paraBlob(canvas: HTMLCanvasElement, tipo: string) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, tipo, QUALIDADE),
  );
}

/** Abre a imagem já decodificada. A orientação da câmera (EXIF) vem
 *  aplicada: o navegador desenha a foto em pé. */
async function abrirImagem(arquivo: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * O quadrado do centro, reduzido para 256×256. Reduz pela metade em passos
 * até perto do tamanho final: de 3.000px para 256 de uma vez, o canvas
 * serrilha. O primeiro passo nunca passa de 4.096px de lado (o teto do
 * canvas no iPhone).
 */
async function prepararFoto(arquivo: File): Promise<Blob> {
  if (arquivo.type && !arquivo.type.startsWith("image/")) {
    throw new Error("Escolha um arquivo de imagem.");
  }
  if (arquivo.size > MAX_ORIGINAL) {
    throw new Error("A imagem passa de 30 MB. Escolha uma menor.");
  }

  let img: HTMLImageElement;
  try {
    img = await abrirImagem(arquivo);
  } catch {
    throw new Error(NAO_ABRIU);
  }
  const largura = img.naturalWidth;
  const altura = img.naturalHeight;
  if (!largura || !altura) throw new Error(NAO_ABRIU);

  let lado = Math.min(largura, altura);
  let x = (largura - lado) / 2;
  let y = (altura - lado) / 2;
  let fonte: CanvasImageSource = img;
  while (lado > LADO * 2) {
    const proximo = Math.min(Math.round(lado / 2), LADO_MAX_CANVAS);
    const { canvas, ctx } = novoCanvas(proximo);
    ctx.drawImage(fonte, x, y, lado, lado, 0, 0, proximo, proximo);
    fonte = canvas;
    lado = proximo;
    x = 0;
    y = 0;
  }
  // Fundo branco antes da imagem, nos dois formatos: o PNG com
  // transparência (logo, recorte) fica igual em qualquer navegador. Sem
  // isto, o WebP guardava a transparência e as iniciais do círculo
  // apareciam pelos buracos, e o JPEG do Safari saía com branco.
  const { canvas: final, ctx } = novoCanvas(LADO);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LADO, LADO);
  ctx.drawImage(fonte, x, y, lado, lado, 0, 0, LADO, LADO);

  let blob = await paraBlob(final, "image/webp");
  if (!blob || blob.type !== "image/webp") {
    // O navegador que não gera WebP devolve PNG: sai JPEG do mesmo canvas,
    // já opaco.
    blob = await paraBlob(final, "image/jpeg");
  }
  if (!blob) throw new Error("Este navegador não prepara a foto. Tente outro.");
  if (blob.size > MAX_FOTO) {
    throw new Error("A foto ficou acima de 1 MB. Escolha outra imagem.");
  }
  return blob;
}

export function FormFoto({
  nome,
  foto,
  soRemover = false,
}: {
  nome: string;
  /** A foto salva (lida pela sessão, em Minha conta), ou null. */
  foto: string | null;
  /** Só a foto e o "Remover foto" (o compliance, que não põe nem troca). */
  soRemover?: boolean;
}) {
  const editor = useEditor();
  const entrada = useRef<HTMLInputElement>(null);
  const principal = useRef<HTMLButtonElement>(null);
  const [escolhida, setEscolhida] = useState<{
    blob: Blob;
    url: string;
  } | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  // A prévia é um endereço blob: sai da memória quando muda ou o editor
  // fecha.
  useEffect(() => {
    if (!escolhida) return;
    const url = escolhida.url;
    return () => URL.revokeObjectURL(url);
  }, [escolhida]);

  // Foto escolhida e não salva: fechar o editor (X, Esc, fundo, arrasto,
  // voltar do sistema, outra linha) pergunta antes.
  const travar = editor?.travar;
  useEffect(() => {
    if (!escolhida || !travar) return;
    travar(DESCARTAR_FOTO);
    return () => travar(null);
  }, [escolhida, travar]);

  // O editor ainda está aberto? A imagem que termina de preparar depois de
  // fechado não vira prévia (o endereço blob não seria liberado).
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  // O botão principal fica desativado enquanto prepara ou grava e perde o
  // foco; quando volta, o foco volta para ele (o rótulo já é o próximo
  // passo: "Salvar foto" ou "Trocar foto").
  const focar = useRef(false);
  useEffect(() => {
    if (!focar.current || preparando || salvando) return;
    focar.current = false;
    principal.current?.focus();
  });

  const abrirEscolha = () => entrada.current?.click();

  const escolher = async (lista: FileList | null) => {
    const arquivo = lista?.[0] ?? null;
    // Limpo, o campo dispara de novo com o mesmo arquivo.
    if (entrada.current) entrada.current.value = "";
    if (!arquivo) return;
    setErro(null);
    setPreparando(true);
    focar.current = true;
    try {
      const blob = await prepararFoto(arquivo);
      if (vivo.current) setEscolhida({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setErro(e instanceof Error ? e.message : NAO_ABRIU);
    } finally {
      setPreparando(false);
    }
  };

  const salvar = () => {
    if (!escolhida || salvando) return;
    const dados = new FormData();
    dados.append(
      "foto",
      escolhida.blob,
      escolhida.blob.type === "image/webp" ? "foto.webp" : "foto.jpg",
    );
    setErro(null);
    focar.current = true;
    iniciar(async () => {
      try {
        const resultado = await salvarMinhaFoto(dados);
        if (resultado.ok) {
          // O editor devolve o foco à linha "Foto" ao fechar.
          focar.current = false;
          avisar(resultado.ok);
          // Sem a trava antes: o fechar perguntaria "Descartar?".
          editor?.travar(null);
          editor?.concluir();
          return;
        }
        setErro(resultado.erro ?? "A foto não foi salva. Tente de novo.");
      } catch {
        setErro("A conexão não respondeu. Tente de novo.");
      }
    });
  };

  const cancelar = () => {
    setEscolhida(null);
    setErro(null);
    focar.current = true;
  };

  const ocupado = preparando || salvando;
  const rotulo = preparando
    ? "Preparando…"
    : salvando
      ? "Salvando…"
      : escolhida
        ? "Salvar foto"
        : foto
          ? "Trocar foto"
          : "Adicionar foto";
  const situacao = soRemover
    ? "A equipe vê esta foto junto do seu nome. No papel de compliance, dá para remover, não para trocar."
    : preparando
      ? "Preparando a imagem…"
      : escolhida
        ? "Prévia, cortada em quadrado pelo centro."
        : foto
          ? "A equipe vê esta foto junto do seu nome."
          : "Sem foto, a equipe vê as suas iniciais.";

  const remover = (
    <ZonaPerigo>
      <FormAcao acao={tirarMinhaFoto} fechar>
        <ConfirmarAntes
          rotulo="Remover foto"
          pergunta="Sem foto, a equipe volta a ver as suas iniciais."
          confirmar="Remover"
          confirmarGravando="Removendo…"
        />
      </FormAcao>
    </ZonaPerigo>
  );

  if (soRemover) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <AvatarPessoa nome={nome} foto={foto} tamanho={96} />
          <p className="tipo-nota min-w-0 flex-1 text-texto-2">{situacao}</p>
        </div>
        {foto ? remover : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <AvatarPessoa nome={nome} foto={escolhida?.url ?? foto} tamanho={96} />
        <p role="status" className="tipo-nota min-w-0 flex-1 text-texto-2">
          {situacao}
        </p>
      </div>

      {/* Fora de qualquer <form>: escolher não marca "escrito e não
          gravado" (a pergunta certa é a da trava, sobre a foto). O botão
          abre o seletor; no celular, ele oferece a câmera e a galeria. */}
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => void escolher(e.currentTarget.files)}
      />

      {erro ? (
        <p role="alert" className="tipo-nota text-erro">
          {erro}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-center">
        <Button
          ref={principal}
          type="button"
          size="lg"
          carregando={ocupado}
          onClick={escolhida ? salvar : abrirEscolha}
          className={BOTAO}
        >
          {rotulo}
        </Button>
        {escolhida ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={ocupado}
              onClick={abrirEscolha}
              className={BOTAO}
            >
              Escolher outra
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={ocupado}
              onClick={cancelar}
              className={BOTAO}
            >
              Cancelar
            </Button>
          </>
        ) : null}
      </div>

      {foto && !escolhida && !preparando ? remover : null}
    </div>
  );
}
