<?php

declare(strict_types=1);

namespace Recanto\Fiscal;

use chillerlan\QRCode\QRCode;
use DateTimeImmutable;
use DateTimeZone;
use NFePHP\Common\Certificate;
use NFePHP\Common\Soap\SoapCurl;
use NFePHP\Common\Soap\SoapInterface;
use NFePHP\NFe\Common\Standardize;
use NFePHP\NFe\Complements;
use NFePHP\NFe\Make;
use NFePHP\NFe\Tools;
use stdClass;

/**
 * Emissão de NFC-e (modelo 65) com a biblioteca nfephp-org/sped-nfe.
 *
 * Fluxo de uma venda:
 *  1. reserva o próximo número, monta o XML, assina (a assinatura também valida o XML contra o layout oficial);
 *  2. envia à SEFAZ (modo síncrono);
 *  3. autorizada → grava o XML com o protocolo;
 *     recusada → devolve o número e informa o motivo (nada foi registrado na SEFAZ);
 *     sem resposta (internet/SEFAZ fora) → emite em CONTINGÊNCIA OFFLINE (tpEmis 9) com novo número
 *     e guarda a tentativa como "incerta" para conferir depois.
 *  4. transmitirPendentes() envia as notas em contingência (prazo legal: 24 h) e resolve as incertas
 *     (cancela se a SEFAZ tiver recebido, inutiliza o número se não tiver).
 */
final class Emissor
{
    public const SCHEMA = 'PL_010_V1.30';
    public const VERSAO_APP = 'Recanto 1.0';
    public const TEXTO_HOMOLOGACAO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
    private const AUTORIZADA = ['100', '150'];
    private const DENEGADA = ['110', '301', '302', '303'];
    private const SEFAZ_PARALISADA = ['108', '109'];
    private const DUPLICIDADE = ['204', '539'];

    private ?Tools $tools = null;
    private ?Certificate $certificado = null;
    private DateTimeZone $fuso;

    public function __construct(
        private Config $config,
        private Banco $banco,
        private Arquivos $arquivos,
        private ?SoapInterface $soap = null, // permite simular a SEFAZ nos testes
    ) {
        $this->fuso = new DateTimeZone('America/Sao_Paulo'); // Goiás: UTC-3
    }

    // ------------------------------------------------------------------ emissão

    public function emitir(mixed $dados): array
    {
        $pedido = Pedido::validar($dados);
        $ambiente = $this->config->ambiente;

        // Mesma venda enviada de novo (ex.: o caixa repetiu o pedido após um erro de rede): devolve a nota já emitida.
        $existente = $this->banco->notaPorVenda($pedido->vendaId, $ambiente);
        if ($existente) {
            return $this->resposta($existente, 'Nota já emitida para esta venda.');
        }

        $tools = $this->tools();
        $serie = $this->config->serie;
        $numero = $this->banco->reservarNumero($ambiente, $serie);
        $dhEmi = new DateTimeImmutable('now', $this->fuso);

        try {
            $xml = $tools->signNFe($this->montar($pedido, $numero, $dhEmi, 1));
        } catch (ErroValidacao $e) {
            $this->banco->devolverNumero($ambiente, $serie, $numero);
            throw $e;
        } catch (\Throwable $e) {
            $this->banco->devolverNumero($ambiente, $serie, $numero);
            throw new ErroValidacao('Dados da nota inválidos: ' . $e->getMessage());
        }
        $chave = self::chaveDoXml($xml);

        try {
            $resposta = $this->enviar($tools, $xml);
        } catch (\Throwable $e) {
            // Sem resposta: não dá para saber se a SEFAZ recebeu. Guarda para conferir depois e segue em contingência.
            $this->banco->inserirIncerta($chave, $ambiente, $serie, $numero, $pedido->vendaId);
            return $this->emitirEmContingencia($pedido, 'Falha de comunicacao com a SEFAZ');
        }

        $r = $this->interpretar($resposta);
        if ($r['tipo'] === 'autorizada') {
            return $this->registrarAutorizada($pedido, $xml, $resposta, $chave, $numero, $dhEmi, $r);
        }
        if ($r['tipo'] === 'indisponivel') {
            // A SEFAZ avisou que está fora: a nota não foi registrada, o número pode ser reaproveitado.
            $this->banco->devolverNumero($ambiente, $serie, $numero);
            return $this->emitirEmContingencia($pedido, 'SEFAZ com servico paralisado');
        }
        if ($r['tipo'] === 'denegada') {
            $arquivo = $this->arquivos->salvar(
                $this->arquivos->caminho($dhEmi, "$chave-denegada.xml"),
                Complements::toAuthorize($xml, $resposta),
            );
            $this->banco->inserirNota([
                'chave' => $chave, 'venda_id' => $pedido->vendaId, 'ambiente' => $ambiente, 'serie' => $serie,
                'numero' => $numero, 'tp_emis' => 1, 'situacao' => 'denegada', 'protocolo' => $r['nProt'],
                'dh_emi' => $dhEmi->format(DATE_ATOM), 'valor' => $pedido->total(), 'arquivo' => $arquivo,
                'mensagem' => "{$r['cStat']} - {$r['xMotivo']}",
            ]);
            throw new ErroSefaz($r['cStat'], $r['xMotivo']);
        }
        if (!in_array($r['cStat'], self::DUPLICIDADE, true)) {
            // Recusada: nada ficou registrado na SEFAZ, o número volta a ficar livre.
            $this->banco->devolverNumero($ambiente, $serie, $numero);
        }
        throw new ErroSefaz($r['cStat'], $r['xMotivo']);
    }

