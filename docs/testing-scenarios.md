# Cenários de testes documentados

## 1. Objetivo

Registrar cenários críticos de teste que serão implementados em uma etapa posterior, em linguagem executável ou com ferramenta de testes escolhida no momento adequado.

Esta etapa não cria testes automatizados executáveis. O conteúdo aqui serve como documentação de cenário e referência para a próxima fase de implementação.

## 2. Cenários prioritários

### 2.1 Persistência local
- verificar que os dados principais são gravados corretamente em armazenamento local;
- validar consistência após reinicialização da aplicação;
- validar recuperação de dados em ambiente offline.

### 2.2 Venda e baixa de estoque
- confirmar que a venda grava corretamente a operação local;
- validar que a baixa de estoque é coerente com a quantidade vendida;
- garantir que a operação não fique parcialmente salva.

### 2.3 Caixa fechado bloqueando venda
- verificar que a venda é bloqueada quando o caixa estiver fechado;
- garantir que a operação não seja registrada em estado inválido.

### 2.4 Permissões de administrador e operador
- validar acesso de administrador para ações restritas;
- validar restrições de operador em operações de desconto, cancelamento e ajustes.

### 2.5 Pagamentos combinados
- testar venda com pagamento em mais de uma forma;
- verificar total e cálculo correto;
- garantir consistência do registro do pagamento.

### 2.6 Cancelamento autorizado
- validar cancelamento com autorização adequada;
- garantir que a venda histórica não seja removida de forma irrestrita;
- verificar auditoria do cancelamento;
- confirmar que a reversão do caixa e do estoque seja coerente com a operação original.

### 2.7 Funcionamento offline
- simular ausência de conectividade;
- verificar que o sistema continua operando localmente;
- confirmar que as operações pendentes ficam registradas para sincronização posterior.

### 2.8 Sincronização repetida sem duplicação
- simular reprocessamento da mesma operação;
- validar idempotência;
- garantir que o sistema não duplica vendas, estoque ou registros de caixa.

### 2.9 Recuperação após falha de sincronização
- simular falha na integração externa;
- verificar que a operação local continua válida;
- validar a fila de pendências e o reprocessamento posterior.

### 2.10 Backup e restauração
- validar recuperação de backup local;
- verificar consistência entre vendas, caixa e estoque; 
- confirmar que a aplicação restaura dados sem perder o histórico de auditoria.

## 3. Fluxos financeiros e de estoque

A prioridade dos testes deve ser dada aos fluxos que envolvem dinheiro e estoque, pois são os mais críticos para integridade do sistema.

## 4. Observação sobre testes automatizados

A escolha da ferramenta de testes automatizados será feita em uma etapa posterior ao planejamento inicial. Neste momento, os cenários acima são registrados como documentação de requisitos de validação, não como testes executáveis.
