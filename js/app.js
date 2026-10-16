// Ponto de entrada: carrega os dados, controla a navegação entre as telas.

import { carregar, salvar, insumosEmFalta } from './store.js';
import { avisar } from './ui.js';
import * as pdv from './views/pdv.js';
import * as cardapio from './views/cardapio.js';
import * as estoque from './views/estoque.js';
import * as relatorios from './views/relatorios.js';
import * as ajustes from './views/ajustes.js';

const telas = { pdv, cardapio, estoque, relatorios, ajustes };

const app = {
  estado: carregar(),
  /** Grava os dados no navegador e atualiza indicadores do topo. */
  salvar() {
    try {
      salvar(app.estado);
    } catch (e) {
      avisar('Não foi possível salvar os dados neste navegador!', 'erro');
      console.error(e);
    }
    atualizarTopo();
  },
  /** Substitui todos os dados (importação de backup / reset). */
  substituir(novoEstado) {
    app.estado = novoEstado;
    app.salvar();
    renderizar();
  },
  renderizar: () => renderizar(),
};

function atualizarTopo() {
  document.getElementById('nome-loja').textContent = app.estado.config.nomeLoja;
  document.title = `${app.estado.config.nomeLoja} — Caixa`;
  const falta = insumosEmFalta(app.estado).length;
  const badge = document.getElementById('badge-estoque');
  badge.hidden = falta === 0;
  badge.textContent = falta;
}

function renderizar() {
  const rota = location.hash.slice(1) || 'pdv';
  const tela = telas[rota] || pdv;
  document.querySelectorAll('[data-rota]').forEach((a) => {
    a.classList.toggle('ativa', a.dataset.rota === rota);
  });
  const conteudo = document.getElementById('conteudo');
  conteudo.innerHTML = '';
  tela.renderizar(conteudo, app);
}

window.addEventListener('hashchange', renderizar);

// Salva já na primeira abertura, para os dados de exemplo ficarem gravados.
app.salvar();
renderizar();

// Permite usar sem internet e "instalar" como app (PWA).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
}