    private function emitirEmContingencia(Pedido $pedido, string $motivo): array
    {
        $ambiente = $this->config->ambiente;
        $serie = $this->config->serie;
        $numero = $this->banco->reservarNumero($ambiente, $serie);
        $dhEmi = new DateTimeImmutable('now', $this->fuso);
        try {
            $xml = $this->tools()->signNFe($this->montar($pedido, $numero, $dhEmi, 9, $motivo));
        } catch (\Throwable $e) {
            $this->banco->devolverNumero($ambiente, $serie, $numero);
            throw new ErroValidacao('Dados da nota inválidos: ' . $e->getMessage());
        }
        $chave = self::chaveDoXml($xml);
        $arquivo = $this->arquivos->salvar($this->arquivos->caminho($dhEmi, "$chave-nfce.xml"), $xml);
        $this->banco->inserirNota([
            'chave' => $chave, 'venda_id' => $pedido->vendaId, 'ambiente' => $ambiente, 'serie' => $serie,
            'numero' => $numero, 'tp_emis' => 9, 'situacao' => 'contingencia',
            'dh_emi' => $dhEmi->format(DATE_ATOM), 'valor' => $pedido->total(), 'arquivo' => $arquivo,
            'qr_code' => self::tagDoXml($xml, 'qrCode'), 'mensagem' => $motivo,
        ]);
        return $this->resposta($this->banco->notaPorChave($chave));
    }

    private function registrarAutorizada(
        Pedido $pedido, string $xml, string $resposta, string $chave, int $numero, DateTimeImmutable $dhEmi, array $r,
    ): array {
        $procNFe = Complements::toAuthorize($xml, $resposta);
        $arquivo = $this->arquivos->salvar($this->arquivos->caminho($dhEmi, "$chave-nfce.xml"), $procNFe);
        $this->banco->inserirNota([
            'chave' => $chave, 'venda_id' => $pedido->vendaId, 'ambiente' => $this->config->ambiente,
            'serie' => $this->config->serie, 'numero' => $numero, 'tp_emis' => 1, 'situacao' => 'autorizada',
            'protocolo' => $r['nProt'], 'dh_emi' => $dhEmi->format(DATE_ATOM), 'dh_recbto' => $r['dhRecbto'],
            'valor' => $pedido->total(), 'arquivo' => $arquivo, 'qr_code' => self::tagDoXml($xml, 'qrCode'),
        ]);
        return $this->resposta($this->banco->notaPorChave($chave));
    }

