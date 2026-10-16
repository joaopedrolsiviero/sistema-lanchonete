// Tela do caixa (PDV): monta o pedido, recebe o pagamento, emite a NFC-e e registra a venda.

import { esc, formatarMoeda, lerMoeda, gerarId } from '../util.js';
import {
  FORMAS_PAGAMENTO, calcularTotais, registrarVenda, caixaAberto, prepararVenda, fiscalAtivo,
  produtosSemNcm, proximoNumeroPedido,
} from '../store.js';
import {
  avisar, abrirDialogo, fecharDialogo, imprimirComanda, imprimirNfce, confirmar,
} from '../ui.js';
import { emitir, montarPedidoFiscal, resumoNota } from '../fiscal.js';
import { renderizarAbertura, montarBarraCaixa } from './caixa.js';

// O pedido em andamento fica guardado aqui, então trocar de aba não apaga o pedido.
const pedido = {
  itens: [], // [{produtoId, nome, preco, qtd, obs}]
  desconto: 0,
  pagamento: null,
  recebido: null,
  cpf: '',
  categoria: 'todas',
  busca: '',
};

function limparPedido() {
  Object.assign(pedido, { itens: [], desconto: 0, pagamento: null, recebido: null, cpf: '' });
}

export function renderizar(raiz, app) {
  const caixa = caixaAberto(app.estado);
  if (!caixa) {
    renderizarAbertura(raiz, app, () => renderizar(raiz, app));
    return;
  }

  raiz.innerHTML = `
    <div class="barra-caixa painel"></div>
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
          ${fiscalAtivo(app.estado) ? `
            <label class="linha">CPF na nota (opcional)
              <input type="text" inputmode="numeric" class="cpf" placeholder="000.000.000-00" maxlength="14"
                value="${esc(pedido.cpf)}">
            </label>` : ''}
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
      `<button type="button" class="chip ${pedido.categoria === c.id ? 'ativo' : ''}" data-cat="${esc(c.id)}">${esc(c.nome)}</button>`,
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
          <button type="button" class="produto" data-id="${esc(p.id)}">
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

  let finalizando = false;

  function opcoesVenda() {
    return { desconto: pedido.desconto, pagamento: pedido.pagamento, recebido: pedido.recebido ?? undefined };
  }

  /** Grava a venda (com ou sem nota) e mostra o resumo com a opção de imprimir. */
  function concluir(extra, nota) {
    const venda = registrarVenda(app.estado, pedido.itens, { ...opcoesVenda(), ...extra });
    app.salvar();
    limparPedido();
    renderizar(raiz, app);
    const linhaNota = !nota ? ''
      : nota.contingencia
        ? `<p class="aviso-nfce">NFC-e nº ${nota.numero} emitida <strong>em contingência</strong> (sem internet).
             Ela será enviada à SEFAZ automaticamente quando a conexão voltar.</p>`
        : `<p class="ok">NFC-e nº ${nota.numero} autorizada.</p>`;
    abrirDialogo({
      titulo: `Pedido #${venda.numero} registrado`,
      corpo: `
        ${linhaNota}
        ${extra.nfce?.situacao === 'pendente_emissao'
          ? '<p class="aviso-nfce">Venda registrada <strong>sem nota fiscal</strong>. Emita a NFC-e em Relatórios assim que o serviço fiscal voltar.</p>'
          : ''}
        <p class="destaque">Total: <strong>${formatarMoeda(venda.total)}</strong></p>
        ${venda.troco ? `<p class="destaque">Troco: <strong>${formatarMoeda(venda.troco)}</strong></p>` : ''}`,
      textoSalvar: nota ? 'Imprimir NFC-e' : 'Imprimir comanda',
      textoFechar: 'Fechar',
      aoSalvar: () => setTimeout(() => (nota
        ? imprimirNfce(venda, nota)
        : imprimirComanda(venda, app.estado.config.nomeLoja)), 50),
    });
  }

  async function finalizar() {
    if (finalizando) return;
    try {
      prepararVenda(app.estado, pedido.itens, opcoesVenda()); // confere tudo antes de emitir a nota
    } catch (e) {
      avisar(e.message, 'erro');
      return;
    }
    if (!fiscalAtivo(app.estado)) {
      concluir({});
      return;
    }

    const cpf = pedido.cpf.replace(/\D/g, '');
    if (cpf && !cpfValido(cpf)) {
      avisar('CPF inválido. Corrija ou deixe em branco.', 'erro');
      return;
    }
    const semNcm = produtosSemNcm(app.estado, pedido.itens);
    if (semNcm.length) {
      avisar(`Cadastre o NCM no Cardápio antes de vender: ${semNcm.join(', ')}.`, 'erro');
      return;
    }

    const { totais, recebido, troco } = prepararVenda(app.estado, pedido.itens, opcoesVenda());
    const vendaId = gerarId();
    const pedidoFiscal = montarPedidoFiscal(app.estado, {
      vendaId, numeroPedido: proximoNumeroPedido(app.estado), itens: pedido.itens,
      desconto: totais.desconto, pagamento: pedido.pagamento, recebido, troco, cpf,
    });

    const tentar = async () => {
      finalizando = true;
      $('.finalizar').disabled = true;
      abrirDialogo({ titulo: 'Emitindo NFC-e…', corpo: '<p>Aguarde a autorização da SEFAZ.</p>', bloqueado: true });
      try {
        const nota = await emitir(app.estado, pedidoFiscal);
        fecharDialogo();
        concluir({ id: vendaId, cpf: cpf || undefined, nfce: resumoNota(nota) }, nota);
      } catch (e) {
        fecharDialogo();
        if (e.tipo === 'rede') {
          // Serviço fiscal fora do ar: oferece tentar de novo ou registrar a venda para emitir a nota depois.
          setTimeout(() => abrirDialogo({
            titulo: 'NFC-e não emitida',
            corpo: `<p>${esc(e.message)}</p>
              <p class="muted">"Registrar sem nota" grava a venda; a NFC-e fica pendente e pode ser emitida
                depois em Relatórios (a mesma venda nunca gera duas notas).</p>
              <p><button type="button" class="btn" data-acao="sem-nota">Registrar sem nota</button></p>`,
            textoSalvar: 'Tentar de novo',
            aoMontar: (form) => form.querySelector('[data-acao="sem-nota"]').addEventListener('click', () => {
              fecharDialogo();
              concluir({ id: vendaId, cpf: cpf || undefined, nfce: { situacao: 'pendente_emissao' } });
            }),
            aoSalvar: () => setTimeout(tentar, 0),
          }), 0);
        } else {
          setTimeout(() => abrirDialogo({
            titulo: 'NFC-e recusada',
            corpo: `<p>${esc(e.message)}</p><p class="muted">A venda não foi registrada. Corrija e finalize de novo.</p>`,
            textoFechar: 'Fechar',
          }), 0);
        }
      } finally {
        finalizando = false;
        const botao = $('.finalizar');
        if (botao) botao.disabled = !pedido.itens.length;
      }
    };
    await tentar();
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
      const obs = window.prompt(`Observação para ${item.nome} (ex: sem açúcar):`, item.obs);
      if (obs !== null) item.obs = obs.trim();
    }
    renderizarItens();
  });

  $('.desconto').addEventListener('input', (ev) => { pedido.desconto = lerMoeda(ev.target.value) || 0; atualizarTotais(); });
  $('.recebido').addEventListener('input', (ev) => { pedido.recebido = lerMoeda(ev.target.value); atualizarTotais(); });
  $('.recebido').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') finalizar(); });
  $('.cpf')?.addEventListener('input', (ev) => { pedido.cpf = ev.target.value; });

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

  montarBarraCaixa($('.barra-caixa'), app, caixa, () => renderizar(raiz, app));
  renderizarChips();
  renderizarGrade();
  renderizarItens();
}

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    if (Number(cpf[t]) !== ((10 * soma) % 11) % 10) return false;
  }
  return true;
}
