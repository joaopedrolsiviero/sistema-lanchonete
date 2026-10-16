// Comunicação com o serviço fiscal local (emissor de NFC-e que roda no computador do caixa).

import { dadosFiscaisProduto, fiscalAtivo } from './store.js';

export const URL_PADRAO = 'http://127.0.0.1:8765';
const TEMPO_EMISSAO_MS = 60000; // inclui espera da SEFAZ e, se preciso, a entrada em contingência
const TEMPO_PADRAO_MS = 20000;

/** tipo: 'rede' (serviço não respondeu) ou 'servico' (respondeu com erro). */
export class ErroFiscal extends Error {
  constructor(mensagem, tipo, status = 0, dados = {}) {
    super(mensagem);
    this.tipo = tipo;
    this.status = status;
    this.dados = dados;
  }
}

async function chamar(estado, metodo, caminho, corpo, { tempo = TEMPO_PADRAO_MS, binario = false } = {}) {
  const { url, token } = estado.config.fiscal || {};
  if (!url || !token) throw new ErroFiscal('Serviço fiscal não configurado (Ajustes → Nota fiscal).', 'servico');
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempo);
  let resposta;
  try {
    resposta = await fetch(url.replace(/\/+$/, '') + caminho, {
      method: metodo,
      headers: { 'X-Token': token, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controle.signal,
      // Chrome: permissão para o site acessar um serviço no próprio computador
      targetAddressSpace: 'loopback',
    });
  } catch (e) {
    const motivo = e.name === 'AbortError' ? 'demorou demais para responder' : 'não respondeu';
    throw new ErroFiscal(`O serviço fiscal ${motivo}. Confira se o "Emissor NFC-e" está aberto neste computador.`, 'rede');
  } finally {
    clearTimeout(timer);
  }
  if (binario && resposta.ok) return resposta.blob();
  let dados = {};
  try {
    dados = await resposta.json();
  } catch {
    // resposta sem JSON
  }
  if (!resposta.ok) {
    throw new ErroFiscal(dados.erro || `Erro ${resposta.status} no serviço fiscal.`, 'servico', resposta.status, dados);
  }
  return dados;
}

/** Monta o pedido no formato do serviço fiscal a partir do pedido do caixa. */
export function montarPedidoFiscal(estado, { vendaId, numeroPedido, itens, desconto, pagamento, recebido, troco, cpf }) {
  return {
    vendaId,
    numeroPedido,
    itens: itens.map((i) => {
      const produto = estado.produtos.find((p) => p.id === i.produtoId);
      const f = dadosFiscaisProduto(estado, produto);
      return {
        codigo: i.produtoId,
        descricao: i.nome,
        ncm: f.ncm, cfop: f.cfop, csosn: f.csosn, cstPis: f.cstPis, cstCofins: f.cstCofins,
        cest: f.cest, unidade: f.unidade,
        quantidade: i.qtd,
        valorUnitario: i.preco,
      };
    }),
    desconto,
    pagamento: { forma: pagamento, valorPago: recebido, troco },
    ...(cpf ? { cpf } : {}),
  };
}

/** Resumo da nota que fica guardado junto da venda. */
export function resumoNota(nota) {
  return {
    situacao: nota.situacao,
    chave: nota.chave,
    numero: nota.numero,
    serie: nota.serie,
    ...(nota.protocolo ? { protocolo: nota.protocolo } : {}),
  };
}

export const emitir = (estado, pedido) => chamar(estado, 'POST', '/nfce', pedido, { tempo: TEMPO_EMISSAO_MS });
export const consultarNota = (estado, chave) => chamar(estado, 'GET', `/nfce/${chave}`);
export const cancelarNota = (estado, chave, justificativa) =>
  chamar(estado, 'POST', `/nfce/${chave}/cancelar`, { justificativa }, { tempo: TEMPO_EMISSAO_MS });
export const situacao = (estado, sefaz = false) => chamar(estado, 'GET', `/situacao${sefaz ? '?sefaz=1' : ''}`);
export const transmitirPendentes = (estado) =>
  chamar(estado, 'POST', '/pendentes/transmitir', null, { tempo: TEMPO_EMISSAO_MS });
export const baixarXmlsDoMes = (estado, mes) => chamar(estado, 'GET', `/xml/${mes}`, null, { binario: true });

/**
 * Envia as notas de contingência pendentes e atualiza a situação das vendas que estavam em contingência.
 * Devolve o resultado da transmissão (ou null se não houver nada a fazer).
 */
export async function sincronizarPendentes(app) {
  const { estado } = app;
  if (!fiscalAtivo(estado)) return null;
  const s = await situacao(estado);
  const emContingencia = estado.vendas.filter((v) => v.nfce?.situacao === 'contingencia');
  let resultado = null;
  if (s.pendentes > 0) resultado = await transmitirPendentes(estado);
  let mudou = false;
  for (const venda of emContingencia) {
    try {
      const nota = await consultarNota(estado, venda.nfce.chave);
      if (nota.situacao !== venda.nfce.situacao) {
        venda.nfce = resumoNota(nota);
        mudou = true;
      }
    } catch {
      // tenta de novo na próxima sincronização
    }
  }
  if (mudou) app.salvar();
  return { ...(resultado || {}), situacao: s };
}