    // ------------------------------------------------------------------ pendências

    /**
     * Transmite as notas emitidas em contingência e resolve as tentativas incertas.
     * Pode ser chamado a qualquer momento (o caixa chama de tempos em tempos); para no primeiro sinal de que
     * a SEFAZ continua inacessível.
     */
    public function transmitirPendentes(): array
    {
        $resultado = ['autorizadas' => 0, 'rejeitadas' => [], 'incertasResolvidas' => 0, 'aindaPendentes' => 0, 'erro' => null];
        $tools = $this->tools();
        $ambiente = $this->config->ambiente;

        foreach ($this->banco->notasEmContingencia($ambiente) as $nota) {
            $xml = $this->arquivos->ler($nota['arquivo']);
            try {
                $resposta = $this->enviar($tools, $xml);
            } catch (\Throwable $e) {
                $resultado['erro'] = 'SEFAZ ainda inacessível: ' . $e->getMessage();
                break;
            }
            $r = $this->interpretar($resposta);
            if ($r['tipo'] === 'indisponivel') {
                $resultado['erro'] = "SEFAZ ainda indisponível ({$r['cStat']} - {$r['xMotivo']})";
                break;
            }
            if (in_array($r['cStat'], self::DUPLICIDADE, true)) {
                // Já tinha chegado numa tentativa anterior: busca o protocolo pela consulta.
                try {
                    $resposta = $tools->sefazConsultaChave($nota['chave']);
                    $r = $this->interpretar($resposta);
                } catch (\Throwable $e) {
                    $resultado['erro'] = 'Falha ao consultar nota: ' . $e->getMessage();
                    break;
                }
            }
            if ($r['tipo'] === 'autorizada') {
                $this->arquivos->salvar($nota['arquivo'], Complements::toAuthorize($xml, $resposta));
                $this->banco->atualizarNota($nota['chave'], [
                    'situacao' => 'autorizada', 'protocolo' => $r['nProt'], 'dh_recbto' => $r['dhRecbto'], 'mensagem' => null,
                ]);
                $resultado['autorizadas']++;
            } else {
                $mensagem = "{$r['cStat']} - {$r['xMotivo']}";
                $this->banco->atualizarNota($nota['chave'], ['situacao' => 'rejeitada_contingencia', 'mensagem' => $mensagem]);
                $resultado['rejeitadas'][] = ['chave' => $nota['chave'], 'numero' => (int) $nota['numero'], 'motivo' => $mensagem];
            }
        }

        if ($resultado['erro'] === null) {
            foreach ($this->banco->incertasPendentes($ambiente) as $incerta) {
                try {
                    $this->resolverIncerta($tools, $incerta);
                    $resultado['incertasResolvidas']++;
                } catch (\Throwable $e) {
                    $this->banco->resolverIncerta($incerta['chave'], 'erro', $e->getMessage());
                    $resultado['erro'] = 'Falha ao conferir nota incerta: ' . $e->getMessage();
                    break;
                }
            }
        }

        $resultado['aindaPendentes'] = count($this->banco->notasEmContingencia($ambiente))
            + count($this->banco->incertasPendentes($ambiente));
        return $resultado;
    }

