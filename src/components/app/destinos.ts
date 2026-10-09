import { hrefDoEditor } from "@/app/(app)/admin/rotas";
import { ehGestao, type Papel } from "@/lib/papeis";
import type { DestinoPaleta } from "./paleta-global";

/*
 * Os destinos fixos da busca ⌘K, por papel: os editores da Administração e
 * de Minha conta, que antes só existiam com a própria tela aberta. Cada um
 * abre o editor certo pelo endereço (?abrir=<chave>), de qualquer tela. Na
 * tela que já tem o editor, a paleta mostra o comando dela e esconde o
 * destino igual (o `editor` é a mesma chave).
 *
 * Os sinônimos entram na busca e não aparecem: quem digita "tag" acha
 * "Nova etiqueta"; "pronta", a mensagem padrão; "auditoria", o log.
 * Arquivo puro: a casca monta a lista e a paleta só lê.
 */

/** Um destino que abre um editor da Administração. */
function editorAdmin(
  chave: string,
  rotulo: string,
  sinonimos: string,
): DestinoPaleta {
  return {
    id: `destino-${chave}`,
    rotulo,
    grupo: "Administração",
    href: hrefDoEditor(chave),
    editor: chave,
    sinonimos,
  };
}

/** Um destino que abre um editor de Minha conta. */
function editorConta(
  chave: string,
  rotulo: string,
  sinonimos: string,
): DestinoPaleta {
  return {
    id: `destino-conta-${chave}`,
    rotulo,
    grupo: "Conta",
    href: `/conta?abrir=${encodeURIComponent(chave)}`,
    editor: chave,
    sinonimos,
  };
}

const LOG: DestinoPaleta = {
  id: "destino-log",
  rotulo: "Log de acesso",
  grupo: "Administração",
  href: "/admin/acessos",
  sinonimos: "auditoria log acessos quem viu exportou registro",
};

export function destinosDoPapel(papel: Papel): DestinoPaleta[] {
  const destinos: DestinoPaleta[] = [];

  if (ehGestao(papel)) {
    destinos.push(
      editorAdmin(
        "mensagem:nova",
        "Nova mensagem pronta",
        "mensagem pronta resposta rapida padrao modelo texto",
      ),
      editorAdmin("etiqueta:nova", "Nova etiqueta", "etiqueta tag marcador"),
      editorAdmin(
        "importar",
        "Importar contatos",
        "importar planilha csv excel xlsx lista contatos",
      ),
      editorAdmin(
        "horario",
        "Horário de atendimento",
        "horario expediente atendimento fora do horario",
      ),
      editorAdmin(
        "rodizio",
        "Quem entra no rodízio",
        "rodizio distribuicao distribuir fila equipe",
      ),
      editorAdmin(
        "numero:novo",
        "Novo número de WhatsApp",
        "numero telefone whatsapp instancia meta",
      ),
    );
  }

  if (papel === "admin") {
    destinos.push(
      editorAdmin(
        "usuario:novo",
        "Novo usuário",
        "usuario pessoa equipe membro conta acesso",
      ),
      editorAdmin(
        "privacidade-regra:nova",
        "Nova regra de privacidade",
        "privacidade regra ocultar esconder conversas",
      ),
      editorAdmin(
        "privacidade-grupo:novo",
        "Novo grupo de privacidade",
        "privacidade grupo pessoas",
      ),
      {
        id: "destino-instagram",
        rotulo: "Instagram Direct",
        grupo: "Administração",
        href: "/admin/instagram",
        sinonimos: "instagram direct conectar conexao meta ig",
      },
    );
  }

  if (ehGestao(papel) || papel === "compliance") destinos.push(LOG);

  destinos.push(
    editorConta("foto", "Trocar minha foto", "foto imagem perfil avatar retrato"),
    editorConta("senha", "Trocar minha senha", "senha trocar mudar seguranca"),
    editorConta(
      "aparelhos",
      "Sair dos outros aparelhos",
      "sair aparelhos sessoes celular computador",
    ),
  );
  // O compliance não muda o próprio nome (o banco não deixa gravar) nem a
  // própria foto (a conta dele é só leitura).
  if (papel !== "compliance") {
    destinos.push(
      editorConta("nome", "Mudar meu nome", "nome perfil"),
      editorConta(
        "foto",
        "Trocar minha foto",
        "foto adicionar imagem retrato avatar perfil",
      ),
    );
  }

  return destinos;
}
