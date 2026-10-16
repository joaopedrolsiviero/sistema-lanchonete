// Ponto de entrada: carrega os dados, controla a navegação entre as telas.

import { insumosEmFalta } from './store.js';
import { abrirArmazenamento, pedirArmazenamentoPermanente } from './persistencia.js';
import * as backupAuto from './backupAuto.js';
import * as acesso from './acesso.js';
import * as fiscal from './fiscal.js';
import { fiscalAtivo } from './store.js';
import * as bloqueio from './views/bloqueio.js';
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
    backupAuto.agendar();
    atualizarTopo();
  },
  /** Substitui todos os dados (importação de backup / reset). */
  substituir(novoEstado) {
    app.estado = novoEstado;
    app.armazenamento.gravar(novoEstado, { substituirTudo: true }).catch(falhaAoGravar);
    backupAuto.agendar();
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
  // Área do dono: cadeados nas abas protegidas e botão "Bloquear" quando liberada.
  const comSenha = acesso.temSenha(app.estado);
  document.body.classList.toggle('area-bloqueada', !acesso.liberado(app.estado));
  document.getElementById('btn-bloquear').hidden = !(comSenha && acesso.liberado(app.estado));
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
  atualizarTopo();
  if (acesso.rotaProtegida(rota) && !acesso.liberado(app.estado)) {
    bloqueio.renderizar(conteudo, app, renderizar);
    return;
  }
  tela.renderizar(conteudo, app);
}

/** Faixa de aviso abaixo do topo quando o backup automático não está funcionando. */
function atualizarFaixaBackup(s) {
  const faixa = document.getElementById('faixa-backup');
  let html = '';
  if (s.situacao === 'sem-permissao') {
    html = `Backup automático pausado: o navegador pede sua permissão para gravar na pasta.
      <button type="button" class="btn mini" data-acao="permitir-backup">Permitir</button>`;
  } else if (s.situacao === 'erro') {
    html = `Backup automático falhou: ${esc(s.erro)}. <a href="#ajustes">Ver em Ajustes</a>`;
  } else if (s.situacao === 'inativo') {
    html = 'Backup automático desativado. <a href="#ajustes">Ativar em Ajustes</a>';
  }
  faixa.innerHTML = html;
  faixa.hidden = !html;
}

document.getElementById('faixa-backup').addEventListener('click', (ev) => {
  if (ev.target.dataset.acao !== 'permitir-backup') return;
  backupAuto.permitirNovamente()
    .then(() => avisar('Backup automático reativado.'))
    .catch((e) => avisar(e.message, 'erro'));
});

/** Envia notas de contingência pendentes e mostra avisos fiscais no topo (a cada 5 minutos). */
async function verificarFiscal() {
  const faixa = document.getElementById('faixa-fiscal');
  if (!fiscalAtivo(app.estado)) {
    faixa.hidden = true;
    return;
  }
  let html = '';
  try {
    const r = await fiscal.sincronizarPendentes(app);
    const s = r.situacao;
    const restantes = r.aindaPendentes ?? s.pendentes;
    if (s.comProblema.length) {
      html = `<strong>Atenção:</strong> ${s.comProblema.length} NFC-e emitida(s) em contingência foram recusadas pela SEFAZ.
        <a href="#ajustes">Ver em Ajustes</a>`;
    } else if (restantes > 0) {
      html = `${restantes} NFC-e emitida(s) sem internet aguardando envio à SEFAZ (prazo: 24 horas).
        ${r.erro ? 'O envio será tentado de novo automaticamente.' : ''}`;
    } else if (s.certificado.diasRestantes < 30) {
      html = `O certificado digital vence em ${s.certificado.diasRestantes} dias. Providencie a renovação.`;
    }
    if (r.autorizadas) avisar(`${r.autorizadas} NFC-e de contingência enviada(s) e autorizada(s).`);
  } catch (e) {
    html = `Emissor NFC-e não está respondendo: ${esc(e.message)}`;
  }
  faixa.innerHTML = html;
  faixa.hidden = !html;
}

document.getElementById('btn-bloquear').addEventListener('click', () => {
  acesso.bloquear();
  avisar('Área do dono bloqueada.');
});

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

  // Ao bloquear (botão ou 5 min sem uso), sai da área do dono se estiver nela.
  acesso.configurar(() => {
    atualizarTopo();
    if (acesso.rotaProtegida(location.hash.slice(1))) renderizar();
  });
  window.addEventListener('hashchange', renderizar);
  // Avisa se a página for fechada antes de o navegador confirmar a última gravação.
  window.addEventListener('beforeunload', (ev) => {
    if (app.armazenamento.gravacoesPendentes?.() > 0) ev.preventDefault();
  });
  atualizarTopo();
  renderizar();

  backupAuto.aoMudar(atualizarFaixaBackup);
  backupAuto.iniciar(() => app.estado).catch((e) => console.warn('Backup automático:', e));

  verificarFiscal();
  setInterval(verificarFiscal, 5 * 60 * 1000);

  // Pede ao navegador para não apagar os dados automaticamente.
  pedirArmazenamentoPermanente().catch((e) => console.warn(e));
}

iniciar();

// Permite usar sem internet e "instalar" como app (PWA).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
}
