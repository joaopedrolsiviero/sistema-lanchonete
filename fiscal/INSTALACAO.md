# Emissor NFC-e — guia de instalação

O **Emissor NFC-e** é um programa que roda no computador do caixa e emite as notas fiscais de consumidor
(NFC-e) na SEFAZ-GO. O sistema de caixa conversa com ele automaticamente ao finalizar cada venda.
Ele usa a biblioteca gratuita [sped-nfe](https://github.com/nfephp-org/sped-nfe).

> ⚠️ Comece sempre em **homologação** (ambiente de testes da SEFAZ, sem valor fiscal). Só passe para produção
> depois de testar tudo (passo 8).

---

## 0. O que você precisa ter antes (com o contador)

| Item | Onde conseguir |
|---|---|
| **Certificado digital e-CNPJ A1** (arquivo `.pfx` + senha) | Comprado numa certificadora (o contador indica) |
| **Credenciamento para NFC-e na SEFAZ-GO** | Portal da SEFAZ-GO, com o certificado (o contador costuma fazer) |
| **CSC de homologação** (ID e código) | Gerado no portal da SEFAZ-GO depois do credenciamento |
| **Dados da empresa**: CNPJ, Inscrição Estadual, razão social, endereço | Cartão CNPJ / contador |
| **NCM de cada produto** (e confirmação de CFOP, CSOSN e CST PIS/COFINS) | Contador |

**Sobre o arquivo `.pfx`:** se o certificado foi instalado direto no Windows, exporte assim:
`Win + R` → `certmgr.msc` → Pessoal → Certificados → botão direito no certificado da empresa →
Todas as Tarefas → Exportar → **"Sim, exportar a chave privada"** → formato `.PFX` →
marque a senha e escolha a criptografia **AES256-SHA256**. (Arquivos antigos com outra criptografia não abrem;
o emissor avisa se for o caso.)

---

## 1. Instalar

No computador do caixa (Windows 10 ou 11, 64 bits), abra o **PowerShell** (menu Iniciar → digite *PowerShell*)
e cole este comando:

```powershell
irm https://raw.githubusercontent.com/joaopedrolsiviero/sistema-lanchonete/main/fiscal/instalador/instalar.ps1 | iex
```

O instalador:
- instala o PHP e o emissor em `C:\RecantoFiscal`;
- cria `C:\RecantoFiscal\config.json` com um **token** aleatório (anote, aparece no final);
- faz o emissor iniciar sozinho quando o Windows liga;
- cria na Área de Trabalho os atalhos **Iniciar Emissor NFC-e** e **Configuração do Emissor NFC-e**.

Se o Windows pedir permissão para instalar o *Microsoft Visual C++*, aceite (o PHP precisa dele).

## 2. Copiar o certificado

Copie o arquivo `.pfx` para **`C:\RecantoFiscal\certificado.pfx`**.

## 3. Preencher a configuração

Abra **Configuração do Emissor NFC-e** (atalho na Área de Trabalho) e preencha:

| Campo | O que colocar |
|---|---|
| `ambiente` | `2` = homologação (testes). Deixe 2 por enquanto. |
| `token` | Já vem preenchido. **Não compartilhe.** |
| `emitente.cnpj`, `ie`, `razaoSocial`, `nomeFantasia` | Dados da empresa |
| `emitente.crt` | `1` = Simples Nacional (ME) |
| `emitente.endereco.codigoMunicipio` | Código IBGE da cidade (Goiânia = `5208707`; outras cidades: [IBGE](https://www.ibge.gov.br/explica/codigos-dos-municipios.php)) |
| `certificado.senha` | Senha do `.pfx` |
| `csc.id` e `csc.codigo` | ID (ex.: `000001`) e código do CSC gerado na SEFAZ-GO |
| `serie` | Série das notas (normalmente `1`) |
| `pastaXml` | Onde guardar os XMLs. O instalador já sugere uma pasta no OneDrive (vai para a nuvem). |

Salve o arquivo e clique duas vezes em **Iniciar Emissor NFC-e** (ou reinicie o computador).

> A pasta `C:\RecantoFiscal` fica acessível só para o seu usuário do Windows, pois o `config.json`
> guarda a senha do certificado.

## 4. Ligar o caixa ao emissor

No sistema de caixa: **Ajustes → Nota fiscal (NFC-e)**:
1. Marque **"Emitir NFC-e em todas as vendas"**.
2. Endereço: `http://127.0.0.1:8765` (já vem preenchido).
3. Cole o **token** do `config.json`.
4. Abra **Padrões fiscais** e confira CFOP, CSOSN e CST com o contador.
5. Clique em **Salvar** e depois em **Testar conexão**.

Se o Chrome perguntar se o site pode **acessar dispositivos da rede local / deste computador**, clique em **Permitir**
(é assim que o caixa, que está na internet, conversa com o emissor no próprio computador).

O teste deve mostrar: ambiente HOMOLOGAÇÃO, o certificado da empresa (válido) e SEFAZ *em operação*.

## 5. Cadastrar os dados fiscais dos produtos

Em **Cardápio**, edite cada produto e preencha pelo menos o **NCM** (os demais campos usam os padrões).
Produtos sem NCM aparecem com a etiqueta **"sem NCM"** e o caixa não deixa vendê-los com nota.

## 6. Como funciona no dia a dia

- **Finalizar pedido** → o caixa emite a NFC-e e mostra *"NFC-e nº X autorizada"* → **Imprimir NFC-e**.
- **CPF na nota:** campo opcional no caixa.
- **Sem internet ou SEFAZ fora do ar:** a nota sai **em contingência** (o cupom avisa). O caixa envia sozinho
  à SEFAZ quando a conexão volta (a cada 5 minutos). O prazo legal é de **24 horas** — uma faixa amarela no topo
  avisa enquanto houver notas pendentes.
- **Emissor fechado:** o caixa avisa e oferece *Tentar de novo* ou *Registrar sem nota*. A venda sem nota aparece
  em Relatórios com o botão **Emitir NFC-e** para emitir assim que o emissor voltar.
- **Cancelar:** em Relatórios → Cancelar, com o motivo. A nota é cancelada na SEFAZ antes da venda.
  O prazo para cancelar NFC-e é curto — cancele logo após a venda.
- **XMLs para o contador:** Ajustes → Nota fiscal → *Baixar .zip para o contador* (escolha o mês).
  Os XMLs também ficam na pasta configurada em `pastaXml`, organizados por ano/mês, e **nunca são apagados**
  (a lei exige guardar por pelo menos 5 anos).

## 7. Testes em homologação (faça todos antes de ir para produção)

1. Venda simples em dinheiro, com troco → nota autorizada, imprimir, conferir o QR Code no celular.
2. Venda com CPF na nota e com desconto.
3. Venda em Pix, débito e crédito.
4. Cancelamento de uma venda com nota.
5. Desligue o Wi-Fi/cabo → faça uma venda (sai em contingência) → religue → Ajustes → *Enviar agora* → a nota
   deve ficar autorizada.
6. Feche o emissor (Gerenciador de Tarefas → finalizar `php`) → tente vender → *Registrar sem nota* →
   abra o emissor → Relatórios → *Emitir NFC-e*.

Em homologação, a primeira linha de cada nota sai com o texto obrigatório
"NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL".

## 8. Passar para produção

1. Gere o **CSC de produção** no portal da SEFAZ-GO.
2. No `config.json`: `"ambiente": 1` e o `csc` de produção.
3. Reinicie o emissor. Em Ajustes → *Testar conexão* deve aparecer **PRODUÇÃO**.

A numeração de produção é separada da de homologação e começa em 1. Se a empresa já emitiu NFC-e com outro
programa nesta mesma série, avise antes: é preciso continuar a numeração de onde parou (ou usar outra série).

## 9. Manutenção

- **Atualizar o emissor** (novas regras da SEFAZ / reforma tributária): rode de novo o comando do passo 1.
  Configuração, certificado, notas e XMLs são mantidos.
- **Certificado vence todo ano:** o caixa avisa 30 dias antes. Troque o arquivo `certificado.pfx`
  (e a senha no `config.json`) e reinicie o emissor.

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| "O serviço fiscal não respondeu" | Clique em **Iniciar Emissor NFC-e** na Área de Trabalho. |
| "Token inválido" | O token em Ajustes deve ser igual ao do `config.json`. |
| "Falta o campo ... na configuração" | Preencha o campo indicado no `config.json` e reinicie o emissor. |
| "não é um JSON válido" | Erro de digitação no `config.json` (vírgula ou aspas). |
| "O certificado está num formato antigo" | Exporte de novo com AES256-SHA256 (passo 0). |
| "Cadastre o NCM no Cardápio" | Preencha o NCM do produto indicado. |
| "SEFAZ recusou (código): motivo" | Leia o motivo; geralmente é dado fiscal do produto ou da empresa. Mostre ao contador. |
| Faixa "notas recusadas após contingência" | Procure o contador: a nota impressa precisa ser corrigida e reenviada. |

Erros internos ficam registrados em `C:\RecantoFiscal\dados\erros.log`.
