# Requisitos do projeto

## 1. Objetivo

Desenvolver um sistema de ponto de venda (PDV) em aplicação web instalável no formato PWA, com funcionamento offline e sincronização posterior com o Google Sheets.

A aplicação deve operar localmente em um único computador, mas a arquitetura deve ser pensada para permitir expansão para múltiplos dispositivos no futuro, sem reescrever a base do sistema.

## 2. Tecnologias e premissas iniciais

Tecnologias consideradas inicialmente:
- JavaScript
- HTML e CSS
- Vite para desenvolvimento e build
- PWA com Service Worker
- IndexedDB para persistência local
- Google Sheets para integração externa

### Observação técnica importante

A combinação de JavaScript + PWA + IndexedDB é adequada para um sistema local com suporte offline. O principal ponto a considerar é que o navegador não oferece ambiente de execução equivalente a um servidor seguro para armazenar segredos ou realizar autenticação forte.

Portanto, o projeto deve usar:
- IndexedDB como base operacional local;
- PWA para carregamento e uso offline da interface;
- integração externa somente por uma camada segura no futuro, e não por credenciais salvas no frontend.

## 3. Regras fundamentais de arquitetura

- IndexedDB será a base operacional local para vendas, produtos, estoque, caixa e operações pendentes.
- O Service Worker será responsável por manter a aplicação carregável offline e disponibilizar os recursos necessários, sem substituir a persistência principal.
- O sistema deve continuar permitindo operações compatíveis com o modo offline.
- A sincronização deve possuir fila persistente, tratamento de falhas, reprocessamento e prevenção de duplicações.
- Cada operação sincronizável deve possuir identificador único e estratégia de idempotência.
- Deve ser documentado como tratar conflitos, alterações simultâneas, exclusões lógicas e reprocessamento.
- Google Sheets deve ser considerado uma integração externa e não a fonte primária de dados ou a solução para todos os conflitos.
- A arquitetura deve separar claramente dados locais, dados sincronizados e operações pendentes.
- O sistema deve prever exportação e recuperação de backups.
- A aplicação não pode depender de internet constante para registrar vendas locais.

## 4. Regras de negócio previstas

### 4.1 Autenticação e permissões
- Login por PIN.
- Perfis de administrador e operador.
- Operações administrativas protegidas por autorização.
- O PIN não deve ser salvo em texto puro.
- Deve ser documentado o limite de segurança do PIN em uma aplicação local executada no navegador.

### 4.2 Produtos e estoque
- Cadastro e edição de produtos.
- Categorias.
- SKU e código de barras EAN.
- Custo, preço de venda e promoções.
- Movimentações e histórico de estoque.
- Permitir vendas mesmo quando o estoque ficar negativo, conforme regra de negócio.
- Produtos com histórico de vendas não devem ser excluídos fisicamente; devem poder ser inativados.

### 4.3 Vendas
- Carrinho e checkout.
- Pagamentos em dinheiro, Pix com confirmação manual, débito e crédito.
- Pagamentos combinados na mesma venda.
- Descontos somente para administradores.
- Comprovante exibido na tela, sem necessidade inicial de impressora.
- Histórico de vendas.
- Vendas registradas de forma consistente, evitando gravação parcial.
- Não excluir vendas históricas.
- Cancelamentos com registro de auditoria e autorização administrativa.
- O operador poderá solicitar cancelamento, mas será necessária reautenticação ou aprovação administrativa antes de efetivá-lo.
- Cancelamento de venda não significa exclusão do registro histórico. A venda original deve permanecer documentada no histórico, com auditoria e movimentações compensatórias coerentes para caixa e estoque, preservando a integridade dos registros.

### 4.4 Controle de caixa
- Apenas um caixa aberto por vez.
- Não permitir vendas com caixa fechado.
- Abertura com valor inicial.
- Registro de retiradas (sangrias).
- Registro de entradas adicionais (suprimentos).
- Fechamento com conferência dos valores esperados e informados.
- Histórico de sessões de caixa.
- Qualquer cancelamento ou ajuste financeiro relevante deve refletir de forma consistente no caixa e no histórico da sessão.

### 4.5 Relatórios
- Histórico e consulta de vendas.
- Relatórios básicos de vendas e pagamentos.
- Informações de estoque.
- Resumo de caixa e divergências de fechamento.

## 5. Requisitos de integridade

Os fluxos críticos devem ser projetados com foco em integridade e confiabilidade:

- Operações de venda consistentes.
- Atualização de estoque coerente.
- Identificadores únicos por operação e por registro sincronizável.
- Idempotência para evitar duplicação na sincronização e no reprocessamento.
- Auditoria de cancelamentos, reversões e ajustes importantes.
- Histórico permanente de vendas e movimentos financeiros.
- Backups locais e estratégia de recuperação.
- Tratamento de falhas sem deixar a venda parcialmente registrada.
- Cancelamentos devem gerar registros de auditoria e compensações de caixa e estoque, em vez de apagar o histórico original da venda.

## 6. Requisitos de operação offline

- A aplicação deve permitir registrar vendas locais sem conectar-se ao servidor externo.
- A persistência local deve ser suficiente para manter a operação normal em situações sem internet.
- As operações pendentes devem ser mantidas em fila persistente para sincronização posterior.
- A sincronização deve ser retriada em momentos de conectividade restabelecida.

## 7. Requisitos de segurança e dados

- O repositório público não deve conter credenciais reais, segredos ou dados sensíveis.
- Nenhum dado real de clientes, produtos, vendas ou pagamentos deve ser incluído no GitHub.
- O código e a documentação devem evitar expor PINs, tokens, chaves ou informações sensíveis.
- O ambiente do navegador limita a proteção real de segredos; não deve ser tratado como ambiente de armazenamento seguro para segredos de servidor.

## 8. Requisitos de testes

Os testes serão planejados em uma etapa posterior e não serão implementados executáveis nesta fase. A documentação deve cobrir cenários críticos para uma etapa posterior de implementação, incluindo:
- persistência local;
- venda e baixa de estoque consistentes;
- bloqueio de vendas com caixa fechado;
- permissões de administrador e operador;
- pagamentos combinados;
- cancelamento autorizado;
- funcionamento offline;
- sincronização repetida sem duplicação;
- recuperação após falha;
- backup e restauração.

## 9. Decisões técnicas pendentes

- Ainda não foi definida a tecnologia exata da camada de integração externa com o Google Sheets.
- Alternativas a serem avaliadas no futuro:
  - backend próprio;
  - função serverless;
  - Google Apps Script.
- A escolha da alternativa mais adequada será feita com base em segurança, manutenção, confiabilidade e custo.

## 10. Entregáveis desta etapa

A documentação inicial deve registrar:
- objetivos e escopo;
- regras de negócio;
- arquitetura e separação de responsabilidades;
- segurança e limites de autenticação local;
- backup e sincronização;
- requisitos de integridade e operação offline.

