// Tela de ajustes: nome da loja, armazenamento, backup (exportar/importar) e limpeza dos dados.

import { esc, chaveDia, formatarDataHora } from '../util.js';
import { normalizar, estadoVazio, estadoExemplo } from '../store.js';
import { avisar, confirmar } from '../ui.js';
import { pedirArmazenamentoPermanente, situacaoArmazenamento } from '../persistencia.js';
import * as backupAuto from '../backupAuto.js';

function formatarTamanho(bytes) {
  if (bytes == null) return '?';
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  return `${(bytes / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

export function renderizar(raiz, app) {
  const { estado } = app;
  raiz.innerHTML = `
    <section class="pagina estreita">
      <h1>Ajustes</h1>

      <form class="painel" data-form="loja">
        <h2>Estabelecimento</h2>
        <label>Nome (aparece na comanda) <input name="nomeLoja" required value="${esc(estado.config.nomeLoja)}"></label>
        <button type="submit" class="btn primario">Salvar</button>
      </form>

      <div class="painel" data-painel="armazenamento">
        <h2>Armazenamento</h2>
        <p class="muted">Verificando…</p>
      </div>

      <div class="painel" data-painel="backup-auto"></div>

      <div class="painel">
        <h2>Backup manual</h2>
        <p class="muted">Baixa um arquivo com todos os dados, na hora. Use "Restaurar backup" para voltar
        um backup (manual ou automático) — por exemplo, num computador novo.</p>
        <div class="botoes">
          <button type="button" class="btn primario" data-acao="exportar">Baixar backup</button>
          <label class="btn">Restaurar backup<input type="file" accept="application/json,.json" data-acao="importar" hidden></label>
        </div>
        <p class="muted">${estado.vendas.length} vendas · ${estado.produtos.length} produtos · ${estado.insumos.length} insumos</p>
      </div>

      <div class="painel">
        <h2>Zona de perigo</h2>
        <div class="botoes">
          <button type="button" class="btn perigo" data-acao="exemplo">Recarregar dados de exemplo</button>
          <button type="button" class="btn perigo" data-acao="apagar">Apagar tudo</button>
        </div>
      </div>
    </section>`;

  const pagina = raiz.firstElementChild;

  async function mostrarArmazenamento() {
    const painel = pagina.querySelector('[data-painel="armazenamento"]');
    const info = await situacaoArmazenamento();
    const tipo = app.armazenamento.tipo === 'indexeddb'
      ? 'Banco de dados do navegador (IndexedDB)'
      : 'localStorage (limite de ~5 MB — este navegador não oferece IndexedDB)';
    const protecao = info.permanente === true
      ? '<span class="tag ok">ativa</span>'
      : info.permanente === false
        ? `<span class="tag aviso">não concedida</span>
           <button type="button" class="btn mini" data-acao="permanente">Pedir de novo</button>
           <br><small class="muted">O navegador costuma liberar quando o sistema está instalado como app
           (ícone "Instalar" na barra de endereço).</small>`
        : '<span class="tag">não suportada</span>';
    painel.innerHTML = `
      <h2>Armazenamento</h2>
      <table class="tabela">
        <tr><td>Onde</td><td>${tipo}</td></tr>
        <tr><td>Espaço usado</td><td>${formatarTamanho(info.usado)} de ${formatarTamanho(info.cota)} disponíveis</td></tr>
        <tr><td>Proteção contra limpeza automática</td><td>${protecao}</td></tr>
      </table>
      <p class="muted">A proteção impede que o navegador apague os dados sozinho para liberar espaço.
      Mesmo com ela, "Limpar dados de navegação" apaga tudo — por isso o backup continua importante.</p>`;
  }
  mostrarArmazenamento().catch((e) => console.warn(e));

  function mostrarBackupAuto(s = backupAuto.situacao()) {
    const painel = pagina.querySelector('[data-painel="backup-auto"]');
    const dica = `<p class="muted"><strong>Dica:</strong> crie uma pasta (por exemplo "Backup Recanto") dentro do
      <strong>Google Drive para computador</strong> ou do <strong>OneDrive</strong> e escolha ela aqui.
      Assim cada backup também vai para a nuvem. Se o navegador perguntar, escolha "Permitir sempre".</p>`;
    const ultimo = s.ultimo ? formatarDataHora(s.ultimo) : 'nenhum ainda';
    const conteudo = {
      'nao-suportado': `<p>Este navegador não permite backup automático em pasta.
        Use o <strong>Chrome</strong> ou o <strong>Edge</strong> no computador — ou faça o backup manual abaixo.</p>`,
      inativo: `<p>Grava sozinho uma cópia de todos os dados numa pasta do computador, a cada alteração.
        Fica um arquivo por dia; os 30 mais recentes são mantidos.</p>
        ${dica}
        <button type="button" class="btn primario" data-acao="escolher-pasta">Escolher pasta e ativar</button>`,
      ativo: `<table class="tabela">
          <tr><td>Situação</td><td><span class="tag ok">ativo</span></td></tr>
          <tr><td>Pasta</td><td>${esc(s.pasta)}</td></tr>
          <tr><td>Último backup</td><td>${ultimo}</td></tr>
        </table>
        <div class="botoes">
          <button type="button" class="btn" data-acao="backup-agora">Fazer backup agora</button>
          <button type="button" class="btn" data-acao="escolher-pasta">Trocar pasta</button>
          <button type="button" class="btn perigo" data-acao="desativar-backup">Desativar</button>
        </div>`,
      'sem-permissao': `<table class="tabela">
          <tr><td>Situação</td><td><span class="tag aviso">pausado</span></td></tr>
          <tr><td>Pasta</td><td>${esc(s.pasta)}</td></tr>
          <tr><td>Último backup</td><td>${ultimo}</td></tr>
        </table>
        <p class="muted">O navegador pede sua permissão de novo para gravar na pasta.</p>
        <div class="botoes">
          <button type="button" class="btn primario" data-acao="permitir-pasta">Permitir acesso à pasta</button>
          <button type="button" class="btn" data-acao="escolher-pasta">Trocar pasta</button>
        </div>`,
      erro: `<table class="tabela">
          <tr><td>Situação</td><td><span class="tag perigo">com erro</span></td></tr>
          <tr><td>Pasta</td><td>${esc(s.pasta || '—')}</td></tr>
          <tr><td>Último backup</td><td>${ultimo}</td></tr>
        </table>
        <p class="erro">Erro: ${esc(s.erro)}</p>
        <div class="botoes">
          <button type="button" class="btn primario" data-acao="backup-agora">Tentar de novo</button>
          <button type="button" class="btn" data-acao="escolher-pasta">Escolher outra pasta</button>
        </div>`,
    }[s.situacao];
    painel.innerHTML = `<h2>Backup automático</h2>${conteudo}`;
  }
  mostrarBackupAuto();
  const pararDeOuvir = backupAuto.aoMudar((s) => {
    if (!pagina.isConnected) return pararDeOuvir(); // saiu da tela de Ajustes
    mostrarBackupAuto(s);
  });

  async function acaoBackup(acao) {
    try {
      if (acao === 'escolher-pasta') {
        await backupAuto.escolherPasta();
        avisar('Backup automático ativado.');
      }
      if (acao === 'permitir-pasta') {
        await backupAuto.permitirNovamente();
        avisar('Backup automático reativado.');
      }
      if (acao === 'backup-agora') {
        await backupAuto.fazerAgora();
        avisar('Backup gravado na pasta.');
      }
      if (acao === 'desativar-backup' && confirmar('Desativar o backup automático? Os arquivos já gravados continuam na pasta.')) {
        await backupAuto.desativar();
        avisar('Backup automático desativado.');
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // fechou o seletor de pasta sem escolher
      avisar(`Backup: ${e.message}`, 'erro');
    }
  }

  pagina.querySelector('[data-form="loja"]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    estado.config.nomeLoja = ev.target.nomeLoja.value.trim() || 'Recanto do Café';
    app.salvar();
    avisar('Nome salvo.');
  });

  pagina.addEventListener('click', (ev) => {
    const acao = ev.target.closest('button')?.dataset.acao;
    if (['escolher-pasta', 'permitir-pasta', 'backup-agora', 'desativar-backup'].includes(acao)) acaoBackup(acao);
    if (acao === 'permanente') {
      pedirArmazenamentoPermanente().then((ok) => {
        avisar(ok ? 'Proteção ativada.' : 'O navegador não liberou a proteção agora.', ok ? 'ok' : 'erro');
        mostrarArmazenamento();
      });
    }
    if (acao === 'exportar') {
      const blob = new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `backup-recanto-do-cafe-${chaveDia()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    if (acao === 'exemplo' && confirmar('Substituir TODOS os dados pelos dados de exemplo?')) {
      app.substituir(estadoExemplo());
      avisar('Dados de exemplo carregados.');
    }
    if (acao === 'apagar' && confirmar('Apagar TODOS os dados (cardápio, estoque e vendas)? Faça um backup antes.')) {
      const novo = estadoVazio();
      novo.config = estado.config;
      app.substituir(novo);
      avisar('Dados apagados.');
    }
  });

  pagina.querySelector('[data-acao="importar"]').addEventListener('change', async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    try {
      const dados = normalizar(JSON.parse(await arquivo.text()));
      if (!confirmar(`Restaurar backup com ${dados.vendas.length} vendas e ${dados.produtos.length} produtos? Os dados atuais serão substituídos.`)) return;
      app.substituir(dados);
      avisar('Backup restaurado.');
    } catch (e) {
      avisar(`Não foi possível ler o backup: ${e.message}`, 'erro');
    } finally {
      ev.target.value = '';
    }
  });
}