    /** Uma tentativa sem resposta: se a SEFAZ autorizou, cancela (a venda já tem a nota de contingência); senão inutiliza o número. */
    private function resolverIncerta(Tools $tools, array $incerta): void
    {
        $consulta = (new Standardize($tools->sefazConsultaChave($incerta['chave'])))->toStd();
        $cStat = (string) ($consulta->cStat ?? '');
        $criado = new DateTimeImmutable($incerta['criado_em']);
        if (in_array($cStat, self::AUTORIZADA, true)) {
            $nProt = (string) $consulta->protNFe->infProt->nProt;
            $resposta = $tools->sefazCancela(
                $incerta['chave'], 'Nota em duplicidade gerada por falha de comunicacao com a SEFAZ', $nProt,
            );
            $this->exigirEventoAceito($resposta);
            $this->arquivos->salvar(
                $this->arquivos->caminho($criado, $incerta['chave'] . '-cancelamento.xml'),
                Complements::toAuthorize($tools->lastRequest, $resposta),
            );
            $this->banco->resolverIncerta($incerta['chave'], 'cancelada', 'Autorizada pela SEFAZ e cancelada (duplicidade).');
            return;
        }
        if ($cStat === '101' || $cStat === '151') {
            $this->banco->resolverIncerta($incerta['chave'], 'cancelada', 'Já estava cancelada.');
            return;
        }
        // Não consta na SEFAZ: inutiliza o número para não deixar buraco na sequência.
        $resposta = $tools->sefazInutiliza(
            (int) $incerta['serie'], (int) $incerta['numero'], (int) $incerta['numero'],
            'Numero nao utilizado por falha de comunicacao com a SEFAZ', null, $criado->format('y'),
        );
        $ret = (new Standardize($resposta))->toStd();
        $cStatInut = (string) ($ret->infInut->cStat ?? $ret->cStat ?? '');
        if ($cStatInut !== '102' && $cStatInut !== '563') { // 563 = já inutilizado
            throw new ErroSefaz($cStatInut, (string) ($ret->infInut->xMotivo ?? $ret->xMotivo ?? ''));
        }
        $this->arquivos->salvar(
            $this->arquivos->caminho($criado, sprintf('inutilizacao-serie%d-num%d.xml', $incerta['serie'], $incerta['numero'])),
            $cStatInut === '102' ? Complements::toAuthorize($tools->lastRequest, $resposta) : $resposta,
        );
        $this->banco->resolverIncerta($incerta['chave'], 'inutilizada', 'Número inutilizado na SEFAZ.');
    }

    // ------------------------------------------------------------------ cancelamento

    public function cancelar(string $chave, string $justificativa): array
    {
        $nota = $this->banco->notaPorChave($chave);
        if (!$nota || (int) $nota['ambiente'] !== $this->config->ambiente) {
            throw new ErroFiscal('Nota não encontrada.', 404);
        }
        if ($nota['situacao'] === 'cancelada') {
            return $this->resposta($nota, 'A nota já estava cancelada.');
        }
        if ($nota['situacao'] === 'contingencia') {
            throw new ErroFiscal('Esta nota foi emitida sem internet e ainda não foi transmitida. '
                . 'Transmita as pendentes antes de cancelar.', 409);
        }
        if ($nota['situacao'] !== 'autorizada') {
            throw new ErroFiscal('Só é possível cancelar nota autorizada.', 409);
        }
        $justificativa = trim($justificativa);
        if (mb_strlen($justificativa) < 15 || mb_strlen($justificativa) > 255) {
            throw new ErroValidacao('A justificativa do cancelamento deve ter de 15 a 255 caracteres.');
        }
        $tools = $this->tools();
        try {
            $resposta = $tools->sefazCancela($chave, $justificativa, (string) $nota['protocolo']);
        } catch (\Throwable $e) {
            throw new ErroFiscal('Sem comunicação com a SEFAZ para cancelar. Tente de novo quando a internet voltar.', 503);
        }
        $this->exigirEventoAceito($resposta);
        $data = new DateTimeImmutable($nota['dh_emi']);
        $this->arquivos->salvar(
            $this->arquivos->caminho($data, "$chave-cancelamento.xml"),
            Complements::toAuthorize($tools->lastRequest, $resposta),
        );
        $this->banco->atualizarNota($chave, ['situacao' => 'cancelada', 'mensagem' => $justificativa]);
        return $this->resposta($this->banco->notaPorChave($chave));
    }

