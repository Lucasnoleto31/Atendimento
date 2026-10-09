"use client";

import { cn } from "@/lib/utils";
import { rotuloPapel } from "@/lib/papeis";
import type { ConfigPrivacidade } from "@/lib/privacidade-regra";
import { AvatarPessoa } from "@/components/app/avatar-pessoa";
import { ConfirmarAntes } from "../../configuracoes/cancelar";
import {
  FormAcao,
  Interruptor,
  LinhaNova,
  MestreDetalhe,
  useEditor,
  type Editor,
} from "../../configuracoes/editor";
import {
  Grupo,
  LINHA_ACAO,
  LinhaInfo,
  LinhaLink,
  ListaEditor,
  MIOLO_LINHA,
  Seta,
  TextoLinha,
  ValorLinha,
  ZonaPerigo,
} from "../../configuracoes/ui";
import {
  listaDeNomes,
  nomesDe,
  type PessoaPrivacidade,
} from "../privacidade-texto";
import { hrefDoEditor } from "../rotas";
import { CabecalhoSubpagina, MolduraSubpagina } from "../subpagina";
import {
  DadosUsuario,
  NovoUsuario,
  OpcoesPapel,
  SenhaNova,
  type UsuarioLinha,
} from "../usuarios";
import {
  alternarRecebeLeads,
  alternarUsuarioAtivo,
  mudarPapel,
} from "../usuarios-actions";
import { removerFotoDeUsuario } from "./actions";

/*
 * Administração › Equipe (só o admin): as pessoas, com o editor de cada uma
 * (nome e e-mail, acesso, rodízio, papel e senha nova) e o Novo usuário. O
 * editor diz também o que a privacidade esconde da pessoa, com o caminho
 * para a regra: quando alguém diz "não acho a conversa do João", a resposta
 * fica a três toques.
 *
 * A foto de cada um aparece na linha e no alto do editor. Quem põe e troca é
 * a própria pessoa, em Minha conta; aqui o admin só tira (o "Remover foto"
 * da zona de perigo), que é a saída da foto de quem não tira sozinho, como
 * a conta desativada.
 */

/**
 * A linha da pessoa, que abre o editor dela: a LinhaEditor com a foto à
 * esquerda, fora do miolo, para o fio entre as linhas começar no nome (como
 * nos Contatos do iPhone). 48px: o círculo de 32 e 8 em cima e embaixo.
 */
function LinhaPessoa({
  id,
  nome,
  foto,
  apagado,
  children,
}: {
  id: string;
  nome: string;
  foto: string | null;
  /** Conta desativada: a foto acompanha o nome apagado. */
  apagado: boolean;
  children: React.ReactNode;
}) {
  const editor = useEditor();
  const ativo = editor?.aberto === id;
  return (
    <li className="group/linha">
      <button
        type="button"
        aria-expanded={ativo}
        // Por onde o foco volta quando o editor foi aberto pela paleta.
        data-editor={id}
        onClick={(e) => editor?.abrir(id, e.currentTarget)}
        className={cn(LINHA_ACAO, ativo && "bg-selecao hover:bg-selecao")}
      >
        <span className="flex shrink-0 items-center pl-2">
          <AvatarPessoa
            nome={nome}
            foto={foto}
            tamanho={32}
            className={apagado ? "opacity-60" : undefined}
          />
        </span>
        <span className={cn(MIOLO_LINHA, "ml-1.5")}>
          {children}
          <Seta />
        </span>
      </button>
    </li>
  );
}

/** As regras que valem para a pessoa: a dela e as dos grupos em que está. */
function regrasDaPessoa(config: ConfigPrivacidade, pessoa: UsuarioLinha) {
  const grupos = new Set(
    config.grupos
      .filter((g) => g.membros.includes(pessoa.id))
      .map((g) => g.id),
  );
  return config.regras.filter((r) =>
    r.quem.tipo === "pessoa" ? r.quem.id === pessoa.id : grupos.has(r.quem.id),
  );
}

