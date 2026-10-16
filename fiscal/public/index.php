<?php

/**
 * API HTTP do serviço fiscal. Roda só no próprio computador do caixa:
 *   php -S 127.0.0.1:8765 public/index.php
 * (modo "router": todas as requisições passam por este arquivo)
 *
 * Rotas (todas exigem o cabeçalho X-Token com o token da configuração):
 *   GET  /situacao[?sefaz=1]        configuração, certificado, pendências (e status da SEFAZ)
 *   POST /nfce                      emite a NFC-e de uma venda
 *   GET  /nfce/{chave}              dados de uma nota (para reimprimir)
 *   POST /nfce/{chave}/cancelar     {"justificativa": "..."}
 *   POST /pendentes/transmitir      envia notas de contingência e resolve tentativas incertas
 *   GET  /xml/{AAAA-MM}             XMLs do mês (.zip) para o contador
 */

declare(strict_types=1);

$base = dirname(__DIR__);
require $base . '/vendor/autoload.php';

use Recanto\Fiscal\Arquivos;
use Recanto\Fiscal\Banco;
use Recanto\Fiscal\Config;
use Recanto\Fiscal\Emissor;
use Recanto\Fiscal\ErroFiscal;

date_default_timezone_set('America/Sao_Paulo');
set_time_limit(120);

function responder(int $status, mixed $corpo): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($corpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function registrarErro(Throwable $e): void
{
    $linha = sprintf("[%s] %s: %s em %s:%d\n", date('c'), get_class($e), $e->getMessage(), $e->getFile(), $e->getLine());
    @file_put_contents(dirname(__DIR__) . '/dados/erros.log', $linha, FILE_APPEND);
}

$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$caminho = rtrim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/') ?: '/';
$origem = $_SERVER['HTTP_ORIGIN'] ?? null;

try {
    $config = Config::carregar($base);
} catch (ErroFiscal $e) {
    // Sem configuração ainda: só responde para o próprio computador, explicando o que falta.
    if ($origem !== null) {
        header('Access-Control-Allow-Origin: ' . $origem);
    }
    responder($e->http, ['erro' => $e->getMessage(), 'configurado' => false]);
}

// ---------- CORS: só o sistema de caixa (origens configuradas) pode chamar pelo navegador ----------
if ($origem !== null) {
    if (!in_array($origem, $config->origensPermitidas, true)) {
        responder(403, ['erro' => 'Origem não autorizada.']);
    }
    header('Access-Control-Allow-Origin: ' . $origem);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type, X-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Expose-Headers: Content-Disposition');
    // Chrome: site da internet acessando o próprio computador (Private/Local Network Access)
    header('Access-Control-Allow-Private-Network: true');
    if ($metodo === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

if (!hash_equals($config->token, (string) ($_SERVER['HTTP_X_TOKEN'] ?? ''))) {
    usleep(500000); // atrasa tentativas de adivinhar o token
    responder(401, ['erro' => 'Token inválido. Confira o token do serviço fiscal em Ajustes.']);
}

try {
    $soap = null;
    // Só para testes automáticos: SEFAZ simulada, nunca em produção.
    if (getenv('RECANTO_FISCAL_SIMULAR') === '1' && $config->ambiente === 2) {
        require_once $base . '/tests/SefazSimulada.php';
        $soap = new Recanto\Fiscal\Testes\SefazSimulada();
        $soap->modos = array_filter(explode(',', (string) getenv('RECANTO_FISCAL_MODOS')));
    }
    $emissor = new Emissor($config, new Banco($config->pastaDados), new Arquivos($config->pastaXml), $soap);
    $corpo = json_decode((string) file_get_contents('php://input'), true);

    if ($metodo === 'GET' && $caminho === '/situacao') {
        responder(200, $emissor->situacao(($_GET['sefaz'] ?? '') === '1'));
    }
    if ($metodo === 'POST' && $caminho === '/nfce') {
        responder(201, $emissor->emitir($corpo));
    }
    if ($metodo === 'GET' && preg_match('#^/nfce/(\d{44})$#', $caminho, $m)) {
        responder(200, $emissor->nota($m[1]));
    }
    if ($metodo === 'POST' && preg_match('#^/nfce/(\d{44})/cancelar$#', $caminho, $m)) {
        responder(200, $emissor->cancelar($m[1], (string) ($corpo['justificativa'] ?? '')));
    }
    if ($metodo === 'POST' && $caminho === '/pendentes/transmitir') {
        responder(200, $emissor->transmitirPendentes());
    }
    if ($metodo === 'GET' && preg_match('#^/xml/(\d{4}-\d{2})$#', $caminho, $m)) {
        $zip = $emissor->zipDoMes($m[1]);
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="nfce-' . $m[1] . '.zip"');
        header('Content-Length: ' . filesize($zip));
        readfile($zip);
        unlink($zip);
        exit;
    }
    responder(404, ['erro' => 'Rota não encontrada.']);
} catch (ErroFiscal $e) {
    if ($e->http >= 500) {
        registrarErro($e);
    }
    responder($e->http, ['erro' => $e->getMessage()] + $e->extra);
} catch (Throwable $e) {
    registrarErro($e);
    responder(500, ['erro' => 'Erro interno do serviço fiscal: ' . $e->getMessage()]);
}
