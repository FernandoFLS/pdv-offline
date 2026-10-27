# Roadmap do projeto

## 1. Objetivo do roadmap

Organizar o desenvolvimento do PDV em etapas pequenas, priorizando integridade, segurança e confiabilidade antes de funcionalidades secundárias.

## 2. Etapa 1 — Preparação e base documental

### Objetivo
- consolidar requisitos;
- registrar arquitetura e decisões de design;
- definir limites de segurança;
- separar o escopo operacional do escopo de integração.

### Resultados esperados
- README com visão geral do projeto.
- Documentação de requisitos.
- Documentação de arquitetura.
- Documentação de segurança.
- Documentação de backup e sincronização.

### Critério de conclusão
- A base do projeto está documentada e coerente.
- Não há contradições entre requisitos, arquitetura e segurança.

## 3. Etapa 2 — Persistência local e fluxo base do caixa

### Objetivo
- definir o modelo local operacional;
- registrar caixa, abertura, fechamento e histórico;
- preparar a base para vendas e estoque.

### Funcionalidades esperadas
- login por PIN;
- sessão de caixa;
- abertura e fechamento de caixa;
- operações básicas de auditoria;
- persistência local consistente.

### Critério de conclusão
- O caixa pode ser aberto, operado e fechado localmente sem perder integridade.

## 4. Etapa 3 — Produtos, estoque e vendas

### Objetivo
- criar a base operacional do PDV para itens, estoque e checkout.

### Funcionalidades esperadas
- catálogo de produtos;
- estoque local;
- carrinho e checkout;
- pagamentos combinados;
- histórico de vendas;
- prova de venda em tela.

### Critério de conclusão
- Vendas podem ser registradas localmente com consistência mínima de caixa e estoque.

## 5. Etapa 4 — Confiabilidade e recuperação

### Objetivo
- reforçar integridade e robustez antes da integração externa.

### Funcionalidades esperadas
- fila de sincronização;
- idempotência;
- retry;
- auditoria de cancelamentos;
- backup e recuperação;
- recuperação após falha local.

### Critério de conclusão
- A aplicação continua íntegra mesmo com falhas de operação ou de conectividade.

## 6. Etapa 5 — Integração externa e sincronização

### Objetivo
- conectar o sistema com a integração externa definida futuramente.

### Funcionalidades esperadas
- sincronização eventual;
- tratamento de conflitos;
- reprocessamento de pendências;
- prevenção de duplicações.

### Critério de conclusão
- A sincronização externa não compromete a consistência local.

## 7. Etapa 6 — Relatórios e refinamento

### Objetivo
- melhorar a operacionalidade do sistema.

### Funcionalidades esperadas
- relatórios de vendas;
- relatórios de caixa;
- estoque e divergências;
- refinamento visual e usabilidade.

### Critério de conclusão
- A operação pode ser acompanhada com relatórios úteis e confiáveis.

## 8. Priorização

A ordem correta é:
1. integridade do caixa;
2. integridade do estoque;
3. consistência das vendas;
4. operação offline;
5. sincronização externa;
6. relatórios e refinamentos.

## 9. Decisões em aberto

- A tecnologia exata da integração externa com o Google Sheets será definida em momento posterior.
- Os testes automatizados e a ferramenta escolhida para executá-los serão definidos em uma etapa posterior.
- O desenvolvimento da interface e do código da aplicação ainda não foi iniciado.
