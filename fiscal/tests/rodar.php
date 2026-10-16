<?php

/**
 * Testes do serviço fiscal (sem SEFAZ real): php tests/rodar.php
 * Usa um certificado autoassinado gerado na hora e a SEFAZ simulada.
 * O XML de cada nota passa pela validação oficial do layout (XSD) durante a assinatura.
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';
require __DIR__ . '/SefazSimulada.php';

use Recanto\Fiscal\Arquivos;
use Recanto\Fiscal\Banco;
use Recanto\Fiscal\Config;
use Recanto\Fiscal\Emissor;
use Recanto\Fiscal\ErroFiscal;
use Recanto\Fiscal\ErroSefaz;
use Recanto\Fiscal\ErroValidacao;
use Recanto\Fiscal\Pedido;
use Recanto\Fiscal\Testes\SefazSimulada;

const CNPJ = '11222333000181';
$tmp = sys_get_temp_dir() . '/recanto-fiscal-testes-' . getmypid();
@mkdir($tmp, 0700, true);

// ---------- mini framework ----------
$ok = 0;
$falhas = [];
function teste(string $nome, callable $fn): void
{
    global $ok, $falhas;
    try {
        $fn();
        $ok++;
        echo "  ok  $nome\n";
    } catch (Throwable $e) {
        $falhas[] = $nome;
        echo "FALHOU $nome\n      " . get_class($e) . ': ' . $e->getMessage() . "\n";
    }
}
function igual($esperado, $obtido, string $msg = ''): void
{
    if ($esperado !== $obtido) {
        throw new RuntimeException(($msg ? "$msg: " : '') . 'esperado ' . var_export($esperado, true) . ', obtido ' . var_export($obtido, true));
    }
}
function verdade($cond, string $msg): void
{
    if (!$cond) {
        throw new RuntimeException($msg);
    }
}
function lanca(string $classe, callable $fn, ?string $trecho = null): Throwable
{
    try {
        $fn();
    } catch (Throwable $e) {
        if (!$e instanceof $classe) {
            throw new RuntimeException("esperava $classe, veio " . get_class($e) . ': ' . $e->getMessage());
        }
        if ($trecho !== null && !str_contains($e->getMessage(), $trecho)) {
            throw new RuntimeException("mensagem sem \"$trecho\": " . $e->getMessage());
        }
        return $e;
    }
    throw new RuntimeException("esperava exceção $classe");
}

// ---------- certificado autoassinado (como na documentação da sped-nfe) ----------
function gerarCertificado(string $dir): string
{
    $cnf = <<<CNF
    [ req ]
    distinguished_name = dn
    prompt = no
    [ dn ]
    C = BR
    ST = GO
    L = Goiania
    O = RECANTO DO CAFE TESTE
    CN = RECANTO DO CAFE TESTE:11222333000181
    [ v3_req ]
    basicConstraints = CA:FALSE
    keyUsage = nonRepudiation, digitalSignature, keyEncipherment
    2.16.76.1.3.3 = ASN1:UTF8String:11222333000181
    CNF;
    file_put_contents("$dir/openssl.cnf", $cnf);
    $cmds = [
        "openssl genpkey -algorithm RSA -out $dir/chave.key -pkeyopt rsa_keygen_bits:2048",
        "openssl req -new -x509 -days 365 -key $dir/chave.key -out $dir/cert.crt -config $dir/openssl.cnf -extensions v3_req",
        "openssl pkcs12 -export -out $dir/cert.pfx -inkey $dir/chave.key -in $dir/cert.crt -passout pass:teste123 -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg sha256",
    ];
    foreach ($cmds as $cmd) {
        exec($cmd . ' 2>&1', $saida, $codigo);
        if ($codigo !== 0) {
            throw new RuntimeException("Falha ao gerar certificado: $cmd\n" . implode("\n", $saida));
        }
    }
    return "$dir/cert.pfx";
}

function novoAmbiente(string $base, string $nome): array
{
    $dir = "$base/$nome";
    @mkdir($dir, 0700, true);
    $config = new Config([
        'ambiente' => 2,
        'token' => str_repeat('a', 32),
        'origensPermitidas' => ['http://localhost:8080'],
        'emitente' => [
            'cnpj' => CNPJ, 'ie' => '101234567', 'razaoSocial' => 'RECANTO DO CAFE LTDA', 'nomeFantasia' => 'Recanto do Café',
            'crt' => 1, 'email' => 'contato@recanto.com.br',
            'endereco' => ['logradouro' => 'Rua das Flores', 'numero' => '100', 'bairro' => 'Centro',
                'codigoMunicipio' => 5208707, 'municipio' => 'Goiania', 'uf' => 'GO', 'cep' => '74000000', 'telefone' => '62999990000'],
        ],
        'certificado' => ['arquivo' => $GLOBALS['certificado'], 'senha' => 'teste123'],
        'csc' => ['id' => '000001', 'codigo' => 'ABCDEF1234567890ABCDEF1234567890ABCD'],
        'serie' => 1,
        'pastaXml' => "$dir/xml",
        'pastaDados' => "$dir/dados",
    ], $dir);
    $sefaz = new SefazSimulada();
    $banco = new Banco($config->pastaDados);
    $emissor = new Emissor($config, $banco, new Arquivos($config->pastaXml), $sefaz);
    return [$emissor, $sefaz, $banco, $config];
}

function pedido(string $vendaId, array $extra = []): array
{
    return array_replace_recursive([
        'vendaId' => $vendaId,
        'numeroPedido' => 7,
        'itens' => [
            ['codigo' => 'cap', 'descricao' => 'Cappuccino', 'ncm' => '21011110', 'cfop' => '5102', 'csosn' => '102',
                'cstPis' => '49', 'cstCofins' => '49', 'unidade' => 'UN', 'quantidade' => 2, 'valorUnitario' => 1000],
            ['codigo' => 'cox', 'descricao' => 'Coxinha', 'ncm' => '19022000', 'cfop' => '5102', 'csosn' => '102',
                'cstPis' => '49', 'cstCofins' => '49', 'unidade' => 'UN', 'quantidade' => 1, 'valorUnitario' => 700],
        ],
        'desconto' => 0,
        'pagamento' => ['forma' => 'dinheiro', 'valorPago' => 5000, 'troco' => 2300],
    ], $extra);
}

$certificado = gerarCertificado($tmp);
echo "Serviço fiscal — testes\n";

// ---------- validação do pedido ----------
teste('desconto é dividido entre os itens e fecha no total', function () {
    $p = Pedido::validar(pedido('v1', ['desconto' => 101, 'pagamento' => ['valorPago' => 2599, 'troco' => 0, 'forma' => 'pix']]));
    igual(101, array_sum(array_column($p->itens, 'desconto')));
    igual(2599, $p->total());
});
teste('pedido inválido é recusado com mensagem clara', function () {
    lanca(ErroValidacao::class, fn () => Pedido::validar(pedido('v1', ['itens' => [0 => ['ncm' => '123']]])), 'NCM');
    lanca(ErroValidacao::class, fn () => Pedido::validar(pedido('v1', ['pagamento' => ['troco' => 100]])), 'Pagamento');
    lanca(ErroValidacao::class, fn () => Pedido::validar(pedido('v1', ['cpf' => '12345678900'])), 'CPF');
    lanca(ErroValidacao::class, fn () => Pedido::validar(pedido('v1', ['itens' => [0 => ['csosn' => '101']]])), 'CSOSN');
    lanca(ErroValidacao::class, fn () => Pedido::validar(pedido('id com espaço')), 'vendaId');
});
teste('CPF válido é aceito', function () {
    verdade(Pedido::cpfValido('52998224725'), 'CPF válido recusado');
    verdade(!Pedido::cpfValido('11111111111'), 'CPF repetido aceito');
});

// ---------- emissão ----------
[$emissor, $sefaz, $banco, $config] = novoAmbiente($tmp, 'principal');

teste('emite e autoriza NFC-e (XML válido no layout oficial)', function () use ($emissor, $config) {
    $r = $emissor->emitir(pedido('venda1'));
    igual('autorizada', $r['situacao']);
    igual(1, $r['numero']);
    igual(44, strlen($r['chave']));
    igual('52', substr($r['chave'], 0, 2), 'UF na chave');
    igual('65', substr($r['chave'], 20, 2), 'modelo na chave');
    verdade($r['protocolo'] !== null, 'sem protocolo');
    verdade(str_contains((string) $r['qrCode'], 'sefaz.go.gov.br'), 'QR Code sem URL de GO: ' . $r['qrCode']);
    verdade(str_starts_with((string) $r['qrCodeImagem'], 'data:image/svg+xml;base64,'), 'imagem do QR');
    $arquivo = $config->pastaXml . '/' . date('Y/m') . "/{$r['chave']}-nfce.xml";
    verdade(is_file($arquivo), "XML não gravado em $arquivo");
    $xml = file_get_contents($arquivo);
    verdade(str_contains($xml, '<nfeProc'), 'XML sem protocolo (nfeProc)');
    verdade(str_contains($xml, Emissor::TEXTO_HOMOLOGACAO), 'homologação: 1º item deve ter o texto obrigatório');
    verdade(str_contains($xml, '<tPag>01</tPag>') && str_contains($xml, '<vTroco>23.00</vTroco>'), 'pagamento/troco');
    verdade(str_contains($xml, '<vNF>27.00</vNF>'), 'total da nota');
});

teste('mesma venda enviada de novo não gera outra nota', function () use ($emissor, $sefaz) {
    $antes = count($sefaz->chamadas);
    $r = $emissor->emitir(pedido('venda1'));
    igual(1, $r['numero']);
    igual($antes, count($sefaz->chamadas), 'não deveria falar com a SEFAZ');
});

teste('nota recusada não consome o número', function () use ($emissor, $sefaz) {
    $sefaz->modos = ['rejeita'];
    $e = lanca(ErroSefaz::class, fn () => $emissor->emitir(pedido('venda2')), '225');
    igual('225', $e->extra['cStat']);
    $r = $emissor->emitir(pedido('venda2'));
    igual(2, $r['numero'], 'o número 2 deveria ser reaproveitado');
});

teste('Pix e cartão levam tpIntegra; CPF na nota vai no destinatário; desconto por item', function () use ($emissor, $config) {
    $r = $emissor->emitir(pedido('venda3', [
        'cpf' => '529.982.247-25', 'desconto' => 300,
        'pagamento' => ['forma' => 'debito', 'valorPago' => 2400, 'troco' => 0],
    ]));
    $xml = file_get_contents($config->pastaXml . '/' . date('Y/m') . "/{$r['chave']}-nfce.xml");
    verdade(str_contains($xml, '<CPF>52998224725</CPF>'), 'CPF');
    verdade(str_contains($xml, '<tPag>04</tPag>') && str_contains($xml, '<tpIntegra>2</tpIntegra>'), 'débito');
    verdade(str_contains($xml, '<vDesc>3.00</vDesc>') && str_contains($xml, '<vNF>24.00</vNF>'), 'desconto/total');
    igual('52998224725', $r['cpf']);
});

teste('sem internet: emite em contingência offline e guarda a tentativa incerta', function () use ($emissor, $sefaz, $banco, $config) {
    $sefaz->modos = ['sem_rede'];
    $r = $emissor->emitir(pedido('venda4'));
    igual('contingencia', $r['situacao']);
    igual(true, $r['contingencia']);
    igual(5, $r['numero'], 'número 4 ficou com a tentativa incerta, contingência usa o 5');
    igual('9', substr($r['chave'], 34, 1), 'tpEmis 9 na chave');
    verdade($r['protocolo'] === null, 'contingência não tem protocolo ainda');
    verdade(str_contains((string) $r['qrCode'], 'sefaz.go.gov.br'), 'QR Code na contingência');
    igual(1, count($banco->incertasPendentes(2)));
    $xml = file_get_contents($config->pastaXml . '/' . date('Y/m') . "/{$r['chave']}-nfce.xml");
    verdade(str_contains($xml, '<tpEmis>9</tpEmis>') && str_contains($xml, '<xJust>'), 'campos de contingência');
});

teste('não cancela nota de contingência ainda não transmitida', function () use ($emissor, $banco) {
    $nota = $banco->notasEmContingencia(2)[0];
    $e = lanca(ErroFiscal::class, fn () => $emissor->cancelar($nota['chave'], 'Cliente desistiu da compra'), 'ainda não foi transmitida');
    igual(409, $e->http);
});

teste('SEFAZ paralisada: contingência reaproveitando o número', function () use ($emissor, $sefaz) {
    $sefaz->modos = ['paralisada'];
    $r = $emissor->emitir(pedido('venda5'));
    igual('contingencia', $r['situacao']);
    igual(6, $r['numero']);
});

teste('internet volta: transmite as pendentes e inutiliza o número incerto', function () use ($emissor, $sefaz, $banco, $config) {
    $sefaz->modos = ['autoriza', 'autoriza'];
    $r = $emissor->transmitirPendentes();
    igual(2, $r['autorizadas']);
    igual(1, $r['incertasResolvidas']);
    igual(0, $r['aindaPendentes']);
    igual(null, $r['erro']);
    igual([], $banco->notasEmContingencia(2));
    verdade(is_file($config->pastaXml . '/' . date('Y/m') . '/inutilizacao-serie1-num4.xml'), 'XML da inutilização');
    $nota = $emissor->nota($banco->notaPorVenda('venda4', 2)['chave']);
    igual('autorizada', $nota['situacao']);
    verdade($nota['protocolo'] !== null, 'protocolo após transmitir');
});

teste('tentativa incerta que a SEFAZ autorizou é cancelada (evita nota em dobro)', function () use ($emissor, $sefaz, $banco) {
    // simula: a SEFAZ autorizou, mas a resposta não chegou
    $sefaz->modos = ['sem_rede'];
    $emissor->emitir(pedido('venda6'));
    $incerta = $banco->incertasPendentes(2)[0];
    $sefaz->autorizadas[$incerta['chave']] = '152269999999999';
    $sefaz->modos = ['autoriza'];
    $r = $emissor->transmitirPendentes();
    igual(1, $r['incertasResolvidas']);
    verdade(in_array('evento', $sefaz->chamadas, true), 'deveria enviar cancelamento');
});

teste('sem internet ao transmitir: mantém pendentes e informa', function () use ($emissor, $sefaz) {
    $sefaz->modos = ['sem_rede', 'sem_rede'];
    $emissor->emitir(pedido('venda7'));
    $sefaz->modos = ['sem_rede'];
    $r = $emissor->transmitirPendentes();
    verdade($r['erro'] !== null && $r['aindaPendentes'] === 2, 'deveria continuar pendente: ' . json_encode($r));
    $sefaz->modos = [];
    $r = $emissor->transmitirPendentes();
    igual(0, $r['aindaPendentes']);
});

teste('cancela nota autorizada e guarda o XML do cancelamento', function () use ($emissor, $banco, $config) {
    $chave = $banco->notaPorVenda('venda1', 2)['chave'];
    lanca(ErroValidacao::class, fn () => $emissor->cancelar($chave, 'curta'), '15 a 255');
    $r = $emissor->cancelar($chave, 'Cliente desistiu da compra');
    igual('cancelada', $r['situacao']);
    verdade(is_file($config->pastaXml . '/' . date('Y/m') . "/$chave-cancelamento.xml"), 'XML do cancelamento');
    igual('cancelada', $emissor->cancelar($chave, 'Cliente desistiu da compra')['situacao'], 'cancelar de novo');
});

teste('situação: certificado, numeração e SEFAZ', function () use ($emissor) {
    $s = $emissor->situacao(true);
    igual('homologacao', $s['ambiente']);
    igual(true, $s['certificado']['confereComEmitente']);
    igual(true, $s['sefaz']['online']);
    igual(0, $s['pendentes']);
    verdade($s['proximoNumero'] > 6, 'próximo número');
});

teste('zip do mês com todos os XMLs', function () use ($emissor) {
    $zip = $emissor->zipDoMes(date('Y-m'));
    $z = new ZipArchive();
    $z->open($zip);
    verdade($z->numFiles >= 9, "zip com {$z->numFiles} arquivos");
    $z->close();
    unlink($zip);
    lanca(ErroFiscal::class, fn () => $emissor->zipDoMes('2001-01'), 'Nenhum XML');
});

teste('configuração incompleta explica o que falta', function () {
    $e = lanca(Recanto\Fiscal\ErroConfiguracao::class, fn () => new Config(['token' => 'curto'], '/tmp'));
    verdade(str_contains($e->getMessage(), 'emitente.cnpj') && str_contains($e->getMessage(), 'token'), $e->getMessage());
});

echo "\n$ok passaram, " . count($falhas) . " falharam\n";
exec('rm -rf ' . escapeshellarg($tmp));
exit($falhas ? 1 : 0);
