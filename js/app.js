// Ponto de entrada: carrega os dados, controla a navegação entre as telas.

import { insumosEmFalta } from './store.js';
import { abrirArmazenamento, pedirArmazenamentoPermanente } from './persistencia.js';
import { avisar } from './ui.js';
import { esc } from './util.js';
import * as pdv from './views/pdv.js';
import * as cardapio from './views/cardapio.js';
import * as estoque from './views/estoque.js';
import * as relatorios from './views/relatorios.js';
import * as ajustes from './views/ajustes.js';

const telas = { pdv, cardapio, estoque, relatorios, ajustes };

const app = {
  estado: null,
  armazenamento: null,
  /** Grava os dados no navegador (em segundo plano) e atualiza indicadores do topo. */
  salvar() {
    app.armazenamento.gravar(app.estado).catch(falhaAoGravar);
    atualizarTopo();
  },
  /** Substitui todos os dados (importação de backup / reset). */
  substituir(novoEstado) {
    app.estado = novoEstado;
    app.armazenamento.gravar(novoEstado, { substituirTudo: true }).catch(falhaAoGravar);
    atualizarTopo();
    renderizar();
  },
  renderizar: () => renderizar(),
};

function falhaAoGravar(e) {
  console.error(e);
  avisar('ATENÇÃO: não foi possível salvar os dados! Baixe um backup em Ajustes.', 'erro');
}

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
  // Fecha diálogo aberto ao trocar de tela (ex.: botão "voltar" do navegador).
  const dialogo = document.getElementById('dialogo');
  if (dialogo.open) dialogo.close();
  document.querySelectorAll('[data-rota]').forEach((a) => {
    a.classList.toggle('ativa', a.dataset.rota === rota);
  });
  const conteudo = document.getElementById('conteudo');
  conteudo.innerHTML = '';
  tela.renderizar(conteudo, app);
}

async function iniciar() {
  const conteudo = document.getElementById('conteudo');
  conteudo.innerHTML = '<p class="vazio">Carregando…</p>';
  try {
    app.armazenamento = await abrirArmazenamento();
    const { estado, migrado } = await app.armazenamento.carregar();
    app.estado = estado;
    if (migrado) avisar('Dados transferidos para o novo armazenamento.');
  } catch (e) {
    console.error(e);
    conteudo.innerHTML = `
      <div class="alerta">
        <strong>Não foi possível carregar os dados.</strong><br>
        Não registre vendas agora. Feche e abra o sistema de novo; se o erro continuar,
        restaure o último backup.<br><small>${esc(e.message)}</small>
      </div>`;
    return;
  }

  window.addEventListener('hashchange', renderizar);
  atualizarTopo();
  renderizar();

  // Pede ao navegador para não apagar os dados automaticamente.
  pedirArmazenamentoPermanente().catch((e) => console.warn(e));
}

iniciar();

// Permite usar sem internet e "instalar" como app (PWA).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
}
