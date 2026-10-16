// Tela pedida antes de entrar em Cardápio, Relatórios ou Ajustes quando há senha do dono.

import { conferirSenha, desbloquear, recuperarComCodigo, TAMANHO_MINIMO } from '../acesso.js';
import { avisar, abrirDialogo } from '../ui.js';

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Tentativas erradas: a partir da 3ª, cada erro dobra a espera (2 s, 4 s, 8 s… até 5 min).
// Fica guardado no navegador para não zerar ao recarregar a página.
const CHAVE_TENTATIVAS = 'recanto:tentativas-senha';
const ESPERA_MAXIMA_MS = 5 * 60 * 1000;

function lerTentativas() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_TENTATIVAS)) || { falhas: 0, liberaEm: 0 };
  } catch {
    return { falhas: 0, liberaEm: 0 };
  }
}

function gravarTentativas(t) {
  try {
    if (t) localStorage.setItem(CHAVE_TENTATIVAS, JSON.stringify(t));
    else localStorage.removeItem(CHAVE_TENTATIVAS);
  } catch { /* sem localStorage: a espera vale só nesta página */ }
}

function registrarFalha() {
  const t = lerTentativas();
  t.falhas += 1;
  const espera = t.falhas < 3 ? 0 : Math.min(ESPERA_MAXIMA_MS, 1000 * 2 ** (t.falhas - 2));
  t.liberaEm = Date.now() + espera;
  gravarTentativas(t);
  return espera;
}

/** Segundos que ainda faltam para poder tentar de novo (0 = pode tentar). */
function segundosParaTentar() {
  return Math.max(0, Math.ceil((lerTentativas().liberaEm - Date.now()) / 1000));
}

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
    const falta = segundosParaTentar();
    if (falta > 0) {
      erro.textContent = `Muitas tentativas erradas. Aguarde ${falta} s para tentar de novo.`;
      erro.hidden = false;
      return;
    }
    botao.disabled = true;
    try {
      if (await conferirSenha(app.estado, form.senha.value)) {
        gravarTentativas(null);
        desbloquear();
        aoLiberar();
        return;
      }
      const espera = registrarFalha();
      await esperar(800);
      erro.textContent = espera
        ? `Senha incorreta. Aguarde ${Math.ceil(espera / 1000)} s para tentar de novo.`
        : 'Senha incorreta.';
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
        const falta = segundosParaTentar();
        if (falta > 0) throw new Error(`Muitas tentativas erradas. Aguarde ${falta} s.`);
        let codigoNovo;
        try {
          codigoNovo = await recuperarComCodigo(app.estado, f.codigo.value, f.nova.value);
        } catch (e) {
          if (/incorreto/.test(e.message)) registrarFalha();
          throw e;
        }
        gravarTentativas(null);
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