/** A linha de privacidade do editor da pessoa. */
function PrivacidadeDaPessoa({
  pessoa,
  config,
  porId,
}: {
  pessoa: UsuarioLinha;
  config: ConfigPrivacidade | null;
  porId: ReadonlyMap<string, PessoaPrivacidade>;
}) {
  if (!config) return null;
  if (pessoa.papel === "admin") {
    return (
      <ListaEditor rotulo="Privacidade">
        <LinhaInfo>
          <TextoLinha titulo="Vê todas as conversas" apoio="Admin vê tudo." />
        </LinhaInfo>
      </ListaEditor>
    );
  }
  const regras = regrasDaPessoa(config, pessoa);
  if (regras.length === 0) {
    return (
      <ListaEditor rotulo="Privacidade">
        <LinhaLink href={hrefDoEditor("privacidade-regra:nova")}>
          <TextoLinha
            titulo="Nenhuma regra de privacidade"
            apoio="Vê o que o papel permite. Tocar cria uma regra."
          />
        </LinhaLink>
      </ListaEditor>
    );
  }
  return (
    <ListaEditor rotulo="Privacidade">
      {regras.map((r) => {
        const ocultos = r.naoVe.filter((id) => id !== pessoa.id);
        const grupo =
          r.quem.tipo === "grupo"
            ? config.grupos.find((g) => g.id === r.quem.id)?.nome
            : null;
        return (
          <LinhaLink key={r.id} href={hrefDoEditor(`privacidade-regra:${r.id}`)}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="tipo-corpo break-words text-tinta">
                Não vê as conversas de {listaDeNomes(nomesDe(ocultos, porId))}
              </span>
              <span className="tipo-nota text-texto-2">
                {grupo ? `Pelo grupo ${grupo}` : "Regra da própria pessoa"}
              </span>
            </span>
          </LinhaLink>
        );
      })}
    </ListaEditor>
  );
}