    private function exigirEventoAceito(string $resposta): void
    {
        $std = (new Standardize($resposta))->toStd();
        $cStatLote = (string) ($std->cStat ?? '');
        $evento = $std->retEvento->infEvento ?? null;
        $cStat = (string) ($evento->cStat ?? $cStatLote);
        if ($cStatLote !== '128' || !in_array($cStat, ['135', '136', '155'], true)) {
            throw new ErroSefaz($cStat, (string) ($evento->xMotivo ?? $std->xMotivo ?? 'Evento não aceito'));
        }
    }

    // ------------------------------------------------------------------ consultas

    public function nota(string $chave): array
    {
        $nota = $this->banco->notaPorChave($chave);
        if (!$nota) {
            throw new ErroFiscal('Nota não encontrada.', 404);
        }
        return $this->resposta($nota);
    }

    /** Situação geral: configuração, certificado, pendências e (opcionalmente) a SEFAZ. */
    public function situacao(bool $consultarSefaz): array
    {
        $cert = $this->certificado();
        $ambiente = $this->config->ambiente;
        $s = [
            'ambiente' => $ambiente === 1 ? 'producao' : 'homologacao',
            'uf' => $this->config->uf(),
            'emitente' => [
                'cnpj' => $this->config->cnpj(),
                'razaoSocial' => $this->config->emitente['razaoSocial'],
            ],
            'serie' => $this->config->serie,
            'proximoNumero' => $this->banco->proximoNumero($ambiente, $this->config->serie),
            'certificado' => [
                'titular' => $cert->getCompanyName(),
                'cnpj' => $cert->getCnpj(),
                'validoAte' => $cert->getValidTo()->format('Y-m-d'),
                'diasRestantes' => (int) floor(($cert->getValidTo()->getTimestamp() - time()) / 86400),
                'confereComEmitente' => $cert->getCnpj() === $this->config->cnpj(),
            ],
            'pendentes' => count($this->banco->notasEmContingencia($ambiente)) + count($this->banco->incertasPendentes($ambiente)),
            'comProblema' => array_map(fn ($n) => [
                'chave' => $n['chave'], 'numero' => (int) $n['numero'], 'motivo' => $n['mensagem'],
            ], $this->banco->notasComProblema($ambiente)),
            'sefaz' => null,
        ];
        if ($consultarSefaz) {
            try {
                $std = (new Standardize($this->tools()->sefazStatus()))->toStd();
                $s['sefaz'] = ['online' => (string) $std->cStat === '107', 'cStat' => (string) $std->cStat, 'motivo' => (string) $std->xMotivo];
            } catch (\Throwable $e) {
                $s['sefaz'] = ['online' => false, 'cStat' => null, 'motivo' => 'Sem comunicação: ' . $e->getMessage()];
            }
        }
        return $s;
    }

    public function zipDoMes(string $mes): string
    {
        return $this->arquivos->zipDoMes($mes);
    }

    // ------------------------------------------------------------------ montagem do XML

