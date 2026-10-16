// Tela de ajustes: nome da loja, backup (exportar/importar) e limpeza dos dados.

import { esc, chaveDia } from '../util.js';
import { normalizar, estadoVazio, estadoExemplo } from '../store.js';
import { avisar, confirmar } from '../ui.js';

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

      <div class="painel">
        <h2>Backup</h2>
        <p class="muted">Os dados ficam salvos <strong>somente neste navegador</strong>. Faça backup com frequência
        (por exemplo, no fim do dia) e guarde o arquivo no Google Drive ou num pen drive.
        Limpar os dados do navegador apaga tudo.</p>
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

  pagina.querySelector('[data-form="loja"]').addEventListener('submit', (ev) => {
    ev.preventDefault();
    estado.config.nomeLoja = ev.target.nomeLoja.value.trim() || 'Recanto do Café';
    app.salvar();
    avisar('Nome salvo.');
  });

  pagina.addEventListener('click', (ev) => {
    const acao = ev.target.closest('button')?.dataset.acao;
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
