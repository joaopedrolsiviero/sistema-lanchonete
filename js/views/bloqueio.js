// Tela pedida antes de entrar em Cardápio, Relatórios ou Ajustes quando há senha do dono.

import { conferirSenha, desbloquear, recuperarComCodigo, TAMANHO_MINIMO } from '../acesso.js';
import { avisar, abrirDialogo } from '../ui.js';

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

export function renderizar(raiz, app, aoLiberar) {
  raiz.innerHTML = `
    <section class="pagina estreita">
      <form class="painel abertura-caixa" autocomplete="off">
        <h1>🔒 Área do dono</h1>
        <p class="muted">Cardápio, Relatórios e Ajustes são protegidos pela senha do dono.</p>
        <label>Senha <input type="password" name="senha" required autofocus></label>
        <p class="erro" hidden></p>
        <button type="submit" class="btn primario grande">Entrar</button>
        <button type="button" class="btn link" data-acao="esqueci">Esqueci a senha</button>
      </form>
    </section>`;

  const form = raiz.querySelector('form');
  const erro = form.querySelector('.erro');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = form.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      if (await conferirSenha(app.estado, form.senha.value)) {
        desbloquear();
        aoLiberar();
        return;
      }
      await esperar(800); // atrasa tentativas seguidas
      erro.textContent = 'Senha incorreta.';
      erro.hidden = false;
      form.senha.select();
    } finally {
      botao.disabled = false;
    }
  });

  form.querySelector('[data-acao="esqueci"]').addEventListener('click', () => {
    abrirDialogo({
      titulo: 'Esqueci a senha',
      corpo: `
        <p>Digite o <strong>código de recuperação</strong> que foi mostrado quando a senha foi criada
          (formato XXXX-XXXX-XXXX) e escolha uma senha nova.</p>
        <label>Código de recuperação <input name="codigo" required autocomplete="off"></label>
        <label>Nova senha (mínimo ${TAMANHO_MINIMO} caracteres) <input type="password" name="nova" required></label>
        <label>Repita a nova senha <input type="password" name="repete" required></label>
        <p class="muted">Sem o código não é possível recuperar o acesso pela tela.
          Nesse caso, peça ajuda a quem configurou o sistema.</p>`,
      textoSalvar: 'Criar nova senha',
      aoSalvar: async (f) => {
        if (f.nova.value !== f.repete.value) throw new Error('As senhas não são iguais.');
        const codigoNovo = await recuperarComCodigo(app.estado, f.codigo.value, f.nova.value);
        app.salvar();
        desbloquear();
        avisar('Senha alterada.');
        aoLiberar();
        setTimeout(() => mostrarCodigoRecuperacao(codigoNovo, { substituiu: true }), 0);
      },
    });
  });
}

/** Mostra o código de recuperação recém-criado (só aparece esta vez). */
export function mostrarCodigoRecuperacao(codigo, { substituiu = false } = {}) {
  abrirDialogo({
    titulo: 'Anote o código de recuperação',
    corpo: `
      <p>Se esquecer a senha, este código permite criar uma nova. <strong>Ele só aparece agora.</strong></p>
      <p class="codigo-recuperacao">${codigo}</p>
      <p class="muted">Anote num papel e guarde fora do caixa (ou numa foto no seu celular).
        ${substituiu ? 'O código anterior deixou de valer.' : ''}</p>`,
    textoFechar: 'Já anotei',
  });
}
