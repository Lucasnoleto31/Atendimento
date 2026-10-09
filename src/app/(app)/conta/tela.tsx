"use client";

import { Field } from "@/components/ui/field";
import { AlternadorTema } from "@/components/app/alternador-tema";
import { AvatarPessoa } from "@/components/app/avatar-pessoa";
import { rotuloPapel } from "@/lib/papeis";
import {
  FormAcao,
  LinhaEditor,
  MestreDetalhe,
  type Editor,
} from "../configuracoes/editor";
import {
  CabecalhoPagina,
  Grupo,
  LinhaInfo,
  TextoLinha,
} from "../configuracoes/ui";
import { mudarMeuNome, sairDosOutrosAparelhos } from "./actions";
import { FormFoto } from "./form-foto";
import { FormSenha } from "./form-senha";

/*
 * Minha conta, no desenho de Configurações: grupos de linhas como os Ajustes
 * do iOS e um editor por linha, em folha no celular e em painel ao lado no
 * desktop. O e-mail e o papel só aparecem: quem muda é a administração. A
 * foto abre o editor dela (form-foto.tsx): adicionar, trocar e remover. No
 * papel de compliance, o editor da foto só remove.
 *
 * Componente de cliente pelo mesmo motivo de Configurações: os editores são
 * montados aqui a partir dos dados, e a página de servidor passa só dados.
 */

/** Rótulo à esquerda e o valor à direita, cortado com reticências quando
 *  não cabe (e-mail comprido no celular de 375px). */
function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <span className="tipo-corpo shrink-0 text-tinta">{rotulo}</span>
      <span
        title={valor}
        className="tipo-corpo min-w-0 flex-1 truncate text-right text-texto-2"
      >
        {valor}
      </span>
    </>
  );
}

export function TelaConta({
  nome,
  email,
  papel,
  foto,
}: {
  nome: string;
  email: string;
  papel: string;
  /** A foto que a pessoa pôs (lida pela sessão, fotoDaSessao), ou null. */
  foto: string | null;
}) {
  // Compliance é só leitura também no próprio perfil (o banco não deixa
  // gravar): o nome aparece como as outras linhas, sem editor. A foto não
  // entra nem troca, mas a que já existe sai (a de quem virou compliance
  // depois de pôr a dele): sem foto, a linha nem aparece.
  const mudaNome = papel !== "compliance";
  const editaFoto = mudaNome || Boolean(foto);

  const editores: Record<string, Editor> = {
    senha: { titulo: "Trocar senha", conteudo: <FormSenha email={email} /> },
    aparelhos: {
      titulo: "Sair dos outros aparelhos",
      conteudo: (
        <FormAcao
          acao={sairDosOutrosAparelhos}
          fechar
          botao="Sair dos outros aparelhos"
          botaoGravando="Saindo…"
          className="flex flex-col gap-2"
        >
          <p className="tipo-corpo text-texto-2">
            Os outros celulares e computadores em que você entrou saem da conta
            e pedem a senha de novo. Este aparelho continua dentro.
          </p>
        </FormAcao>
      ),
    },
  };

  if (editaFoto) {
    editores.foto = {
      titulo: "Foto",
      // A foto salva na key: removida ou trocada em outro aparelho, o
      // editor aberto recomeça com a de agora.
      conteudo: (
        <FormFoto
          key={foto ?? "sem-foto"}
          nome={nome}
          foto={foto}
          soRemover={!mudaNome}
        />
      ),
    };
  }

  if (mudaNome) {
    editores.nome = {
      titulo: "Nome",
      conteudo: (
        // O nome salvo na key: o campo não relê o defaultValue depois de
        // montado.
        <FormAcao
          key={nome}
          acao={mudarMeuNome}
          fechar
          botao="Salvar"
          botaoGravando="Salvando…"
          className="flex flex-col gap-2"
        >
          <Field
            id="conta-nome"
            name="nome"
            label="Nome"
            defaultValue={nome}
            autoComplete="name"
            maxLength={80}
            required
            ajuda="Aparece para a equipe nas conversas e no relatório."
          />
        </FormAcao>
      ),
    };
  }

  return (
    <div className="px-2 pt-3 pb-6 md:px-3 lg:pt-4">
      <CabecalhoPagina titulo="Minha conta" />

      <div className="mt-3">
        {/* Sem grupoComandos: os comandos caem no "Nesta tela" da paleta.
            "Minha conta" já é o item do Ir para, e "Conta" é o grupo do tema. */}
        <MestreDetalhe
          editores={editores}
          comandos={[
            {
              id: "foto",
              rotulo: !mudaNome
                ? "Remover foto"
                : foto
                  ? "Trocar foto"
                  : "Adicionar foto",
            },
            { id: "senha", rotulo: "Trocar senha" },
            { id: "nome", rotulo: "Mudar meu nome" },
            { id: "aparelhos", rotulo: "Sair dos outros aparelhos" },
          ]}
        >
          <div className="flex flex-col gap-4">
            <Grupo
              id="grupo-perfil"
              titulo="Perfil"
              nota="Para trocar o e-mail, fale com a administração."
            >
              {editaFoto ? (
                <LinhaEditor id="foto">
                  <span className="tipo-corpo min-w-0 flex-1 text-tinta">
                    Foto
                  </span>
                  {foto ? (
                    <AvatarPessoa nome={nome} foto={foto} tamanho={32} />
                  ) : (
                    <span className="tipo-corpo shrink-0 text-texto-2">
                      Adicionar
                    </span>
                  )}
                </LinhaEditor>
              ) : null}
              {mudaNome ? (
                <LinhaEditor id="nome">
                  <Par rotulo="Nome" valor={nome} />
                </LinhaEditor>
              ) : (
                <LinhaInfo>
                  <Par rotulo="Nome" valor={nome} />
                </LinhaInfo>
              )}
              <LinhaInfo>
                <Par rotulo="E-mail" valor={email} />
              </LinhaInfo>
              <LinhaInfo>
                <Par rotulo="Papel" valor={rotuloPapel(papel)} />
              </LinhaInfo>
            </Grupo>

            <Grupo id="grupo-seguranca" titulo="Segurança">
              <LinhaEditor id="senha">
                <TextoLinha titulo="Trocar senha" />
              </LinhaEditor>
              <LinhaEditor id="aparelhos">
                <TextoLinha
                  titulo="Sair dos outros aparelhos"
                  apoio="Este aparelho continua dentro."
                />
              </LinhaEditor>
            </Grupo>

            <Grupo id="grupo-aparencia" titulo="Aparência">
              <li>
                <AlternadorTema variante="linha" className="tipo-corpo" />
              </li>
            </Grupo>
          </div>
        </MestreDetalhe>
      </div>
    </div>
  );
}
