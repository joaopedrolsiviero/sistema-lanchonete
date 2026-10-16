// Componentes de interface reutilizáveis: aviso (toast), diálogos e impressão.

import { esc, formatarMoeda, formatarDataHora } from './util.js';
import { FORMAS_PAGAMENTO } from './store.js';

let timerToast;
export function avisar(mensagem, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = mensagem;
  el.className = `toast visivel ${tipo}`;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { el.className = 'toast'; }, 3000);
}

/**
 * Abre o diálogo com um formulário. `corpo` é HTML dos campos.
 * `aoSalvar(form)` pode lançar erro para manter o diálogo aberto e exibir a mensagem.
 * `aoMontar(form)` permite ligar eventos dinâmicos.
 */
export function abrirDialogo({ titulo, corpo, textoSalvar = 'Salvar', textoFechar = 'Cancelar', aoSalvar, aoMontar }) {
  const dlg = document.getElementById('dialogo');
  dlg.innerHTML = `
    <form method="dialog" class="form-dialogo">
      <h2>${esc(titulo)}</h2>
      <div class="campos">${corpo}</div>
      <p class="erro" hidden></p>
      <div class="acoes">
        <button type="button" class="btn" data-acao="fechar">${esc(textoFechar)}</button>
        ${aoSalvar ? `<button type="submit" class="btn primario">${esc(textoSalvar)}</button>` : ''}
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const erro = form.querySelector('.erro');
  form.querySelector('[data-acao="fechar"]').onclick = () => dlg.close();
  form.onsubmit = (ev) => {
    ev.preventDefault();
    try {
      aoSalvar(form);
      dlg.close();
    } catch (e) {
      erro.textContent = e.message;
      erro.hidden = false;
    }
  };
  aoMontar?.(form);
  dlg.showModal();
  form.querySelector('input, select')?.focus();
}

export function confirmar(mensagem) {
  return window.confirm(mensagem);
}

/** Imprime a comanda/cupom de uma venda (não é documento fiscal). */
export function imprimirComanda(venda, nomeLoja) {
  const area = document.getElementById('impressao');
  area.innerHTML = `
    <div class="cupom">
      <h1>${esc(nomeLoja)}</h1>
      <p class="centro">Pedido <strong>#${venda.numero}</strong><br>${formatarDataHora(venda.data)}</p>
      ${venda.cancelada ? '<p class="centro"><strong>*** CANCELADO ***</strong></p>' : ''}
      <hr>
      <table>
        ${venda.itens.map((i) => `
          <tr><td>${i.qtd}x ${esc(i.nome)}${i.obs ? `<br><small>obs: ${esc(i.obs)}</small>` : ''}</td>
              <td class="dir">${formatarMoeda(i.preco * i.qtd)}</td></tr>`).join('')}
      </table>
      <hr>
      <table>
        ${venda.desconto ? `<tr><td>Subtotal</td><td class="dir">${formatarMoeda(venda.subtotal)}</td></tr>
        <tr><td>Desconto</td><td class="dir">-${formatarMoeda(venda.desconto)}</td></tr>` : ''}
        <tr><td><strong>TOTAL</strong></td><td class="dir"><strong>${formatarMoeda(venda.total)}</strong></td></tr>
        <tr><td>${FORMAS_PAGAMENTO[venda.pagamento]}</td><td class="dir">${formatarMoeda(venda.recebido)}</td></tr>
        ${venda.troco ? `<tr><td>Troco</td><td class="dir">${formatarMoeda(venda.troco)}</td></tr>` : ''}
      </table>
      <hr>
      <p class="centro"><small>Não é documento fiscal</small></p>
    </div>`;
  window.print();
}
