// Tela de relatórios: faturamento, formas de pagamento, produtos mais vendidos e histórico de pedidos.

import { esc, formatarMoeda, chaveDia, somarDias, formatarDataHora, formatarDia, gerarCsv } from '../util.js';
import {
  FORMAS_PAGAMENTO, vendasNoPeriodo, resumirVendas, cancelarVenda, SITUACOES_NFCE, fiscalAtivo,
} from '../store.js';
import { avisar, abrirDialogo, fecharDialogo, imprimirComanda, imprimirNfce, confirmar } from '../ui.js';
import * as fiscal from '../fiscal.js';

/** Etiqueta da situação da NFC-e de uma venda. */
function etiquetaNfce(v) {
  const n = v.nfce;
  if (!n) return '<span class="muted">—</span>';
  const classe = { autorizada: 'ok', cancelada: 'perigo', denegada: 'perigo', rejeitada_contingencia: 'perigo' }[n.situacao] || 'aviso';
  const partes = [n.numero ? `nº ${n.numero}` : '', n.situacao === 'autorizada' ? '' : SITUACOES_NFCE[n.situacao]];
  return `<span class="tag ${classe}">${esc(partes.filter(Boolean).join(' · '))}</span>`;
}
import { dialogoDetalheCaixa, textoDiferenca } from './caixa.js';

const filtro = { periodo: 'hoje', de: null, ate: null };

function calcularPeriodo() {
  const hoje = chaveDia();
  switch (filtro.periodo) {
    case 'ontem': { const d = somarDias(hoje, -1); return [d, d]; }
    case '7dias': return [somarDias(hoje, -6), hoje];
    case 'mes': return [`${hoje.slice(0, 7)}-01`, hoje];
    case 'personalizado': return [filtro.de || hoje, filtro.ate || hoje];
    default: return [hoje, hoje];
  }
}

