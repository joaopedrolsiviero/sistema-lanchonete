# Recanto do Café — Sistema de Caixa

Sistema de caixa para o **Recanto do Café** (cafeteria e salgados) que roda no navegador, **sem servidor e sem mensalidade**.

- **Caixa (PDV):** monte o pedido tocando nos produtos, adicione observações ("sem açúcar", "leite sem lactose"), aplique desconto,
  escolha a forma de pagamento (dinheiro com cálculo de troco, Pix, débito ou crédito) e imprima a comanda.
- **Cardápio:** categorias, produtos, preços e *ficha técnica* (quais insumos cada produto consome).
- **Estoque:** insumos com estoque mínimo. A baixa é automática a cada venda, e a venda cancelada devolve os insumos.
  Há alerta de reposição.
- **Relatórios:** faturamento, pedidos, ticket médio, vendas por forma de pagamento, produtos mais vendidos,
  histórico com cancelamento/reimpressão e exportação para planilha (CSV).
- **Ajustes:** nome da loja e backup (baixar/restaurar).
- Funciona **offline** e pode ser instalado como app (PWA).

## Onde ficam os dados

Os dados ficam salvos **no navegador do computador do caixa**, no banco de dados interno do navegador
(IndexedDB), com espaço para muitos anos de vendas. Nada fica na internet. Por isso:

- Use sempre o **mesmo computador e o mesmo navegador** (o app instalado e o site no mesmo Chrome compartilham os dados).
- O sistema pede ao navegador **armazenamento permanente**, para ele não apagar os dados sozinho quando
  faltar espaço no disco. A situação aparece em Ajustes → Armazenamento; costuma ser concedido quando o
  sistema está instalado como app.
- Mesmo assim, "Limpar dados de navegação" apaga tudo. Faça **backup** regularmente
  (Ajustes → Baixar backup) e guarde o arquivo em outro lugar (Google Drive, pen drive).

Versões anteriores usavam o `localStorage` (limite de ~5 MB). Ao abrir esta versão, os dados antigos
são transferidos automaticamente.

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
js/store.js           regras de negócio  ← principal
js/persistencia.js    gravação dos dados no navegador (IndexedDB)
js/util.js            formatação de moeda, datas etc.
js/ui.js              avisos, diálogos e impressão
js/views/*.js         uma tela por arquivo
sw.js                 funcionamento offline
tests/                testes das regras de negócio (node --test)
```

Valores em dinheiro são guardados em **centavos** (inteiros) para evitar erros de arredondamento.