    private function montar(Pedido $p, int $numero, DateTimeImmutable $dhEmi, int $tpEmis, ?string $justificativa = null): string
    {
        $c = $this->config;
        $homologacao = $c->ambiente === 2;
        $end = $c->emitente['endereco'];
        $make = new Make(self::SCHEMA);
        $std = fn (array $a) => (object) $a;

        $make->taginfNFe($std(['Id' => '', 'versao' => '4.00']));
        $make->tagide($std([
            'cUF' => $c->codigoUf(),
            'cNF' => self::codigoNumerico($numero),
            'natOp' => 'VENDA AO CONSUMIDOR',
            'mod' => 65,
            'serie' => $c->serie,
            'nNF' => $numero,
            'dhEmi' => $dhEmi->format('Y-m-d\TH:i:sP'),
            'dhSaiEnt' => null,
            'tpNF' => 1,
            'idDest' => 1,
            'cMunFG' => (int) $end['codigoMunicipio'],
            'tpImp' => 4,               // DANFE NFC-e
            'tpEmis' => $tpEmis,        // 1 = normal, 9 = contingência offline
            'cDV' => 0,                 // calculado pela biblioteca
            'tpAmb' => $c->ambiente,
            'finNFe' => 1,
            'indFinal' => 1,
            'indPres' => 1,             // venda presencial
            'procEmi' => 0,             // emissão por aplicativo do contribuinte
            'verProc' => self::VERSAO_APP,
            'dhCont' => $tpEmis === 9 ? $dhEmi->format('Y-m-d\TH:i:sP') : null,
            'xJust' => $tpEmis === 9 ? $justificativa : null,
        ]));
        $make->tagemit($std([
            'xNome' => $c->emitente['razaoSocial'],
            'xFant' => $c->emitente['nomeFantasia'] ?? null,
            'IE' => preg_replace('/\D/', '', (string) $c->emitente['ie']),
            'CRT' => (int) ($c->emitente['crt'] ?? 1),  // 1 = Simples Nacional
            'CNPJ' => $c->cnpj(),
        ]));
        $make->tagenderEmit($std([
            'xLgr' => $end['logradouro'],
            'nro' => (string) $end['numero'],
            'xCpl' => $end['complemento'] ?? null,
            'xBairro' => $end['bairro'],
            'cMun' => (int) $end['codigoMunicipio'],
            'xMun' => $end['municipio'],
            'UF' => $c->uf(),
            'CEP' => preg_replace('/\D/', '', (string) $end['cep']),
            'cPais' => 1058,
            'xPais' => 'Brasil',
            'fone' => preg_replace('/\D/', '', (string) ($end['telefone'] ?? '')) ?: null,
        ]));
        if ($p->cpf !== null) {
            $make->tagdest($std(['CPF' => $p->cpf, 'indIEDest' => 9]));
        }

        foreach ($p->itens as $i => $it) {
            $item = $i + 1;
            $descricao = ($homologacao && $item === 1) ? self::TEXTO_HOMOLOGACAO : $it['descricao'];
            $make->tagprod($std([
                'item' => $item,
                'cProd' => $it['codigo'],
                'cEAN' => 'SEM GTIN',
                'xProd' => $descricao,
                'NCM' => $it['ncm'],
                'CEST' => $it['cest'],
                'CFOP' => $it['cfop'],
                'uCom' => $it['unidade'],
                'qCom' => $it['quantidade'],
                'vUnCom' => self::reais($it['valorUnitario']),
                'vProd' => self::reais($it['valorTotal']),
                'cEANTrib' => 'SEM GTIN',
                'uTrib' => $it['unidade'],
                'qTrib' => $it['quantidade'],
                'vUnTrib' => self::reais($it['valorUnitario']),
                'vDesc' => $it['desconto'] > 0 ? self::reais($it['desconto']) : null,
                'indTot' => 1,
            ]));
            $make->tagimposto($std(['item' => $item]));
            $make->tagICMSSN($std(['item' => $item, 'orig' => 0, 'CSOSN' => $it['csosn']]));
            $make->tagPIS($std(self::grupoPisCofins($item, $it['cstPis'], 'PIS')));
            $make->tagCOFINS($std(self::grupoPisCofins($item, $it['cstCofins'], 'COFINS')));
        }

        $make->tagICMSTot(new stdClass()); // totais calculados a partir dos itens
        $make->tagtransp($std(['modFrete' => 9])); // NFC-e: sem frete
        $make->tagpag($std(['vTroco' => $p->troco > 0 ? self::reais($p->troco) : null]));
        $detPag = [
            'indPag' => 0,
            'tPag' => Pedido::FORMAS_PAGAMENTO[$p->formaPagamento],
            'vPag' => self::reais($p->valorPago),
        ];
        if ($p->formaPagamento !== 'dinheiro') {
            $detPag['tpIntegra'] = 2; // maquininha/Pix não integrados ao sistema
        }
        $make->tagdetPag($std($detPag));

        $complemento = $p->numeroPedido !== null ? "Pedido no {$p->numeroPedido}" : '';
        if ($complemento !== '') {
            $make->taginfAdic($std(['infCpl' => $complemento]));
        }

        // Responsável técnico: o próprio emitente, a menos que outro seja configurado.
        $rt = $c->responsavelTecnico;
        $make->taginfRespTec($std([
            'CNPJ' => preg_replace('/\D/', '', (string) ($rt['cnpj'] ?? $c->cnpj())),
            'xContato' => $rt['contato'] ?? $c->emitente['razaoSocial'],
            'email' => $rt['email'] ?? ($c->emitente['email'] ?? 'contato@exemplo.com.br'),
            'fone' => preg_replace('/\D/', '', (string) ($rt['fone'] ?? ($end['telefone'] ?? '6200000000'))),
        ]));

        $xml = $make->getXML();
        $erros = $make->getErrors();
        if ($erros || $xml === '') {
            throw new ErroValidacao('Erro ao montar a nota: ' . implode('; ', $erros ?: ['XML vazio']));
        }
        return $xml;
    }

