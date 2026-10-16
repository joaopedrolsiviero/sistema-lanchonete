<?php

declare(strict_types=1);

namespace Recanto\Fiscal\Testes;

use NFePHP\Common\Exception\SoapException;
use NFePHP\Common\Soap\SoapBase;
use NFePHP\Common\Soap\SoapInterface;

/**
 * SEFAZ de mentira para os testes: responde conforme a fila de "modos" configurada.
 *   autoriza    → nota autorizada (cStat 100)
 *   rejeita     → nota recusada (cStat 225)
 *   duplicidade → cStat 204
 *   paralisada  → lote com cStat 108 (serviço paralisado)
 *   sem_rede    → lança exceção de comunicação (como internet caída/timeout)
 * Consultas por chave respondem "não consta" (217) a menos que a chave tenha sido autorizada aqui.
 */
final class SefazSimulada extends SoapBase implements SoapInterface
{
    /** @var string[] */
    public array $modos = [];
    /** @var array<string, string> chave => nProt */
    public array $autorizadas = [];
    /** @var string[] */
    public array $chamadas = [];
    private int $protocolo = 152260000000000;

    public function send($url, $operation = '', $action = '', $soapver = SOAP_1_2, $parameters = [],
        $namespaces = [], $request = '', $soapheader = null)
    {
        $tipo = match (true) {
            str_contains($request, '<enviNFe') => 'envio',
            str_contains($request, '<consSitNFe') => 'consulta',
            str_contains($request, '<envEvento') => 'evento',
            str_contains($request, '<inutNFe') => 'inutilizacao',
            str_contains($request, '<consStatServ') => 'status',
            default => 'desconhecido',
        };
        $this->chamadas[] = $tipo;
        if ($tipo === 'envio') {
            $modo = array_shift($this->modos) ?? 'autoriza';
            if ($modo === 'sem_rede') {
                throw new SoapException('Operation timed out after 10001 milliseconds');
            }
            return $this->envio($request, $modo);
        }
        if (($this->modos[0] ?? null) === 'sem_rede') {
            array_shift($this->modos);
            throw new SoapException('Could not resolve host');
        }
        return match ($tipo) {
            'consulta' => $this->consulta($request),
            'evento' => $this->evento($request),
            'inutilizacao' => $this->inutilizacao($request),
            'status' => $this->ret('retConsStatServ', '<tpAmb>2</tpAmb><verAplic>SIM</verAplic><cStat>107</cStat>'
                . '<xMotivo>Servico em Operacao</xMotivo><cUF>52</cUF><dhRecbto>' . date('c') . '</dhRecbto>'),
            default => throw new \LogicException('Pedido desconhecido para a SEFAZ simulada'),
        };
    }

    private function envio(string $request, string $modo): string
    {
        $chave = self::valor($request, 'chNFe') ?? substr((string) self::atributo($request, 'infNFe', 'Id'), 3);
        $digVal = self::valor($request, 'DigestValue');
        if ($modo === 'paralisada') {
            return $this->ret('retEnviNFe', '<tpAmb>2</tpAmb><verAplic>SIM</verAplic><cStat>108</cStat>'
                . '<xMotivo>Servico Paralisado Momentaneamente (curto prazo)</xMotivo><cUF>52</cUF><dhRecbto>' . date('c') . '</dhRecbto>');
        }
        [$cStat, $xMotivo, $nProt] = match ($modo) {
            'autoriza' => ['100', 'Autorizado o uso da NF-e', (string) ++$this->protocolo],
            'rejeita' => ['225', 'Rejeicao: Falha no Schema XML da NFe', null],
            'duplicidade' => ['204', 'Rejeicao: Duplicidade de NF-e', null],
            default => throw new \LogicException("Modo desconhecido: $modo"),
        };
        if ($nProt !== null) {
            $this->autorizadas[$chave] = $nProt;
        }
        $prot = '<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SIM</verAplic>'
            . "<chNFe>$chave</chNFe><dhRecbto>" . date('c') . '</dhRecbto>'
            . ($nProt !== null ? "<nProt>$nProt</nProt>" : '')
            . "<digVal>$digVal</digVal><cStat>$cStat</cStat><xMotivo>$xMotivo</xMotivo></infProt></protNFe>";
        return $this->ret('retEnviNFe', '<tpAmb>2</tpAmb><verAplic>SIM</verAplic><cStat>104</cStat>'
            . '<xMotivo>Lote processado</xMotivo><cUF>52</cUF><dhRecbto>' . date('c') . "</dhRecbto>$prot");
    }