function baixarCsv(vendas, de, ate) {
  const linhas = [['Pedido', 'Data', 'Itens', 'Subtotal', 'Desconto', 'Total', 'Pagamento', 'Situação']];
  for (const v of [...vendas].reverse()) {
    linhas.push([
      v.numero,
      formatarDataHora(v.data),
      v.itens.map((i) => `${i.qtd}x ${i.nome}`).join(' | '),
      (v.subtotal / 100).toFixed(2).replace('.', ','),
      (v.desconto / 100).toFixed(2).replace('.', ','),
      (v.total / 100).toFixed(2).replace('.', ','),
      FORMAS_PAGAMENTO[v.pagamento],
      v.cancelada ? 'Cancelada' : 'OK',
    ]);
  }
  const csv = gerarCsv(linhas);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `vendas_${de}_a_${ate}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function renderizar(raiz, app) {
  const { estado } = app;
  const [de, ate] = calcularPeriodo();
  const vendas = vendasNoPeriodo(estado, de, ate);
  const r = resumirVendas(vendas);
  const maxProduto = Math.max(1, ...r.produtos.map((p) => p.qtd));
  const caixaFechado = (v) => estado.caixas.find((c) => c.id === v.caixaId)?.fechamento;
  const caixas = estado.caixas
    .filter((c) => { const d = chaveDia(c.abertura); return d >= de && d <= ate; })
    .reverse();

  const opcoes = { hoje: 'Hoje', ontem: 'Ontem', '7dias': 'Últimos 7 dias', mes: 'Este mês', personalizado: 'Escolher datas' };

  raiz.innerHTML = `
    <section class="pagina">
      <div class="cabecalho">
        <h1>Relatórios</h1>
        <button type="button" class="btn" data-acao="csv" ${vendas.length ? '' : 'disabled'}>Exportar planilha (CSV)</button>
      </div>

      <div class="filtros">
        <div class="chips">
          ${Object.entries(opcoes).map(([k, nome]) =>
            `<button type="button" class="chip ${filtro.periodo === k ? 'ativo' : ''}" data-periodo="${k}">${nome}</button>`).join('')}
        </div>
        ${filtro.periodo === 'personalizado' ? `
          <div class="datas">
            <label>De <input type="date" name="de" value="${de}"></label>
            <label>Até <input type="date" name="ate" value="${ate}"></label>
          </div>` : ''}
        <p class="muted">${de === ate ? formatarDia(de) : `${formatarDia(de)} a ${formatarDia(ate)}`}</p>
      </div>

      <div class="cartoes">
        <div class="cartao"><span>Faturamento</span><strong>${formatarMoeda(r.total)}</strong></div>
        <div class="cartao"><span>Pedidos</span><strong>${r.pedidos}</strong></div>
        <div class="cartao"><span>Ticket médio</span><strong>${formatarMoeda(r.ticketMedio)}</strong></div>
        <div class="cartao"><span>Cancelados</span><strong>${r.cancelados}</strong></div>
      </div>

      <div class="duas-colunas">
        <div class="painel">
          <h2>Por forma de pagamento</h2>
          <table class="tabela">
            ${Object.entries(FORMAS_PAGAMENTO).map(([k, nome]) =>
              `<tr><td>${nome}</td><td class="dir">${formatarMoeda(r.porPagamento[k] || 0)}</td></tr>`).join('')}
            ${r.descontos ? `<tr><td class="muted">Descontos concedidos</td><td class="dir muted">${formatarMoeda(r.descontos)}</td></tr>` : ''}
          </table>
        </div>
        <div class="painel">
          <h2>Mais vendidos</h2>
          ${r.produtos.length ? `<table class="tabela">
            ${r.produtos.slice(0, 10).map((p) => `
              <tr>
                <td>${esc(p.nome)}<div class="barra"><span style="width:${(p.qtd / maxProduto) * 100}%"></span></div></td>
                <td class="dir">${p.qtd}</td>
                <td class="dir">${formatarMoeda(p.total)}</td>
              </tr>`).join('')}
          </table>` : '<p class="muted">Sem vendas no período.</p>'}
        </div>
      </div>

      <div class="painel">
        <h2>Aberturas e fechamentos de caixa</h2>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Abertura</th><th>Fechamento</th><th class="dir">Vendas</th>
              <th class="dir">Dinheiro esperado</th><th class="dir">Contado</th><th>Diferença</th><th></th></tr></thead>
            <tbody>
              ${caixas.map((c) => {
                const f = c.fechamento;
                return `
                <tr>
                  <td class="nowrap">${formatarDataHora(c.abertura)}</td>
                  <td class="nowrap">${f ? formatarDataHora(f.data) : '<span class="tag ok">aberto</span>'}</td>
                  <td class="dir">${f ? formatarMoeda(f.resumo.total) : '—'}</td>
                  <td class="dir">${f ? formatarMoeda(f.resumo.dinheiroEsperado) : '—'}</td>
                  <td class="dir">${f ? formatarMoeda(f.contado) : '—'}</td>
                  <td>${f ? `<span class="tag ${f.diferenca === 0 ? 'ok' : 'perigo'}">${textoDiferenca(f.diferenca)}</span>` : ''}</td>
                  <td class="dir"><button type="button" class="btn mini" data-caixa="${esc(c.id)}">Ver</button></td>
                </tr>`;
              }).join('') || '<tr><td colspan="7" class="vazio">Nenhum caixa aberto no período.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="painel">
        <h2>Pedidos</h2>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>#</th><th>Data</th><th>Itens</th><th>Pagamento</th><th>NFC-e</th><th class="dir">Total</th><th></th></tr></thead>
            <tbody>
              ${vendas.map((v) => `
                <tr class="${v.cancelada ? 'cancelada' : ''}">
                  <td>${esc(v.numero)}</td>
                  <td class="nowrap">${formatarDataHora(v.data)}</td>
                  <td>${v.itens.map((i) => `${i.qtd}x ${esc(i.nome)}`).join(', ')}</td>
                  <td>${FORMAS_PAGAMENTO[v.pagamento]}</td>
                  <td>${etiquetaNfce(v)}</td>
                  <td class="dir">${formatarMoeda(v.total)}${v.cancelada ? ' <span class="tag perigo">cancelado</span>' : ''}</td>
                  <td class="dir nowrap">
                    <button type="button" class="btn mini" data-ver="${esc(v.id)}">Ver</button>
                    ${!v.cancelada && v.nfce?.situacao === 'pendente_emissao' && fiscalAtivo(estado)
                      ? `<button type="button" class="btn mini primario" data-emitir="${esc(v.id)}">Emitir NFC-e</button>` : ''}
                    ${v.cancelada || caixaFechado(v) ? '' : `<button type="button" class="btn mini perigo" data-cancelar="${esc(v.id)}">Cancelar</button>`}
                  </td>
                </tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum pedido no período.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>`;

  const pagina = raiz.firstElementChild;

  pagina.addEventListener('change', (ev) => {
    if (ev.target.name === 'de' || ev.target.name === 'ate') {
      filtro[ev.target.name] = ev.target.value;
      renderizar(raiz, app);
    }
  });

  pagina.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.periodo) {
      filtro.periodo = b.dataset.periodo;
      if (filtro.periodo === 'personalizado') [filtro.de, filtro.ate] = [de, ate];
      renderizar(raiz, app);
    }
    if (b.dataset.acao === 'csv') baixarCsv(vendas, de, ate);
    if (b.dataset.caixa) dialogoDetalheCaixa(app, estado.caixas.find((c) => c.id === b.dataset.caixa));
    if (b.dataset.ver) verPedido(estado.vendas.find((x) => x.id === b.dataset.ver));
    if (b.dataset.emitir) emitirPendente(estado.vendas.find((x) => x.id === b.dataset.emitir));
    if (b.dataset.cancelar) cancelarPedido(estado.vendas.find((x) => x.id === b.dataset.cancelar));
  });

  function verPedido(v) {
    const comNota = Boolean(v.nfce?.chave) && fiscalAtivo(estado);
    abrirDialogo({
      titulo: `Pedido #${v.numero}${v.cancelada ? ' (cancelado)' : ''}`,
      corpo: `
        <p class="muted">${formatarDataHora(v.data)} · ${FORMAS_PAGAMENTO[v.pagamento]}</p>
        <ul class="lista-simples">
          ${v.itens.map((i) => `<li>${i.qtd}x ${esc(i.nome)} — ${formatarMoeda(i.preco * i.qtd)}${i.obs ? `<br><small>obs: ${esc(i.obs)}</small>` : ''}</li>`).join('')}
        </ul>
        ${v.desconto ? `<p>Desconto: ${formatarMoeda(v.desconto)}</p>` : ''}
        <p class="destaque">Total: <strong>${formatarMoeda(v.total)}</strong></p>
        ${v.troco ? `<p>Recebido ${formatarMoeda(v.recebido)} · troco ${formatarMoeda(v.troco)}</p>` : ''}
        ${v.nfce ? `<p>NFC-e: ${etiquetaNfce(v)}</p>` : ''}
        ${v.nfce?.chave ? `<p class="muted chave-nfce">Chave: ${esc(v.nfce.chave)}</p>` : ''}
        ${comNota ? '<p><button type="button" class="btn mini" data-acao="comanda">Reimprimir comanda</button></p>' : ''}`,
      textoSalvar: comNota ? 'Reimprimir NFC-e' : 'Reimprimir comanda',
      textoFechar: 'Fechar',
      aoMontar: (form) => form.querySelector('[data-acao="comanda"]')?.addEventListener('click', () => {
        fecharDialogo();
        setTimeout(() => imprimirComanda(v, estado.config.nomeLoja), 50);
      }),
      aoSalvar: async () => {
        if (!comNota) {
          setTimeout(() => imprimirComanda(v, estado.config.nomeLoja), 50);
          return;
        }
        const nota = await fiscal.consultarNota(estado, v.nfce.chave); // erro mantém o diálogo aberto com a mensagem
        atualizarNota(v, nota);
        setTimeout(() => imprimirNfce(v, nota), 50);
      },
    });
  }

  function atualizarNota(v, nota) {
    if (v.nfce?.situacao !== nota.situacao) {
      v.nfce = fiscal.resumoNota(nota);
      app.salvar();
    }
  }

  async function emitirPendente(v) {
    abrirDialogo({ titulo: 'Emitindo NFC-e…', corpo: '<p>Aguarde a autorização da SEFAZ.</p>', bloqueado: true });
    try {
      const nota = await fiscal.emitir(estado, fiscal.montarPedidoFiscal(estado, {
        vendaId: v.id, numeroPedido: v.numero, itens: v.itens, desconto: v.desconto,
        pagamento: v.pagamento, recebido: v.recebido, troco: v.troco, cpf: v.cpf,
      }));
      v.nfce = fiscal.resumoNota(nota);
      app.salvar();
      fecharDialogo();
      renderizar(raiz, app);
      setTimeout(() => abrirDialogo({
        titulo: `NFC-e nº ${nota.numero} ${nota.contingencia ? 'emitida em contingência' : 'autorizada'}`,
        corpo: `<p>Pedido #${v.numero} · ${formatarMoeda(v.total)}</p>`,
        textoSalvar: 'Imprimir NFC-e',
        textoFechar: 'Fechar',
        aoSalvar: () => setTimeout(() => imprimirNfce(v, nota), 50),
      }), 0);
    } catch (e) {
      fecharDialogo();
      avisar(e.message, 'erro');
    }
  }

  function cancelarPedido(v) {
    const autorizada = v.nfce?.situacao === 'autorizada' || v.nfce?.situacao === 'contingencia';
    if (!autorizada || !fiscalAtivo(estado)) {
      if (!confirmar('Cancelar este pedido? Os insumos voltam para o estoque.')) return;
      try {
        cancelarVenda(estado, v.id);
        app.salvar();
        avisar('Pedido cancelado.');
        renderizar(raiz, app);
      } catch (e) {
        avisar(e.message, 'erro');
      }
      return;
    }
    // Com NFC-e: cancela primeiro na SEFAZ; só depois cancela a venda no caixa.
    abrirDialogo({
      titulo: `Cancelar pedido #${v.numero} e a NFC-e nº ${v.nfce.numero}`,
      corpo: `
        <p>A nota será cancelada na SEFAZ e os insumos voltam para o estoque.
          O prazo para cancelar NFC-e é curto: faça logo após a venda.</p>
        <label>Motivo do cancelamento (mínimo 15 letras)
          <input name="justificativa" required minlength="15" maxlength="255" placeholder="Ex.: cliente desistiu da compra"></label>`,
      textoSalvar: 'Cancelar pedido e nota',
      textoFechar: 'Voltar',
      aoSalvar: async (form) => {
        const justificativa = form.justificativa.value.trim();
        if (justificativa.length < 15) throw new Error('Escreva um motivo com pelo menos 15 letras.');
        const nota = await fiscal.cancelarNota(estado, v.nfce.chave, justificativa);
        v.nfce = fiscal.resumoNota(nota);
        cancelarVenda(estado, v.id);
        app.salvar();
        avisar('Pedido e NFC-e cancelados.');
        setTimeout(() => renderizar(raiz, app), 0);
      },
    });
  }
}
