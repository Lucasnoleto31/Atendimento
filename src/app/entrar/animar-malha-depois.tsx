"use client";

import dynamic from "next/dynamic";

/** O movimento da malha chega depois da tela, fora do JavaScript de toda
 *  página que usa a moldura (o erro e o 404 vão em todas as rotas). */
const AnimarMalha = dynamic(
  () => import("./animar-malha").then((m) => m.AnimarMalha),
  { ssr: false },
);

export function AnimarMalhaDepois() {
  return <AnimarMalha />;
}