export function TelaEquipe({
  meuId,
  equipe,
  comRodizio,
  privacidade,
  fotos,
  voltar,
}: {
  meuId: string;
  equipe: UsuarioLinha[];
  /** A coluna do rodízio existe (migração 0041). */
  comRodizio: boolean;
  /** Grupos e regras; null se a leitura falhou. */
  privacidade: ConfigPrivacidade | null;
  /** id da pessoa para a URL da foto, só de quem tem (fotosDaEquipe). */
  fotos: Record<string, string>;
  voltar: string | null;
}) {
  const porId = new Map<string, PessoaPrivacidade>(
    equipe.map((u) => [
      u.id,
      { id: u.id, nome: u.nome, papel: u.papel, ativo: u.ativo },
    ]),
  );

  const editores: Record<string, Editor> = {
    "usuario:novo": { titulo: "Novo usuário", conteudo: <NovoUsuario /> },
  };

  for (const u of equipe) {
    const eu = u.id === meuId;
    const foto = fotos[u.id] ?? null;
    editores[`usuario:${u.id}`] = {
      titulo: u.nome,
      conteudo: (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AvatarPessoa nome={u.nome} foto={foto} tamanho={64} />
            <p className="tipo-nota min-w-0 flex-1 text-texto-2">
              {eu
                ? foto
                  ? "Você troca a sua foto em Minha conta."
                  : "Sem foto. Você põe a sua em Minha conta."
                : foto
                  ? "A pessoa troca a foto em Minha conta."
                  : "Sem foto. A pessoa põe a dela em Minha conta."}
            </p>
          </div>
          {/* Sem key no form: com ela, salvar remontava o form inteiro e
              o foco do botão caía no body. A key com o nome e o e-mail
              salvos vai só nos campos, dentro do DadosUsuario. */}
          <DadosUsuario id={u.id} nome={u.nome} email={u.email} />
          <ListaEditor>
            <LinhaInfo>
              <TextoLinha
                titulo={<span id={`ativo-${u.id}`}>Acesso ativo</span>}
                apoio={eu ? "Você não desativa a própria conta." : undefined}
              />
              <FormAcao acao={alternarUsuarioAtivo} erroNoAviso>
                <input type="hidden" name="id" value={u.id} />
                <input type="hidden" name="ativo" value={u.ativo ? "0" : "1"} />
                <Interruptor
                  ligado={u.ativo}
                  rotuloId={`ativo-${u.id}`}
                  desativado={eu}
                />
              </FormAcao>
            </LinhaInfo>
            {comRodizio ? (
              <LinhaInfo>
                <TextoLinha
                  titulo={<span id={`rodizio-${u.id}`}>No rodízio</span>}
                  apoio="Recebe contato novo automaticamente."
                />
                <FormAcao acao={alternarRecebeLeads} erroNoAviso>
                  <input type="hidden" name="id" value={u.id} />
                  <input
                    type="hidden"
                    name="recebe"
                    value={u.recebe_leads ? "0" : "1"}
                  />
                  <Interruptor
                    ligado={Boolean(u.recebe_leads)}
                    rotuloId={`rodizio-${u.id}`}
                  />
                </FormAcao>
              </LinhaInfo>
            ) : null}
          </ListaEditor>

          <PrivacidadeDaPessoa pessoa={u} config={privacidade} porId={porId} />

          {/* O papel salvo na key: os rádios não releem o defaultChecked
              depois de montados. */}
          <FormAcao
            key={u.papel}
            acao={mudarPapel}
            botao={eu ? undefined : "Salvar papel"}
            botaoGravando="Salvando…"
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="id" value={u.id} />
            <OpcoesPapel selecionado={u.papel} desativado={eu} />
            {eu ? (
              <p className="tipo-nota px-2 text-texto-2">
                Você não muda o próprio papel.
              </p>
            ) : null}
          </FormAcao>

          <ZonaPerigo>
            <div className="flex flex-col gap-1">
              {foto ? (
                // Removida, o editor fecha e o foco volta à linha da
                // pessoa, já com as iniciais (o botão some junto com a
                // foto e o foco cairia no nada). A foto salva na key: o
                // erro de uma tentativa não fica na tela depois que outra
                // foto entra.
                <FormAcao
                  key={foto}
                  acao={removerFotoDeUsuario}
                  fechar
                  className="flex flex-col gap-1"
                >
                  <input type="hidden" name="id" value={u.id} />
                  <ConfirmarAntes
                    texto="Remover foto"
                    rotulo={`Remover a foto de ${u.nome}`}
                    pergunta="A foto sai do sistema e a equipe volta a ver as iniciais."
                    confirmar="Remover"
                    confirmarGravando="Removendo…"
                  />
                </FormAcao>
              ) : null}
              <SenhaNova id={u.id} email={u.email} nome={u.nome} />
            </div>
          </ZonaPerigo>
        </div>
      ),
    };
  }

  return (
    <MolduraSubpagina>
      <CabecalhoSubpagina titulo="Equipe" voltar={voltar} />

      <div className="mt-3">
        <MestreDetalhe
          editores={editores}
          voltar={voltar}
          grupoComandos="Administração"
          comandos={[{ id: "usuario:novo", rotulo: "Novo usuário" }]}
        >
          <Grupo
            id="grupo-equipe"
            titulo="Equipe"
            direita={equipe.length.toLocaleString("pt-BR")}
          >
            {equipe.map((u) => {
              const eu = u.id === meuId;
              const apoio = [
                rotuloPapel(u.papel),
                u.recebe_leads ? "no rodízio" : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <LinhaPessoa
                  key={u.id}
                  id={`usuario:${u.id}`}
                  nome={u.nome}
                  foto={fotos[u.id] ?? null}
                  apagado={!u.ativo}
                >
                  <TextoLinha
                    titulo={
                      <>
                        {u.nome}
                        {eu ? (
                          <span className="text-texto-2"> (você)</span>
                        ) : null}
                      </>
                    }
                    apoio={apoio}
                    apagado={!u.ativo}
                  />
                  {!u.ativo ? (
                    <ValorLinha tom="atencao">Desativado</ValorLinha>
                  ) : null}
                </LinhaPessoa>
              );
            })}
            <LinhaNova id="usuario:novo" rotulo="Novo usuário" />
          </Grupo>
        </MestreDetalhe>
      </div>
    </MolduraSubpagina>
  );
}
