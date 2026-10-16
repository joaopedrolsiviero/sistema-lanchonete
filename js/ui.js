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
 * `aoSalvar(form)` (pode ser async) pode lançar erro para manter o diálogo aberto e exibir a mensagem.
 * `aoMontar(form)` permite ligar eventos dinâmicos.
 * `bloqueado` mostra o diálogo sem botões e sem fechar com Esc (feche com fecharDialogo()).
 */
export function abrirDialogo({ titulo, corpo, textoSalvar = 'Salvar', textoFechar = 'Cancelar', aoSalvar, aoMontar, bloqueado = false }) {
  const dlg = document.getElementById('dialogo');
  dlg.innerHTML = `
    <form method="dialog" class="form-dialogo">
      <h2>${esc(titulo)}</h2>
      <div class="campos">${corpo}</div>
      <p class="erro" hidden></p>
      <div class="acoes" ${bloqueado ? 'hidden' : ''}>
        <button type="button" class="btn" data-acao="fechar">${esc(textoFechar)}</button>
        ${aoSalvar ? `<button type="submit" class="btn primario">${esc(textoSalvar)}</button>` : ''}
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const erro = form.querySelector('.erro');
  form.querySelector('[data-acao="fechar"]').onclick = () => dlg.close();
  // bloqueado: sem botões e sem fechar com Esc (ex.: enquanto a nota fiscal é emitida)
  dlg.oncancel = bloqueado ? (ev) => ev.preventDefault() : null;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const botao = form.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      await aoSalvar(form); // pode ser assíncrono (ex.: conferir senha)
      dlg.close();
    } catch (e) {
      erro.textContent = e.message;
      erro.hidden = false;
    } finally {
      botao.disabled = false;
    }
  };
  aoMontar?.(form);
  dlg.showModal();
  form.querySelector('input, select')?.focus();
}

export function fecharDialogo() {
  const dlg = document.getElementById('dialogo');
  if (dlg.open) dlg.close();
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
      <p class="centro">Pedido <strong>#${esc(venda.numero)}</strong><br>${formatarDataHora(venda.data)}</p>
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

/** Imprime o relatório de fechamento (ou parcial, se o caixa ainda estiver aberto). */
export function imprimirFechamento(caixa, resumo, nomeLoja) {
  const f = caixa.fechamento;
  const linha = (rotulo, valor) => `<tr><td>${rotulo}</td><td class="dir">${valor}</td></tr>`;
  const diferenca = f
    ? (f.diferenca === 0 ? 'Confere' : `${f.diferenca > 0 ? 'Sobra' : 'Falta'} ${formatarMoeda(Math.abs(f.diferenca))}`)
    : '';
  const area = document.getElementById('impressao');
  area.innerHTML = `
    <div class="cupom">
      <h1>${esc(nomeLoja)}</h1>
      <p class="centro"><strong>${f ? 'FECHAMENTO DE CAIXA' : 'RELATÓRIO PARCIAL DE CAIXA'}</strong></p>
      <p class="centro">Abertura: ${formatarDataHora(caixa.abertura)}<br>
        ${f ? `Fechamento: ${formatarDataHora(f.data)}` : 'Caixa ainda aberto'}</p>
      <hr>
      <table>
        ${linha('Pedidos', resumo.pedidos)}
        ${resumo.cancelados ? linha('Cancelados', resumo.cancelados) : ''}
        ${Object.entries(FORMAS_PAGAMENTO).map(([k, nome]) => linha(nome, formatarMoeda(resumo.porPagamento[k] || 0))).join('')}
        ${linha('<strong>TOTAL VENDAS</strong>', `<strong>${formatarMoeda(resumo.total)}</strong>`)}
      </table>
      <hr>
      <table>
        ${linha('Fundo de troco', formatarMoeda(caixa.fundo))}
        ${linha('+ Vendas dinheiro', formatarMoeda(resumo.porPagamento.dinheiro || 0))}
        ${linha('+ Suprimentos', formatarMoeda(resumo.suprimentos))}
        ${linha('- Sangrias', formatarMoeda(resumo.sangrias))}
        ${linha('<strong>Esperado</strong>', `<strong>${formatarMoeda(resumo.dinheiroEsperado)}</strong>`)}
        ${f ? linha('Contado', formatarMoeda(f.contado)) + linha('<strong>Diferença</strong>', `<strong>${diferenca}</strong>`) : ''}
      </table>
      ${f?.obs ? `<hr><p>Obs.: ${esc(f.obs)}</p>` : ''}
      <hr>
      <p class="centro"><br>_______________________<br>Conferido por</p>
    </div>`;
  window.print();
}

const FORMAS_NFCE = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Cartão de Débito', credito: 'Cartão de Crédito' };

function formatarChave(chave) {
  return String(chave).replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatarCnpj(cnpj) {
  return String(cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatarCpf(cpf) {
  return String(cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

/**
 * Imprime o DANFE NFC-e (cupom da nota fiscal de consumidor) a partir da venda e dos dados
 * devolvidos pelo serviço fiscal (emitente, chave, protocolo, QR Code...).
 */
export function imprimirNfce(venda, nota) {
  const e = nota.emitente;
  const qtdItens = venda.itens.reduce((s, i) => s + i.qtd, 0);
  const homologacao = nota.ambiente === 'homologacao';
  const area = document.getElementById('impressao');
  area.innerHTML = `
    <div class="cupom nfce">
      <p class="centro"><strong>${esc(e.razaoSocial)}</strong><br>
        CNPJ: ${formatarCnpj(e.cnpj)} &nbsp; IE: ${esc(e.ie)}<br>${esc(e.endereco)}</p>
      <p class="centro"><strong>Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</strong></p>
      ${homologacao ? '<p class="centro"><strong>EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL</strong></p>' : ''}
      ${nota.contingencia ? '<p class="centro"><strong>EMITIDA EM CONTINGÊNCIA<br>Pendente de autorização</strong></p>' : ''}
      <hr>
      <table class="itens-nfce">
        <tr><th>Cód</th><th>Descrição</th><th class="dir">Qtd</th><th class="dir">Un</th><th class="dir">Vl Unit</th><th class="dir">Vl Total</th></tr>
        ${venda.itens.map((i) => `
          <tr><td>${esc(i.produtoId).slice(0, 6)}</td><td>${esc(i.nome)}</td><td class="dir">${i.qtd}</td><td class="dir">UN</td>
              <td class="dir">${formatarMoeda(i.preco).replace('R$', '').trim()}</td>
              <td class="dir">${formatarMoeda(i.preco * i.qtd).replace('R$', '').trim()}</td></tr>`).join('')}
      </table>
      <hr>
      <table>
        <tr><td>Qtd. total de itens</td><td class="dir">${qtdItens}</td></tr>
        <tr><td>Valor total R$</td><td class="dir">${formatarMoeda(venda.subtotal).replace('R$', '').trim()}</td></tr>
        ${venda.desconto ? `<tr><td>Desconto R$</td><td class="dir">${formatarMoeda(venda.desconto).replace('R$', '').trim()}</td></tr>` : ''}
        <tr><td><strong>Valor a pagar R$</strong></td><td class="dir"><strong>${formatarMoeda(venda.total).replace('R$', '').trim()}</strong></td></tr>
        <tr><td>FORMA PAGAMENTO</td><td class="dir">VALOR PAGO R$</td></tr>
        <tr><td>${FORMAS_NFCE[venda.pagamento] || esc(venda.pagamento)}</td><td class="dir">${formatarMoeda(venda.recebido).replace('R$', '').trim()}</td></tr>
        ${venda.troco ? `<tr><td>Troco R$</td><td class="dir">${formatarMoeda(venda.troco).replace('R$', '').trim()}</td></tr>` : ''}
      </table>
      <hr>
      <p class="centro">Consulte pela Chave de Acesso em<br>${esc(nota.urlConsulta || '')}<br>
        <span class="chave">${formatarChave(esc(nota.chave))}</span></p>
      <p class="centro">${nota.cpf ? `CONSUMIDOR CPF: ${formatarCpf(esc(nota.cpf))}` : 'CONSUMIDOR NÃO IDENTIFICADO'}</p>
      <p class="centro"><strong>NFC-e nº ${String(nota.numero).padStart(9, '0')} Série ${String(nota.serie).padStart(3, '0')}
        ${formatarDataHora(nota.dhEmi)}</strong></p>
      ${nota.protocolo ? `<p class="centro">Protocolo de autorização: ${esc(nota.protocolo)}<br>
        Data de autorização: ${formatarDataHora(nota.dhRecbto)}</p>` : ''}
      ${nota.qrCodeImagem ? `<p class="centro"><img class="qrcode" src="${esc(nota.qrCodeImagem)}" alt="QR Code da NFC-e"></p>` : ''}
      <p class="centro"><small>Pedido #${esc(venda.numero)}</small></p>
    </div>`;
  window.print();
}