    private static function grupoPisCofins(int $item, string $cst, string $tributo): array
    {
        $g = ['item' => $item, 'CST' => $cst];
        if ((int) $cst >= 49) { // "outras operações": exige base/alíquota, aqui zeradas (Simples Nacional)
            $g += ['vBC' => 0.00, "p$tributo" => 0.00, "v$tributo" => 0.00];
        }
        return $g;
    }

    // ------------------------------------------------------------------ comunicação

    private function tools(): Tools
    {
        if ($this->tools === null) {
            $cert = $this->certificado();
            $tools = new Tools($this->config->jsonSped(), $cert);
            $tools->model(65);
            $tools->setVerAplic(self::VERSAO_APP);
            $soap = $this->soap ?? new SoapCurl($cert);
            $soap->timeout($this->config->timeoutSefaz);
            $tools->loadSoapClass($soap);
            $this->tools = $tools;
        }
        return $this->tools;
    }

    private function certificado(): Certificate
    {
        if ($this->certificado === null) {
            $arquivo = $this->config->certificadoArquivo;
            if (!is_file($arquivo)) {
                throw new ErroConfiguracao("Certificado digital não encontrado em: $arquivo");
            }
            try {
                $cert = Certificate::readPfx((string) file_get_contents($arquivo), $this->config->certificadoSenha);
            } catch (\Throwable $e) {
                throw new ErroConfiguracao('Não foi possível abrir o certificado (senha errada ou arquivo inválido).');
            }
            if ($cert->isExpired()) {
                throw new ErroConfiguracao('O certificado digital venceu em ' . $cert->getValidTo()->format('d/m/Y') . '. Renove-o.');
            }
            $this->certificado = $cert;
        }
        return $this->certificado;
    }

    /** Envia (síncrono). Se a SEFAZ responder "recebido, em processamento", consulta o recibo algumas vezes. */
    private function enviar(Tools $tools, string $xml): string
    {
        $idLote = str_pad((string) random_int(1, 999999999999999), 15, '0', STR_PAD_LEFT);
        $resposta = $tools->sefazEnviaLote([$xml], $idLote, 1);
        $std = (new Standardize($resposta))->toStd();
        if ((string) ($std->cStat ?? '') === '103' && !empty($std->infRec->nRec)) {
            for ($tentativa = 0; $tentativa < 4; $tentativa++) {
                sleep(1 + $tentativa);
                $resposta = $tools->sefazConsultaRecibo((string) $std->infRec->nRec);
                $consulta = (new Standardize($resposta))->toStd();
                if ((string) ($consulta->cStat ?? '') !== '105') { // 105 = ainda em processamento
                    return $resposta;
                }
            }
            throw new \RuntimeException('A SEFAZ não terminou de processar a nota a tempo.');
        }
        return $resposta;
    }

