// Tela do cardápio: categorias, produtos, preços e ficha técnica (insumos de cada produto).

import { esc, formatarMoeda, lerMoeda, lerNumero, formatarQtd } from '../util.js';
import {
  salvarCategoria, removerCategoria, salvarProduto, removerProduto, fiscalAtivo, dadosFiscaisProduto, PADRAO_FISCAL,
} from '../store.js';
import { avisar, abrirDialogo, confirmar } from '../ui.js';

export function renderizar(raiz, app) {
  const { estado } = app;
  const nomeCategoria = (id) => estado.categorias.find((c) => c.id === id)?.nome || 'Sem categoria';
  const nomeInsumo = (id) => estado.insumos.find((i) => i.id === id);
  const comNota = fiscalAtivo(estado);

  raiz.innerHTML = `
    <section class="pagina">
      <div class="cabecalho">
        <h1>Cardápio</h1>
        <button type="button" class="btn primario" data-acao="novo-produto">+ Novo produto</button>
      </div>

      <div class="painel">
        <div class="cabecalho">
          <h2>Categorias</h2>
          <button type="button" class="btn" data-acao="nova-categoria">+ Categoria</button>
        </div>
        <div class="lista-categorias">
          ${estado.categorias.map((c) => `
            <span class="tag">${esc(c.nome)}
              <button type="button" class="btn link mini" data-editar-cat="${esc(c.id)}">editar</button>
              <button type="button" class="btn link mini perigo" data-remover-cat="${esc(c.id)}">×</button>
            </span>`).join('') || '<p class="muted">Nenhuma categoria.</p>'}
        </div>
      </div>

      <div class="painel">
        <h2>Produtos</h2>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Produto</th><th>Categoria</th><th class="dir">Preço</th><th>Usa do estoque</th><th></th></tr></thead>
            <tbody>
              ${estado.produtos.map((p) => `
                <tr class="${p.ativo ? '' : 'inativo'}">
                  <td>${esc(p.nome)}${p.ativo ? '' : ' <span class="tag">inativo</span>'}
                    ${comNota && !dadosFiscaisProduto(estado, p).ncm ? ' <span class="tag aviso">sem NCM</span>' : ''}</td>
                  <td>${esc(nomeCategoria(p.categoriaId))}</td>
                  <td class="dir">${formatarMoeda(p.preco)}</td>
                  <td class="muted">${p.receita.map((r) => {
                    const i = nomeInsumo(r.insumoId);
                    return i ? `${formatarQtd(r.qtd)} ${esc(i.unidade)} ${esc(i.nome)}` : '';
                  }).filter(Boolean).join(', ') || '—'}</td>
                  <td class="dir nowrap">
                    <button type="button" class="btn mini" data-editar="${esc(p.id)}">Editar</button>
                    <button type="button" class="btn mini perigo" data-remover="${esc(p.id)}">Remover</button>
                  </td>
                </tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum produto cadastrado.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </section>`;

  const atualizar = () => { app.salvar(); renderizar(raiz, app); };

  function dialogoCategoria(categoria) {
    abrirDialogo({
      titulo: categoria ? 'Editar categoria' : 'Nova categoria',
      corpo: `<label>Nome <input name="nome" required value="${esc(categoria?.nome || '')}"></label>`,
      aoSalvar: (form) => {
        salvarCategoria(estado, { id: categoria?.id, nome: form.nome.value });
        atualizar();
      },
    });
  }

  function linhaReceita(r = {}) {
    return `
      <div class="linha-receita">
        <select name="insumo">
          <option value="">— insumo —</option>
          ${estado.insumos.map((i) => `<option value="${esc(i.id)}" ${i.id === r.insumoId ? 'selected' : ''}>${esc(i.nome)} (${esc(i.unidade)})</option>`).join('')}
        </select>
        <input name="qtdInsumo" inputmode="decimal" placeholder="qtd" value="${r.qtd != null ? formatarQtd(r.qtd) : ''}">
        <button type="button" class="btn mini perigo" data-remover-linha>×</button>
      </div>`;
  }

  function dialogoProduto(produto) {
    const f = produto?.fiscal || {};
    const padrao = { ...PADRAO_FISCAL, ...(estado.config.fiscal?.padrao || {}) };
    abrirDialogo({
      titulo: produto ? 'Editar produto' : 'Novo produto',
      corpo: `
        <label>Nome <input name="nome" required value="${esc(produto?.nome || '')}"></label>
        <label>Categoria
          <select name="categoria">
            <option value="">Sem categoria</option>
            ${estado.categorias.map((c) => `<option value="${esc(c.id)}" ${c.id === produto?.categoriaId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
          </select>
        </label>
        <label>Preço (R$) <input name="preco" inputmode="decimal" required placeholder="0,00"
          value="${produto ? (produto.preco / 100).toFixed(2).replace('.', ',') : ''}"></label>
        <label class="check"><input type="checkbox" name="ativo" ${produto?.ativo === false ? '' : 'checked'}> Disponível no caixa</label>
        <fieldset>
          <legend>Ficha técnica (opcional)</legend>
          <p class="muted">O que sai do estoque a cada unidade vendida.</p>
          <div class="receita">${(produto?.receita || []).map(linhaReceita).join('')}</div>
          ${estado.insumos.length
            ? '<button type="button" class="btn mini" data-add-linha>+ Insumo</button>'
            : '<p class="muted">Cadastre insumos na aba Estoque para usar a ficha técnica.</p>'}
        </fieldset>
        <fieldset class="dados-fiscais">
          <legend>Dados fiscais (NFC-e)</legend>
          <p class="muted">Informados pelo contador. Campos em branco usam o padrão de Ajustes → Nota fiscal.</p>
          <div class="grade-campos">
            <label>NCM <input name="ncm" inputmode="numeric" maxlength="10" placeholder="8 dígitos" value="${esc(f.ncm || '')}"></label>
            <label>CFOP <input name="cfop" inputmode="numeric" maxlength="4" placeholder="${esc(padrao.cfop)}" value="${esc(f.cfop || '')}"></label>
            <label>CSOSN <input name="csosn" inputmode="numeric" maxlength="3" placeholder="${esc(padrao.csosn)}" value="${esc(f.csosn || '')}"></label>
            <label>CST PIS <input name="cstPis" inputmode="numeric" maxlength="2" placeholder="${esc(padrao.cstPis)}" value="${esc(f.cstPis || '')}"></label>
            <label>CST COFINS <input name="cstCofins" inputmode="numeric" maxlength="2" placeholder="${esc(padrao.cstCofins)}" value="${esc(f.cstCofins || '')}"></label>
            <label>CEST <input name="cest" inputmode="numeric" maxlength="9" placeholder="se houver" value="${esc(f.cest || '')}"></label>
            <label>Unidade <input name="unidade" maxlength="6" placeholder="${esc(padrao.unidade)}" value="${esc(f.unidade || '')}"></label>
          </div>
        </fieldset>`,
      aoMontar: (form) => {
        form.addEventListener('click', (ev) => {
          if (ev.target.matches('[data-add-linha]')) {
            form.querySelector('.receita').insertAdjacentHTML('beforeend', linhaReceita());
          }
          if (ev.target.matches('[data-remover-linha]')) ev.target.closest('.linha-receita').remove();
        });
      },
      aoSalvar: (form) => {
        const preco = lerMoeda(form.preco.value);
        if (preco == null || preco < 0) throw new Error('Informe um preço válido.');
        const receita = [...form.querySelectorAll('.linha-receita')].map((l) => ({
          insumoId: l.querySelector('[name="insumo"]').value,
          qtd: lerNumero(l.querySelector('[name="qtdInsumo"]').value),
        }));
        salvarProduto(estado, {
          id: produto?.id,
          nome: form.nome.value,
          categoriaId: form.categoria.value || null,
          preco,
          ativo: form.ativo.checked,
          receita,
          fiscal: Object.fromEntries(['ncm', 'cfop', 'csosn', 'cstPis', 'cstCofins', 'cest', 'unidade']
            .map((campo) => [campo, form[campo].value])),
        });
        atualizar();
        avisar('Produto salvo.');
      },
    });
  }

  // Eventos no elemento recriado a cada renderização (evita ouvintes duplicados).
  raiz.firstElementChild.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.acao === 'novo-produto') dialogoProduto();
      if (b.dataset.acao === 'nova-categoria') dialogoCategoria();
      if (b.dataset.editar) dialogoProduto(estado.produtos.find((p) => p.id === b.dataset.editar));
      if (b.dataset.editarCat) dialogoCategoria(estado.categorias.find((c) => c.id === b.dataset.editarCat));
      if (b.dataset.remover && confirmar('Remover este produto? As vendas antigas continuam nos relatórios.')) {
        removerProduto(estado, b.dataset.remover);
        atualizar();
      }
      if (b.dataset.removerCat && confirmar('Remover esta categoria?')) {
        removerCategoria(estado, b.dataset.removerCat);
        atualizar();
      }
    } catch (e) {
      avisar(e.message, 'erro');
    }
  });
}
