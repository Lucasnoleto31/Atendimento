import { EsqueletoGrupos } from "../../configuracoes/ui";

export default function Carregando() {
  // O compliance também vê o "‹ Administração" no esqueleto por um
  // instante: a tela de verdade chega em seguida, sem ele.
  return (
    <EsqueletoGrupos
      titulo="Log de acesso"
      linhas={[6, 4]}
      volta="Administração"
    />
  );
}