    /** Classifica a resposta da SEFAZ (envio, recibo ou consulta por chave). */
    private function interpretar(string $resposta): array
    {
        $std = (new Standardize($resposta))->toStd();
        $cStatLote = (string) ($std->cStat ?? '');
        $infProt = $std->protNFe->infProt ?? null;
        if ($infProt === null) {
            $tipo = in_array($cStatLote, self::SEFAZ_PARALISADA, true) ? 'indisponivel' : 'rejeitada';
            return ['tipo' => $tipo, 'cStat' => $cStatLote, 'xMotivo' => (string) ($std->xMotivo ?? ''), 'nProt' => null, 'dhRecbto' => null];
        }
        $cStat = (string) $infProt->cStat;
        $tipo = match (true) {
            in_array($cStat, self::AUTORIZADA, true) => 'autorizada',
            in_array($cStat, self::DENEGADA, true) => 'denegada',
            default => 'rejeitada',
        };
        return [
            'tipo' => $tipo, 'cStat' => $cStat, 'xMotivo' => (string) $infProt->xMotivo,
            'nProt' => isset($infProt->nProt) ? (string) $infProt->nProt : null,
            'dhRecbto' => isset($infProt->dhRecbto) ? (string) $infProt->dhRecbto : null,
        ];
    }

    // ------------------------------------------------------------------ resposta para o caixa

    /** Dados que o caixa precisa para imprimir o DANFE NFC-e. */
    private function resposta(array $nota, ?string $aviso = null): array
    {
        $xml = $this->arquivos->ler($nota['arquivo']);
        $qrCode = $nota['qr_code'] ?: self::tagDoXml($xml, 'qrCode');
        $c = $this->config;
        $end = $c->emitente['endereco'];
        return [
            'situacao' => $nota['situacao'],                 // autorizada | contingencia | cancelada | ...
            'chave' => $nota['chave'],
            'numero' => (int) $nota['numero'],
            'serie' => (int) $nota['serie'],
            'ambiente' => (int) $nota['ambiente'] === 1 ? 'producao' : 'homologacao',
            'contingencia' => (int) $nota['tp_emis'] === 9,
            'dhEmi' => $nota['dh_emi'],
            'protocolo' => $nota['protocolo'],
            'dhRecbto' => $nota['dh_recbto'],
            'qrCode' => $qrCode,
            'qrCodeImagem' => $qrCode ? (new QRCode())->render($qrCode) : null, // data:image/svg+xml;base64,...
            'urlConsulta' => self::tagDoXml($xml, 'urlChave'),
            'mensagem' => $aviso ?? $nota['mensagem'],
            'emitente' => [
                'razaoSocial' => $c->emitente['razaoSocial'],
                'nomeFantasia' => $c->emitente['nomeFantasia'] ?? null,
                'cnpj' => $c->cnpj(),
                'ie' => preg_replace('/\D/', '', (string) $c->emitente['ie']),
                'endereco' => trim(sprintf('%s, %s%s - %s, %s/%s', $end['logradouro'], $end['numero'],
                    !empty($end['complemento']) ? ' ' . $end['complemento'] : '', $end['bairro'], $end['municipio'], $c->uf())),
            ],
            'cpf' => self::tagDoXml($xml, 'CPF'),
        ];
    }

    // ------------------------------------------------------------------ utilitários

    private static function reais(int $centavos): string
    {
        return number_format($centavos / 100, 2, '.', '');
    }

    /** Código numérico aleatório de 8 dígitos (diferente do número da nota, como exige a SEFAZ). */
    private static function codigoNumerico(int $numero): string
    {
        do {
            $codigo = str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
        } while ((int) $codigo === $numero);
        return $codigo;
    }

    public static function chaveDoXml(string $xml): string
    {
        $dom = new \DOMDocument();
        $dom->loadXML($xml);
        $infNFe = $dom->getElementsByTagName('infNFe')->item(0);
        return substr((string) $infNFe?->getAttribute('Id'), 3);
    }

    private static function tagDoXml(string $xml, string $tag): ?string
    {
        $dom = new \DOMDocument();
        $dom->loadXML($xml);
        $no = $dom->getElementsByTagName($tag)->item(0);
        return $no ? trim($no->nodeValue) : null;
    }
}
