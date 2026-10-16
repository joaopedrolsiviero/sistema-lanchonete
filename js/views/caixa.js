// Abertura, sangria/suprimento e fechamento de caixa (usado nas telas Caixa e Relatórios).
//
// Contagem às cegas: enquanto o caixa está aberto, o sistema não mostra quanto dinheiro deveria
// haver na gaveta. Quem fecha conta o dinheiro sem saber o esperado; o resultado (esperado,
// diferença) só aparece depois que a contagem foi registrada.

import { esc, formatarMoeda, lerMoeda, formatarDataHora, chaveDia } from '../util.js';
import { FORMAS_PAGAMENTO, TIPOS_MOVIMENTO, abrirCaixa, movimentarCaixa, fecharCaixa } from '../store.js';
import { avisar, abrirDialogo, imprimirFechamento } from '../ui.js';

/** Texto da diferença entre o contado e o esperado. */
export function textoDiferenca(diferenca) {
  if (diferenca === 0) return 'Confere ✔';
  return diferenca > 0 ? `Sobra de ${formatarMoeda(diferenca)}` : `Falta de ${formatarMoeda(-diferenca)}`;
}

/** Tela mostrada no lugar do caixa enquanto ele está fechado. */
export function renderizarAbertura(raiz, app, aoAbrir) {
  const ultimo = [...app.estado.caixas].reverse().find((c) => c.fechamento);
  raiz.innerHTML = `
    <section class="pagina estreita">
      <form class="painel abertura-caixa">
        <h1>Caixa fechado</h1>
        <p class="muted">Para começar a vender, abra o caixa informando quanto dinheiro há na gaveta para troco.</p>
        <label>Fundo de troco (R$)
          <input name="fundo" inputmode="decimal" placeholder="0,00" required autofocus>
        </label>
        ${ultimo ? `<p class="muted">No último fechamento (${formatarDataHora(ultimo.fechamento.data)})
          foram contados ${formatarMoeda(ultimo.fechamento.contado)} na gaveta.</p>` : ''}
        <button type="submit" class="btn primario grande">Abrir caixa</button>
      </form>
    </section>`;

  raiz.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const fundo = lerMoeda(ev.target.fundo.value);
      if (fundo == null) throw new Error('Informe o fundo de troco (pode ser 0).');
      abrirCaixa(app.estado, { fundo });
      app.salvar();
      avisar('Caixa aberto. Boas vendas!');
      aoAbrir();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  });
}

/** Barra no topo do caixa: situação do caixa aberto + sangria, suprimento e fechamento. */
export function montarBarraCaixa(el, app, caixa, aoMudar) {
  const deOutroDia = chaveDia(caixa.abertura) !== chaveDia();
  el.innerHTML = `
    <div class="info-caixa">
      <span><strong>Caixa aberto</strong> desde ${formatarDataHora(caixa.abertura)}</span>
      ${deOutroDia ? '<span class="tag aviso">aberto em outro dia — feche e abra um novo</span>' : ''}
    </div>
    <div class="botoes">
      <button type="button" class="btn mini" data-mov="sangria">Sangria</button>
      <button type="button" class="btn mini" data-mov="suprimento">Suprimento</button>
      <button type="button" class="btn mini primario" data-acao="fechar-caixa">Fechar caixa</button>
    </div>`;

  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.mov) dialogoMovimento(app, b.dataset.mov, aoMudar);
    if (b.dataset.acao === 'fechar-caixa') dialogoFechamento(app, caixa, aoMudar);
  });
}

function dialogoMovimento(app, tipo, aoMudar) {
  const explicacao = tipo === 'sangria'
    ? 'Retirada de dinheiro da gaveta (ex.: levar ao banco, pagar um fornecedor).'
    : 'Entrada de dinheiro na gaveta (ex.: reforço de troco).';
  abrirDialogo({
    titulo: TIPOS_MOVIMENTO[tipo],
    corpo: `
      <p class="muted">${explicacao}</p>
      <label>Valor (R$) <input name="valor" inputmode="decimal" placeholder="0,00" required></label>
      <label>Motivo (opcional) <input name="motivo" maxlength="80"></label>`,
    textoSalvar: `Registrar ${TIPOS_MOVIMENTO[tipo].toLowerCase()}`,
    aoSalvar: (form) => {
      movimentarCaixa(app.estado, { tipo, valor: lerMoeda(form.valor.value), motivo: form.motivo.value });
      app.salvar();
      avisar(`${TIPOS_MOVIMENTO[tipo]} registrada.`);
      aoMudar();
    },
  });
}

