# Sistema Lanchonete

Sistema de caixa para lanchonete que roda no navegador, **sem servidor e sem mensalidade**.

- **Caixa (PDV):** monte o pedido tocando nos produtos, adicione observações ("sem cebola"), aplique desconto,
  escolha a forma de pagamento (dinheiro com cálculo de troco, Pix, débito ou crédito) e imprima a comanda.
- **Cardápio:** categorias, produtos, preços e *ficha técnica* (quais insumos cada produto consome).
- **Estoque:** insumos com estoque mínimo. A baixa é automática a cada venda, e a venda cancelada devolve os insumos.
  Há alerta de reposição.
- **Relatórios:** faturamento, pedidos, ticket médio, vendas por forma de pagamento, produtos mais vendidos,
  histórico com cancelamento/reimpressão e exportação para planilha (CSV).
- **Ajustes:** nome da loja e backup (baixar/restaurar).
- Funciona **offline** e pode ser instalado como app (PWA).

## Onde ficam os dados

Os dados ficam salvos **no navegador do computador do caixa** (`localStorage`). Por isso:

- Use sempre o **mesmo computador e o mesmo navegador**.
- Faça **backup** regularmente (Ajustes → Baixar backup) e guarde o arquivo em outro lugar (Google Drive, pen drive).
- Limpar os dados de navegação apaga o sistema. Se isso acontecer, use Ajustes → Restaurar backup.

## Rodar no computador

Precisa só de Python 3 (ou de qualquer servidor de arquivos estáticos):

```bash
npm start          # ou: python3 -m http.server 8080
```

Abra http://localhost:8080.

## Publicar de graça (GitHub Pages)

1. No repositório do GitHub: **Settings → Pages**.
2. Em *Source*, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Em alguns minutos o sistema fica em `https://SEU-USUARIO.github.io/sistema-lanchonete/`.
4. No computador do caixa, abra esse endereço no Chrome/Edge e clique em **Instalar** na barra de endereço.

> Ao publicar uma alteração, aumente `VERSAO` em `sw.js` para os navegadores baixarem a nova versão.

## Testes

```bash
npm test
```

## Estrutura

```
index.html            página única
css/style.css         visual (inclui layout de impressão da comanda)
js/app.js             inicialização e navegação entre abas
js/store.js           regras de negócio e gravação dos dados  ← principal
js/util.js            formatação de moeda, datas etc.
js/ui.js              avisos, diálogos e impressão
js/views/*.js         uma tela por arquivo
sw.js                 funcionamento offline
tests/                testes das regras de negócio (node --test)
```

Valores em dinheiro são guardados em **centavos** (inteiros) para evitar erros de arredondamento.