    private function consulta(string $request): string
    {
        $chave = (string) self::valor($request, 'chNFe');
        if (!isset($this->autorizadas[$chave])) {
            return $this->ret('retConsSitNFe', '<tpAmb>2</tpAmb><verAplic>SIM</verAplic><cStat>217</cStat>'
                . "<xMotivo>Rejeicao: NF-e nao consta na base de dados da SEFAZ</xMotivo><cUF>52</cUF><dhRecbto>" . date('c')
                . "</dhRecbto><chNFe>$chave</chNFe>");
        }
        $nProt = $this->autorizadas[$chave];
        return $this->ret('retConsSitNFe', '<tpAmb>2</tpAmb><verAplic>SIM</verAplic><cStat>100</cStat>'
            . '<xMotivo>Autorizado o uso da NF-e</xMotivo><cUF>52</cUF><dhRecbto>' . date('c') . "</dhRecbto><chNFe>$chave</chNFe>"
            . '<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SIM</verAplic>'
            . "<chNFe>$chave</chNFe><dhRecbto>" . date('c') . "</dhRecbto><nProt>$nProt</nProt>"
            . '<digVal>xxx</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>');
    }

    private function evento(string $request): string
    {
        $chave = (string) self::valor($request, 'chNFe');
        unset($this->autorizadas[$chave]);
        $nProt = (string) ++$this->protocolo;
        $idLote = (string) self::valor($request, 'idLote'); // a SEFAZ devolve o mesmo número de lote
        return $this->ret('retEnvEvento', "<idLote>$idLote</idLote><tpAmb>2</tpAmb><verAplic>SIM</verAplic><cOrgao>52</cOrgao>"
            . '<cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>'
            . "<retEvento versao=\"1.00\"><infEvento Id=\"ID$nProt\"><tpAmb>2</tpAmb><verAplic>SIM</verAplic><cOrgao>52</cOrgao>"
            . '<cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>'
            . "<chNFe>$chave</chNFe><tpEvento>110111</tpEvento><xEvento>Cancelamento</xEvento><nSeqEvento>1</nSeqEvento>"
            . '<dhRegEvento>' . date('c') . "</dhRegEvento><nProt>$nProt</nProt></infEvento></retEvento>");
    }

    private function inutilizacao(string $request): string
    {
        $campos = '';
        foreach (['tpAmb', 'cUF', 'ano', 'CNPJ', 'mod', 'serie', 'nNFIni', 'nNFFin'] as $tag) {
            if ($tag === 'tpAmb' || $tag === 'cUF') {
                continue;
            }
            $campos .= "<$tag>" . self::valor($request, $tag) . "</$tag>";
        }
        $nProt = (string) ++$this->protocolo;
        return $this->ret('retInutNFe', '<infInut><tpAmb>2</tpAmb><verAplic>SIM</verAplic><cStat>102</cStat>'
            . '<xMotivo>Inutilizacao de numero homologado</xMotivo><cUF>52</cUF>' . $campos
            . '<dhRecbto>' . date('c') . "</dhRecbto><nProt>$nProt</nProt></infInut>");
    }

    private function ret(string $raiz, string $conteudo): string
    {
        return "<$raiz xmlns=\"http://www.portalfiscal.inf.br/nfe\" versao=\"4.00\">$conteudo</$raiz>";
    }

    private static function valor(string $xml, string $tag): ?string
    {
        return preg_match("#<$tag>([^<]*)</$tag>#", $xml, $m) ? $m[1] : null;
    }

    private static function atributo(string $xml, string $tag, string $attr): ?string
    {
        return preg_match("#<$tag\\b[^>]*\\b$attr=\"([^\"]*)\"#", $xml, $m) ? $m[1] : null;
    }
}
