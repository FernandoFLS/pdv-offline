# Cenários de testes documentados

## 1. Objetivo

Registrar cenários críticos de teste. Persistência, autenticação e fluxo base do caixa têm testes executáveis; outros cenários de negócio serão implementados junto com seus respectivos fluxos.

Os testes executáveis atuais usam Vitest e `fake-indexeddb` e cobrem persistência/migrações, autenticação local, sessão e movimentos manuais de caixa. Vendas, estoque, sincronização e backup continuam como referência para etapas futuras.

## 2. Cenários prioritários

### 2.1 Autenticação local (implementada)
- permitir o cadastro inicial de um único administrador;
- armazenar a derivação do PIN com salt individual, sem salvar o PIN em texto puro;
- validar PIN, papel e estado ativo do usuário;
- persistir tentativas e bloqueio progressivo entre recriações do serviço;
- limitar cadastro de operadores a administrador;
- listar usuários sem expor credenciais ou contadores de bloqueio;
- exigir autorização administrativa em cada operação de gerenciamento e revalidar o administrador no banco;
- cadastrar usuários com papéis válidos e auditar sem registrar PIN;
- editar nome/papel e impedir o rebaixamento do último administrador ativo;
- redefinir PIN, limpar bloqueios e invalidar sessões sem expor credenciais na auditoria;
- desativar/reativar contas sem apagar histórico, impedir auto desativação e preservar caixa e movimentos associados;
- excluir conta autenticável, arquivar somente identidade mínima e preservar sessões, movimentos e auditorias originais;
- impedir exclusão própria, bloquear operadores e manter um administrador ativo em exclusões concorrentes;
- abortar integralmente a exclusão se a gravação do arquivo ou da auditoria falhar;
- resolver nomes históricos por identidade arquivada e aplicar a migração 2→3 sem perda de dados;
- propagar invalidação direcionada de usuário entre abas sem encerrar a sessão de outro usuário;
- limpar sessão por logout ou inatividade sem fechar caixa aberto;
- propagar logout a outras abas do mesmo perfil;
- impedir que duas abas concluam simultaneamente o cadastro inicial.

### 2.2 Persistência local
- verificar que os dados principais são gravados corretamente em armazenamento local;
- validar consistência após reinicialização da aplicação;
- validar recuperação de dados em ambiente offline.

### 2.3 Sessão de caixa (implementada)
- validar abertura com centavos inteiros e rejeição de valores inválidos;
- impedir segunda abertura, inclusive em tentativas concorrentes;
- confirmar que estado, sessão, movimento e auditoria são gravados atomicamente;
- confirmar rollback completo quando uma gravação falha;
- calcular saldo esperado a partir de movimentos marcados como entrada ou saída;
- validar entradas/saídas positivas, motivo obrigatório, identidade/auditoria e ordenação da sequência;
- impedir saída acima do saldo e duplicação usando a chave idempotente única;
- validar rollback de lançamento e auditoria, e integração das entradas/saídas no fechamento;
- validar fechamento, diferença assinada, identidade do responsável e rejeição de fechamento repetido;
- verificar persistência após reabrir a conexão e que logout/inatividade não fechem o caixa.

### 2.4 Venda e baixa de estoque
- confirmar que a venda grava corretamente a operação local;
- validar que a baixa de estoque é coerente com a quantidade vendida;
- garantir que a operação não fique parcialmente salva.

### 2.5 Caixa fechado bloqueando venda
- verificar que a venda é bloqueada quando o caixa estiver fechado;
- garantir que a operação não seja registrada em estado inválido.

### 2.6 Permissões de administrador e operador
- validar acesso de administrador para ações restritas;
- validar restrições de operador em operações de desconto, cancelamento e ajustes.

### 2.7 Pagamentos combinados
- testar venda com pagamento em mais de uma forma;
- verificar total e cálculo correto;
- garantir consistência do registro do pagamento.

### 2.8 Cancelamento autorizado
- validar cancelamento com autorização adequada;
- garantir que a venda histórica não seja removida de forma irrestrita;
- verificar auditoria do cancelamento;
- confirmar que a reversão do caixa e do estoque seja coerente com a operação original.

### 2.9 Funcionamento offline
- simular ausência de conectividade;
- verificar que o sistema continua operando localmente;
- confirmar que as operações pendentes ficam registradas para sincronização posterior.

### 2.10 Sincronização repetida sem duplicação
- simular reprocessamento da mesma operação;
- validar idempotência;
- garantir que o sistema não duplica vendas, estoque ou registros de caixa.

### 2.11 Recuperação após falha de sincronização
- simular falha na integração externa;
- verificar que a operação local continua válida;
- validar a fila de pendências e o reprocessamento posterior.

### 2.12 Backup e restauração
- validar recuperação de backup local;
- verificar consistência entre vendas, caixa e estoque; 
- confirmar que a aplicação restaura dados sem perder o histórico de auditoria.

## 3. Fluxos financeiros e de estoque

A prioridade dos testes deve ser dada aos fluxos que envolvem dinheiro e estoque, pois são os mais críticos para integridade do sistema.

## 4. Observação sobre testes automatizados

A ferramenta inicial foi definida como Vitest com `fake-indexeddb`. Os fluxos de caixa, vendas, autorização de negócio, offline, sincronização e backup não são testes executáveis ainda, pois essas funcionalidades ainda não existem.
