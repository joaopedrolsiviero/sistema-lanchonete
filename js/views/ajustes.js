// Tela de ajustes: nome da loja, senha do dono, nota fiscal, armazenamento, backup e limpeza dos dados.

import { esc, chaveDia, formatarDataHora } from '../util.js';
import { normalizar, estadoVazio, estadoExemplo } from '../store.js';
import { avisar, confirmar, abrirDialogo } from '../ui.js';
import { pedirArmazenamentoPermanente, situacaoArmazenamento } from '../persistencia.js';
import * as backupAuto from '../backupAuto.js';
import * as acesso from '../acesso.js';
import { mostrarCodigoRecuperacao } from './bloqueio.js';
import { PADRAO_FISCAL, fiscalAtivo } from '../store.js';
import * as fiscal from '../fiscal.js';

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

      <div class="painel" data-painel="senha">
        <h2>Senha do dono</h2>
        ${acesso.temSenha(estado) ? `
          <p><span class="tag ok">ativa</span> Cardápio, Relatórios e Ajustes pedem a senha.
            Caixa e Estoque continuam livres.</p>
          <p class="muted">A área fica liberada até clicar em "🔒 Bloquear" no topo, ficar 5 minutos sem uso
            ou fechar o sistema.</p>
          <div class="botoes">
            <button type="button" class="btn" data-acao="trocar-senha">Trocar senha</button>
            <button type="button" class="btn" data-acao="novo-codigo">Gerar novo código de recuperação</button>
            <button type="button" class="btn perigo" data-acao="remover-senha">Remover senha</button>
          </div>` : `
          <p>Proteja <strong>Cardápio, Relatórios e Ajustes</strong> com uma senha. Assim quem está no caixa
            não vê o faturamento (importante para a contagem às cegas) nem altera preços.</p>
          <button type="button" class="btn primario" data-acao="definir-senha">Criar senha do dono</button>`}
      </div>

      <form class="painel" data-form="fiscal">
        <h2>Nota fiscal (NFC-e)</h2>
        <p class="muted">A NFC-e é emitida pelo <strong>Emissor NFC-e</strong>, um programa instalado neste computador
          (veja o guia de instalação). Aqui você liga o caixa a ele.</p>
        <label class="check"><input type="checkbox" name="ativo" ${estado.config.fiscal?.ativo ? 'checked' : ''}>
          Emitir NFC-e em todas as vendas</label>
        <div class="grade-campos largo">
          <label>Endereço do emissor <input name="url" value="${esc(estado.config.fiscal?.url || fiscal.URL_PADRAO)}"></label>
          <label>Token do emissor <input name="token" type="password" autocomplete="off"
            value="${esc(estado.config.fiscal?.token || '')}" placeholder="o mesmo do config.json do emissor"></label>
        </div>
        <details>
          <summary>Padrões fiscais (usados quando o produto não tem o dado)</summary>
          <div class="grade-campos">
            ${[['cfop', 'CFOP'], ['csosn', 'CSOSN'], ['cstPis', 'CST PIS'], ['cstCofins', 'CST COFINS']].map(([c, nome]) => `
              <label>${nome} <input name="${c}" inputmode="numeric" maxlength="4"
                value="${esc(estado.config.fiscal?.padrao?.[c] || PADRAO_FISCAL[c])}"></label>`).join('')}
          </div>
          <p class="muted">Confirme estes códigos com o contador. O NCM é cadastrado em cada produto (Cardápio).</p>
        </details>
        <div class="botoes">
          <button type="submit" class="btn primario">Salvar</button>
          <button type="button" class="btn" data-acao="testar-fiscal">Testar conexão</button>
        </div>
        <div data-painel="situacao-fiscal"></div>
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

  // ---------- Nota fiscal ----------
  const formFiscal = pagina.querySelector('[data-form="fiscal"]');
  const painelSituacao = pagina.querySelector('[data-painel="situacao-fiscal"]');

  async function mostrarSituacaoFiscal() {
    painelSituacao.innerHTML = '<p class="muted">Consultando o emissor…</p>';
    try {
      const s = await fiscal.situacao(estado, true);
      const c = s.certificado;
      const ambiente = s.ambiente === 'producao'
        ? '<span class="tag ok">PRODUÇÃO</span>'
        : '<span class="tag aviso">HOMOLOGAÇÃO (testes, sem valor fiscal)</span>';
      const cert = c.diasRestantes < 30
        ? `<span class="tag aviso">vence em ${c.diasRestantes} dias</span>` : '<span class="tag ok">válido</span>';
      painelSituacao.innerHTML = `
        <table class="tabela">
          <tr><td>Ambiente</td><td>${ambiente}</td></tr>
          <tr><td>Emitente</td><td>${esc(s.emitente.razaoSocial)} (${esc(s.emitente.cnpj)}) – ${esc(s.uf)}</td></tr>
          <tr><td>Certificado</td><td>${esc(c.titular)} ${cert} até ${esc(c.validoAte.split('-').reverse().join('/'))}
            ${c.confereComEmitente ? '' : '<br><span class="tag perigo">CNPJ do certificado diferente do emitente</span>'}</td></tr>
          <tr><td>SEFAZ</td><td>${s.sefaz?.online ? '<span class="tag ok">em operação</span>'
            : `<span class="tag perigo">fora do ar</span> ${esc(s.sefaz?.motivo || '')}`}</td></tr>
          <tr><td>Série / próximo número</td><td>${s.serie} / ${s.proximoNumero}</td></tr>
          <tr><td>Aguardando envio</td><td>${s.pendentes
            ? `<span class="tag aviso">${s.pendentes}</span> <button type="button" class="btn mini" data-acao="transmitir">Enviar agora</button>`
            : '<span class="tag ok">nenhuma</span>'}</td></tr>
        </table>
        ${s.comProblema.length ? `<div class="alerta"><strong>Notas recusadas após contingência</strong> (procure o contador):
          <ul>${s.comProblema.map((n) => `<li>Nº ${n.numero}: ${esc(n.motivo)}</li>`).join('')}</ul></div>` : ''}
        <div class="botoes">
          <label class="linha-mes">XMLs do mês <input type="month" name="mesXml" value="${new Date().toISOString().slice(0, 7)}"></label>
          <button type="button" class="btn" data-acao="baixar-xml">Baixar .zip para o contador</button>
        </div>`;
    } catch (e) {
      painelSituacao.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    }
  }
  if (fiscalAtivo(estado)) mostrarSituacaoFiscal();

  formFiscal.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const url = f.url.value.trim().replace(/\/+$/, '') || fiscal.URL_PADRAO;
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
      avisar('O endereço do emissor deve ser deste computador (ex.: http://127.0.0.1:8765).', 'erro');
      return;
    }
    if (f.ativo.checked && f.token.value.trim().length < 24) {
      avisar('Informe o token do emissor (mínimo 24 caracteres).', 'erro');
      return;
    }
    const padrao = {};
    for (const [campo, tamanho] of [['cfop', 4], ['csosn', 3], ['cstPis', 2], ['cstCofins', 2]]) {
      const v = f[campo].value.replace(/\D/g, '');
      if (v.length !== tamanho) {
        avisar(`Padrão fiscal inválido: ${campo.toUpperCase()} deve ter ${tamanho} dígitos.`, 'erro');
        return;
      }
      padrao[campo] = v;
    }
    estado.config.fiscal = { ativo: f.ativo.checked, url, token: f.token.value.trim(), padrao };
    app.salvar();
    avisar('Configuração da nota fiscal salva.');
    if (estado.config.fiscal.ativo) mostrarSituacaoFiscal();
  });

  formFiscal.addEventListener('click', async (ev) => {
    const acao = ev.target.closest('button')?.dataset.acao;
    if (acao === 'testar-fiscal') {
      const f = formFiscal;
      const anterior = estado.config.fiscal;
      // testa com o que está digitado, sem salvar
      estado.config.fiscal = { ...(anterior || {}), url: f.url.value.trim() || fiscal.URL_PADRAO, token: f.token.value.trim() };
      await mostrarSituacaoFiscal();
      estado.config.fiscal = anterior;
    }
    if (acao === 'transmitir') {
      try {
        const r = await fiscal.sincronizarPendentes(app);
        avisar(r?.erro ? r.erro : `${r?.autorizadas || 0} nota(s) enviada(s) e autorizada(s).`, r?.erro ? 'erro' : 'ok');
      } catch (e) {
        avisar(e.message, 'erro');
      }
      mostrarSituacaoFiscal();
    }
    if (acao === 'baixar-xml') {
      const mes = formFiscal.querySelector('[name="mesXml"]').value;
      try {
        const blob = await fiscal.baixarXmlsDoMes(estado, mes);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `nfce-${mes}.zip`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        avisar(e.message, 'erro');
      }
    }
  });

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

  function dialogoSenha({ titulo, textoSalvar, primeiraVez }) {
    abrirDialogo({
      titulo,
      corpo: `
        <label>Nova senha (mínimo ${acesso.TAMANHO_MINIMO} caracteres)
          <input type="password" name="nova" required autocomplete="new-password"></label>
        <label>Repita a senha <input type="password" name="repete" required autocomplete="new-password"></label>
        <p class="muted">Use uma senha difícil de adivinhar, misturando letras e números
          (evite datas, telefone ou "12345678").</p>
        ${primeiraVez ? '<p class="muted">Em seguida aparece um código de recuperação para anotar.</p>' : ''}`,
      textoSalvar,
      aoSalvar: async (f) => {
        if (f.nova.value !== f.repete.value) throw new Error('As senhas não são iguais.');
        const codigo = await acesso.definirSenha(estado, f.nova.value, { novoCodigo: primeiraVez });
        acesso.desbloquear();
        app.salvar();
        avisar(primeiraVez ? 'Senha do dono criada.' : 'Senha trocada.');
        renderizar(raiz, app);
        if (codigo) setTimeout(() => mostrarCodigoRecuperacao(codigo), 0);
      },
    });
  }

  async function acaoSenha(acao) {
    if (acao === 'definir-senha') dialogoSenha({ titulo: 'Criar senha do dono', textoSalvar: 'Criar senha', primeiraVez: true });
    if (acao === 'trocar-senha') dialogoSenha({ titulo: 'Trocar senha', textoSalvar: 'Trocar senha', primeiraVez: false });
    if (acao === 'novo-codigo' && confirmar('Gerar um novo código de recuperação? O código atual deixará de valer.')) {
      abrirDialogo({
        titulo: 'Novo código de recuperação',
        corpo: `<label>Confirme a senha atual <input type="password" name="atual" required></label>`,
        textoSalvar: 'Gerar código',
        aoSalvar: async (f) => {
          if (!(await acesso.conferirSenha(estado, f.atual.value))) throw new Error('Senha incorreta.');
          const codigo = await acesso.definirSenha(estado, f.atual.value, { novoCodigo: true });
          app.salvar();
          setTimeout(() => mostrarCodigoRecuperacao(codigo, { substituiu: true }), 0);
        },
      });
    }
    if (acao === 'remover-senha' && confirmar('Remover a senha do dono? Todas as abas ficarão livres para qualquer pessoa.')) {
      acesso.removerSenha(estado);
      app.salvar();
      avisar('Senha removida.');
      renderizar(raiz, app);
    }
  }

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
    if (['definir-senha', 'trocar-senha', 'novo-codigo', 'remover-senha'].includes(acao)) acaoSenha(acao);
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
