# Arquitetura do projeto

## 1. Visão geral

O sistema será uma aplicação web em formato PWA para uso local em um ambiente de PDV. Sua arquitetura deve permitir operação offline e sincronização eventual, preservando integridade de vendas, caixa e estoque.

A estrutura do projeto será organizada em camadas conceituais para facilitar evolução incremental sem criar dependências excessivas entre interface, regras de negócio e persistência.

## 2. Camadas propostas

### 2.1 Camada de apresentação

Responsável pela interface da aplicação, incluindo telas de login, caixa, produtos, vendas e relatórios.

Objetivo:
- disponibilizar a experiência do usuário;
- operar localmente em navegador;
- permitir uso em modo offline quando a aplicação estiver instalada como PWA.

### 2.2 Camada de domínio

Responsável pelas regras de negócio independentes da interface e da persistência.

Exemplos de regras:
- venda só pode ser registrada com caixa aberto;
- cancelamento exige autorização adequada;
- pagamento combinado precisa ser validado;
- estoque deve refletir baixa coerente com a operação;
- identificadores únicos devem ser preservados;
- ações sensíveis devem gerar auditoria.

A camada de domínio deve ser independente da UI e da tecnologia de persistência.

### 2.3 Camada de persistência local

Responsável por manter os dados operacionais no dispositivo local.

Premissa:
- IndexedDB será a base operacional local.
- Não deve ser substituído por armazenamento em memória ou dados voláteis.

Conteúdo esperado:
- produtos;
- estoque;
- vendas;
- sessões de caixa;
- operações pendentes;
- histórico de auditoria;
- backups locais.

### 2.4 Camada de sincronização

Responsável por processar operações pendentes e sincronizar dados externos com uma integração segura.

Requisitos:
- fila persistente;
- idempotência;
- retry após falha;
- reprocessamento seguro;
- controle de duplicações;
- rastreio da operação original e do status atual.

A sincronização deve ser tratada como processo eventual e não como parte do fluxo operacional principal que depende de internet constante.

## 3. Separação de responsabilidades

### `src/core`

A camada `core` deve concentrar infraestrutura e mecanismos transversais, tais como:
- persistência local;
- sincronização;
- conectividade;
- logs sanitizados;
- utilidades gerais;
- sessão e autorização estrutural;
- backup e recuperação.

Ela é responsável por ferramentas e mecanismos, não por regras específicas de negócios da operação do PDV.

### `src/features`

A camada `features` deve organizar casos de uso do negócio, como:
- autenticação;
- caixa;
- produtos;
- estoque;
- vendas;
- relatórios;
- operação offline;
- integração externa.

As regras de negócio mais específicas devem estar centralizadas dentro da feature correspondente, mas sempre usando as abstrações da camada `core` e da camada de domínio.

## 4. Dados locais, sincronizados e pendentes

A arquitetura deve manter a diferenciação entre:

- dados locais operacionais: registrados e validados no dispositivo;
- dados sincronizados: já aceitos pela integração externa ou processados pela camada de sincronização;
- operações pendentes: aguardando reprocessamento ou sincronização após recuperação da conectividade.

Essa separação é essencial para:
- evitar perda de dados em ambiente offline;
- manter rastreabilidade;
- reduzir erros de duplicação;
- facilitar diagnósticos e recuperação.

## 5. Operação offline e sincronização eventual

A aplicação deve registrar vendas e alterações locais antes de tentar sincronizar com a camada externa.

Fluxo esperado:
1. Usuário realiza operação no PDV.
2. A operação é validada localmente.
3. A operação é persistida no IndexedDB.
4. Se houver conectividade, a operação entra na fila de sincronização.
5. Se não houver conectividade, ela permanece pendente.
6. Quando a rede voltar, a fila é reprocessada com retry e auditoria.

Importante: a sincronização nunca deve ser tratada como a única forma de confirmar a operação local.

## 6. Segurança e autenticação

### 6.1 PIN e autenticação de interface

O login por PIN deve ser tratado como autenticação de interface. Ele ajuda a identificar o operador e controlar o ambiente de uso, mas não substitui a proteção real de dados nem garante segurança forte em ambiente de navegador.

### 6.2 Autorização e regras de negócio

Autorização deve ser definida em regras de negócio, por exemplo:
- administrador pode aplicar descontos;
- operador não pode cancelar venda sem autorização;
- caixa fechado bloqueia abertura de venda;
- ações sensíveis devem exigir reautenticação ou nível de privilégios.

### 6.3 Limitação de segurança em navegador

No navegador, o ambiente local não deve ser considerado um "servidor seguro". Isso significa que:
- segredos não devem ser guardados em frontend como se fossem seguros;
- PINs não devem ser salvos em texto puro;
- dados locais devem ser tratados como sensíveis;
- logs e exportações devem evitar expor informações confidenciais.

## 7. Integridade do caixa e do estoque

A arquitetura deve priorizar o fluxo financeiro e de estoque antes de qualquer funcionalidade secundária.

Exemplos:
- uma venda só deve ser confirmada se o fluxo local for consistente;
- a baixa de estoque precisa estar alinhada com a venda;
- cancelamento deve manter histórico e auditoria;
- caixa deve ter um único estado aberto por vez;
- fechamento deve ser consistente com o fechamento da sessão.

### Regras para cancelamento e auditoria

O cancelamento de uma venda não significa sua exclusão. A venda original deve permanecer registrada no histórico, preservando a referência completa do evento original, com auditoria do cancelamento e movimentações compensatórias coerentes para caixa e estoque.

A arquitetura deve tratar o cancelamento como uma reversão controlada e rastreável, e não como remoção física do registro. Isso garante a integridade dos dados financeiros e do estoque.

## 8. Google Sheets e integração externa

O Google Sheets será tratado como uma integração externa futura, e não como banco operacional principal nem como fonte de verdade exclusiva.

Decisão técnica em aberto:
- ainda não foi escolhida a forma exata da integração;
- opções futuras a avaliar: backend próprio, função serverless ou Google Apps Script;
- a escolha dependerá de segurança, manutenção, confiabilidade e custo.

A arquitetura atual foi pensada para permitir essa troca sem comprometer a base local do sistema.

## 9. Backup e recuperação

O sistema deve prever:
- exportação de dados locais;
- backup periódico ou manual;
- recuperação após falha do dispositivo ou do navegador;
- restauração de caixa e inventário;
- reprocessamento de operações pendentes.

A recuperação deve preservar a possibilidade de verificar a consistência entre caixa, vendas e estoque.

## 10. Decisões e pendências

As seguintes decisões continuam pendentes e devem ser avaliadas em momento adequado:
- escolha da tecnologia da camada externa de sincronização;
- definição da ferramenta de testes automatizados;
- definição da ferramenta de build e do ambiente de desenvolvimento;
- avaliação da necessidade de backend intermediário.

Até que essas decisões sejam tomadas, a arquitetura foi mantida em nível conceitual e modular, preservando flexibilidade para evolução.
