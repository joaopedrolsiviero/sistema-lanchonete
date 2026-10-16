// Tela do caixa (PDV): monta o pedido, recebe o pagamento e registra a venda.

import { esc, formatarMoeda, lerMoeda } from '../util.js';
import { FORMAS_PAGAMENTO, calcularTotais, registrarVenda } from '../store.js';
import { avisar, abrirDialogo, imprimirComanda, confirmar } from '../ui.js';

// O pedido em andamento fica guardado aqui, então trocar de aba não apaga o pedido.
const pedido = {
  itens: [], // [{produtoId, nome, preco, qtd, obs}]
  desconto: 0,
  pagamento: null,
  recebido: null,
  categoria: 'todas',
  busca: '',
};

function limparPedido() {
  Object.assign(pedido, { itens: [], desconto: 0, pagamento: null, recebido: null });
}

export function renderizar(raiz, app) {
  raiz.innerHTML = `
    <section class="pdv">
      <div class="pdv-produtos">
        <div class="filtros">
          <input type="search" class="busca" placeholder="Buscar produto..." value="${esc(pedido.busca)}">
          <div class="chips"></div>
        </div>
        <div class="grade"></div>
      </div>
      <aside class="pdv-pedido painel">
        <h2>Pedido</h2>
        <ul class="itens-pedido"></ul>
        <div class="fechamento">
          <label class="linha">Desconto (R$)
            <input type="text" inputmode="decimal" class="desconto" placeholder="0,00"
              value="${pedido.desconto ? (pedido.desconto / 100).toFixed(2).replace('.', ',') : ''}">
          </label>
          <div class="linha"><span>Subtotal</span><span class="subtotal"></span></div>
          <div class="linha total"><span>Total</span><span class="valor-total"></span></div>
          <div class="pagamentos">
            ${Object.entries(FORMAS_PAGAMENTO).map(([k, nome]) =>
              `<button type="button" class="btn pag" data-pag="${k}">${nome}</button>`).join('')}
          </div>
          <div class="dinheiro" hidden>
            <label class="linha">Valor recebido
              <input type="text" inputmode="decimal" class="recebido" placeholder="0,00"
                value="${pedido.recebido ? (pedido.recebido / 100).toFixed(2).replace('.', ',') : ''}">
            </label>
            <div class="linha"><span>Troco</span><strong class="troco"></strong></div>
          </div>
          <button type="button" class="btn primario grande finalizar">Finalizar pedido</button>
          <button type="button" class="btn link limpar">Limpar pedido</button>
        </div>
      </aside>
    </section>`;

  const $ = (sel) => raiz.querySelector(sel);

  function renderizarChips() {
    const cats = [{ id: 'todas', nome: 'Todos' }, ...app.estado.categorias];
    $('.chips').innerHTML = cats.map((c) =>
      `<button type="button" class="chip ${pedido.categoria === c.id ? 'ativo' : ''}" data-cat="${c.id}">${esc(c.nome)}</button>`,
    ).join('');
  }

  function renderizarGrade() {
    const termo = pedido.busca.trim().toLowerCase();
    const produtos = app.estado.produtos.filter((p) =>
      p.ativo
      && (pedido.categoria === 'todas' || p.categoriaId === pedido.categoria)
      && (!termo || p.nome.toLowerCase().includes(termo)));
    $('.grade').innerHTML = produtos.length
      ? produtos.map((p) => `
          <button type="button" class="produto" data-id="${p.id}">
            <span class="nome">${esc(p.nome)}</span>
            <span class="preco">${formatarMoeda(p.preco)}</span>
          </button>`).join('')
      : '<p class="vazio">Nenhum produto encontrado. Cadastre produtos na aba Cardápio.</p>';
  }

  function renderizarItens() {
    $('.itens-pedido').innerHTML = pedido.itens.length
      ? pedido.itens.map((i, idx) => `
          <li>
            <div class="item-info">
              <strong>${esc(i.nome)}</strong>
              <span class="muted">${formatarMoeda(i.preco)} cada</span>
              ${i.obs ? `<span class="obs">obs: ${esc(i.obs)}</span>` : ''}
            </div>
            <div class="item-qtd">
              <button type="button" class="btn mini" data-menos="${idx}" aria-label="Diminuir">−</button>
              <span>${i.qtd}</span>
              <button type="button" class="btn mini" data-mais="${idx}" aria-label="Aumentar">+</button>
            </div>
            <div class="item-total">${formatarMoeda(i.preco * i.qtd)}
              <button type="button" class="btn link mini" data-obs="${idx}">obs</button>
            </div>
          </li>`).join('')
      : '<li class="vazio">Toque nos produtos para adicionar.</li>';
    atualizarTotais();
  }

  function atualizarTotais() {
    const t = calcularTotais(pedido.itens, pedido.desconto);
    $('.subtotal').textContent = formatarMoeda(t.subtotal);
    $('.valor-total').textContent = formatarMoeda(t.total);
    raiz.querySelectorAll('[data-pag]').forEach((b) =>
      b.classList.toggle('ativo', b.dataset.pag === pedido.pagamento));
    const emDinheiro = pedido.pagamento === 'dinheiro';
    $('.dinheiro').hidden = !emDinheiro;
    if (emDinheiro) {
      const troco = (pedido.recebido ?? 0) - t.total;
      $('.troco').textContent = pedido.recebido == null ? '—' : troco < 0 ? 'Valor insuficiente' : formatarMoeda(troco);
      $('.troco').classList.toggle('negativo', pedido.recebido != null && troco < 0);
    }
    $('.finalizar').disabled = !pedido.itens.length;
  }

  function adicionar(produto) {
    const existente = pedido.itens.find((i) => i.produtoId === produto.id && !i.obs);
    if (existente) existente.qtd += 1;
    else pedido.itens.push({ produtoId: produto.id, nome: produto.nome, preco: produto.preco, qtd: 1, obs: '' });
    renderizarItens();
  }

  function finalizar() {
    try {
      const venda = registrarVenda(app.estado, pedido.itens, {
        desconto: pedido.desconto,
        pagamento: pedido.pagamento,
        recebido: pedido.recebido ?? undefined,
      });
      app.salvar();
      limparPedido();
      renderizar(raiz, app);
      abrirDialogo({
        titulo: `Pedido #${venda.numero} registrado`,
        corpo: `
          <p class="destaque">Total: <strong>${formatarMoeda(venda.total)}</strong></p>
          ${venda.troco ? `<p class="destaque">Troco: <strong>${formatarMoeda(venda.troco)}</strong></p>` : ''}`,
        textoSalvar: 'Imprimir comanda',
        aoSalvar: () => setTimeout(() => imprimirComanda(venda, app.estado.config.nomeLoja), 50),
      });
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  // ----- Eventos -----
  $('.busca').addEventListener('input', (ev) => { pedido.busca = ev.target.value; renderizarGrade(); });

  $('.chips').addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-cat]');
    if (!chip) return;
    pedido.categoria = chip.dataset.cat;
    renderizarChips();
    renderizarGrade();
  });

  $('.grade').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-id]');
    if (!btn) return;
    const produto = app.estado.produtos.find((p) => p.id === btn.dataset.id);
    if (produto) adicionar(produto);
  });

  $('.itens-pedido').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.mais) pedido.itens[b.dataset.mais].qtd += 1;
    if (b.dataset.menos) {
      const item = pedido.itens[b.dataset.menos];
      item.qtd -= 1;
      if (item.qtd <= 0) pedido.itens.splice(b.dataset.menos, 1);
    }
    if (b.dataset.obs) {
      const item = pedido.itens[b.dataset.obs];
      const obs = window.prompt(`Observação para ${item.nome} (ex: sem cebola):`, item.obs);
      if (obs !== null) item.obs = obs.trim();
    }
    renderizarItens();
  });

  $('.desconto').addEventListener('input', (ev) => { pedido.desconto = lerMoeda(ev.target.value) || 0; atualizarTotais(); });
  $('.recebido').addEventListener('input', (ev) => { pedido.recebido = lerMoeda(ev.target.value); atualizarTotais(); });
  $('.recebido').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') finalizar(); });

  raiz.querySelector('.pagamentos').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pag]');
    if (!b) return;
    pedido.pagamento = b.dataset.pag;
    atualizarTotais();
    if (pedido.pagamento === 'dinheiro') $('.recebido').focus();
  });

  $('.finalizar').addEventListener('click', finalizar);
  $('.limpar').addEventListener('click', () => {
    if (pedido.itens.length && !confirmar('Limpar o pedido atual?')) return;
    limparPedido();
    renderizar(raiz, app);
  });

  renderizarChips();
  renderizarGrade();
  renderizarItens();
}