/** Tabelas com o resumo de um caixa (usadas no fechamento e no histórico). */
export function htmlResumoCaixa(caixa, r) {
  const movimentos = caixa.movimentos.length
    ? `<h3>Sangrias e suprimentos</h3>
       <table class="tabela">
         ${caixa.movimentos.map((m) => `
           <tr><td>${formatarDataHora(m.data)}</td><td>${TIPOS_MOVIMENTO[m.tipo]}${m.motivo ? ` — ${esc(m.motivo)}` : ''}</td>
               <td class="dir">${m.tipo === 'sangria' ? '−' : '+'}${formatarMoeda(m.valor)}</td></tr>`).join('')}
       </table>`
    : '';
  return `
    <h3>Vendas</h3>
    <table class="tabela">
      <tr><td>Pedidos</td><td class="dir">${r.pedidos}${r.cancelados ? ` <span class="muted">(+${r.cancelados} cancelados)</span>` : ''}</td></tr>
      ${Object.entries(FORMAS_PAGAMENTO).map(([k, nome]) =>
        `<tr><td>${nome}</td><td class="dir">${formatarMoeda(r.porPagamento[k] || 0)}</td></tr>`).join('')}
      <tr><td><strong>Total</strong></td><td class="dir"><strong>${formatarMoeda(r.total)}</strong></td></tr>
    </table>
    <h3>Dinheiro na gaveta</h3>
    <table class="tabela">
      <tr><td>Fundo de troco</td><td class="dir">${formatarMoeda(caixa.fundo)}</td></tr>
      <tr><td>+ Vendas em dinheiro</td><td class="dir">${formatarMoeda(r.porPagamento.dinheiro || 0)}</td></tr>
      <tr><td>+ Suprimentos</td><td class="dir">${formatarMoeda(r.suprimentos)}</td></tr>
      <tr><td>− Sangrias</td><td class="dir">${formatarMoeda(r.sangrias)}</td></tr>
      <tr><td><strong>Esperado</strong></td><td class="dir"><strong>${formatarMoeda(r.dinheiroEsperado)}</strong></td></tr>
    </table>
    ${movimentos}`;
}

function dialogoFechamento(app, caixa, aoMudar) {
  abrirDialogo({
    titulo: 'Fechar caixa',
    corpo: `
      <p class="muted">Aberto em ${formatarDataHora(caixa.abertura)}</p>
      <p>Conte <strong>todo o dinheiro da gaveta</strong> (notas e moedas, incluindo o fundo de troco)
        e digite o valor abaixo. O resultado aparece depois de confirmar.</p>
      <label>Dinheiro contado na gaveta (R$)
        <input name="contado" inputmode="decimal" placeholder="0,00" required></label>
      <label>Observação (opcional) <input name="obs" maxlength="200"></label>
      <p class="muted">Depois de fechado, a contagem não pode ser alterada e não será possível
        registrar nem cancelar vendas deste caixa.</p>`,
    textoSalvar: 'Confirmar contagem e fechar',
    aoSalvar: (form) => {
      const contado = lerMoeda(form.contado.value);
      if (contado == null) throw new Error('Informe quanto dinheiro foi contado na gaveta.');
      fecharCaixa(app.estado, { contado, obs: form.obs.value });
      app.salvar();
      aoMudar();
      // abre o resultado depois que este diálogo fechar
      setTimeout(() => dialogoDetalheCaixa(app, caixa, { recemFechado: true }), 0);
    },
  });
}

/** Detalhes de um caixa (fechado ou aberto), com opção de imprimir. */
export function dialogoDetalheCaixa(app, caixa, { recemFechado = false } = {}) {
  const f = caixa.fechamento;
  if (!f) {
    // Contagem às cegas: nada de valores enquanto o caixa está aberto.
    abrirDialogo({
      titulo: 'Caixa aberto',
      corpo: `<p class="muted">Aberto em ${formatarDataHora(caixa.abertura)}</p>
        <p>O resumo e o dinheiro esperado na gaveta aparecem depois do fechamento (contagem às cegas).</p>`,
      textoFechar: 'Fechar',
    });
    return;
  }
  const r = f.resumo;
  abrirDialogo({
    titulo: recemFechado ? 'Caixa fechado' : 'Caixa',
    corpo: `
      <p class="muted">Abertura: ${formatarDataHora(caixa.abertura)}<br>
        Fechamento: ${formatarDataHora(f.data)}</p>
      <p class="destaque">Contado: <strong>${formatarMoeda(f.contado)}</strong> ·
        <span class="${f.diferenca === 0 ? 'ok' : 'alerta-texto'}">${textoDiferenca(f.diferenca)}</span></p>
      ${f.obs ? `<p>Obs.: ${esc(f.obs)}</p>` : ''}
      ${htmlResumoCaixa(caixa, r)}`,
    textoFechar: 'Fechar',
    textoSalvar: 'Imprimir relatório',
    aoSalvar: () => setTimeout(() => imprimirFechamento(caixa, r, app.estado.config.nomeLoja), 50),
  });
}
