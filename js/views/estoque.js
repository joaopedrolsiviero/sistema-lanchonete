// Tela de estoque: insumos, quantidades, estoque mínimo e entradas (compras).

import { esc, lerNumero, formatarQtd } from '../util.js';
import { salvarInsumo, removerInsumo, entradaEstoque, insumosEmFalta } from '../store.js';
import { avisar, abrirDialogo, confirmar } from '../ui.js';

export function renderizar(raiz, app) {
  const { estado } = app;
  const emFalta = insumosEmFalta(estado);
  const insumos = [...estado.insumos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  raiz.innerHTML = `
    <section class="pagina">
      <div class="cabecalho">
        <h1>Estoque</h1>
        <button type="button" class="btn primario" data-acao="novo">+ Novo insumo</button>
      </div>
      ${emFalta.length ? `
        <div class="alerta">
          <strong>Repor:</strong> ${emFalta.map((i) => esc(i.nome)).join(', ')}
        </div>` : ''}
      <div class="painel">
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Insumo</th><th class="dir">Em estoque</th><th class="dir">Mínimo</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              ${insumos.map((i) => {
                const falta = i.qtd <= i.minimo;
                return `
                <tr>
                  <td>${esc(i.nome)}</td>
                  <td class="dir">${formatarQtd(i.qtd)} ${esc(i.unidade)}</td>
                  <td class="dir">${formatarQtd(i.minimo)} ${esc(i.unidade)}</td>
                  <td>${i.qtd < 0 ? '<span class="tag perigo">negativo</span>'
                    : falta ? '<span class="tag aviso">baixo</span>' : '<span class="tag ok">ok</span>'}</td>
                  <td class="dir nowrap">
                    <button type="button" class="btn mini primario" data-entrada="${esc(i.id)}">+ Entrada</button>
                    <button type="button" class="btn mini" data-editar="${esc(i.id)}">Editar</button>
                    <button type="button" class="btn mini perigo" data-remover="${esc(i.id)}">Remover</button>
                  </td>
                </tr>`;
              }).join('') || '<tr><td colspan="5" class="vazio">Nenhum insumo cadastrado.</td></tr>'}
            </tbody>
          </table>
        </div>
        <p class="muted">O estoque baixa automaticamente a cada venda, conforme a ficha técnica dos produtos (aba Cardápio).
        Venda cancelada devolve os insumos.</p>
      </div>
    </section>`;

  const atualizar = () => { app.salvar(); renderizar(raiz, app); };

  function dialogoInsumo(insumo) {
    abrirDialogo({
      titulo: insumo ? 'Editar insumo' : 'Novo insumo',
      corpo: `
        <label>Nome <input name="nome" required value="${esc(insumo?.nome || '')}"></label>
        <label>Unidade (un, kg, L, pct...) <input name="unidade" value="${esc(insumo?.unidade || 'un')}"></label>
        <label>Quantidade atual <input name="qtd" inputmode="decimal" value="${insumo ? formatarQtd(insumo.qtd) : '0'}"></label>
        <label>Estoque mínimo (alerta) <input name="minimo" inputmode="decimal" value="${insumo ? formatarQtd(insumo.minimo) : '0'}"></label>`,
      aoSalvar: (form) => {
        const qtd = lerNumero(form.qtd.value);
        const minimo = lerNumero(form.minimo.value);
        if (qtd == null || minimo == null) throw new Error('Quantidades inválidas.');
        salvarInsumo(estado, { id: insumo?.id, nome: form.nome.value, unidade: form.unidade.value, qtd, minimo });
        atualizar();
      },
    });
  }

  function dialogoEntrada(insumo) {
    abrirDialogo({
      titulo: `Entrada: ${insumo.nome}`,
      corpo: `
        <p class="muted">Atual: ${formatarQtd(insumo.qtd)} ${esc(insumo.unidade)}</p>
        <label>Quantidade que chegou (${esc(insumo.unidade)}) <input name="qtd" inputmode="decimal" required></label>`,
      textoSalvar: 'Adicionar',
      aoSalvar: (form) => {
        entradaEstoque(estado, insumo.id, lerNumero(form.qtd.value));
        atualizar();
        avisar('Estoque atualizado.');
      },
    });
  }

  // Eventos no elemento recriado a cada renderização (evita ouvintes duplicados).
  raiz.firstElementChild.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const achar = (id) => estado.insumos.find((i) => i.id === id);
    if (b.dataset.acao === 'novo') dialogoInsumo();
    if (b.dataset.editar) dialogoInsumo(achar(b.dataset.editar));
    if (b.dataset.entrada) dialogoEntrada(achar(b.dataset.entrada));
    if (b.dataset.remover && confirmar('Remover este insumo? Ele também sai da ficha técnica dos produtos.')) {
      removerInsumo(estado, b.dataset.remover);
      atualizar();
    }
  });
}
