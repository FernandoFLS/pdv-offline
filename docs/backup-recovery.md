# Backup e recuperação

## 1. Objetivo

Garantir que o sistema possa recuperar seus dados e continuar operando com segurança após falhas locais, perda de dados, sincronização incompleta ou problemas no ambiente de execução.

## 2. Principais riscos

- falha de armazenamento local;
- perda de dados do navegador ou do dispositivo;
- interrupção de sincronização;
- inconsistência entre caixa, vendas e estoque;
- erro humano durante operação ou exportação.

## 3. Estratégia de backup

O sistema deve prever backup local para preservar o estado operacional do PDV.

### Formas esperadas de backup
- exportação manual de dados;
- backup periódico automático;
- snapshot do estado local em momentos críticos;
- backup de operações pendentes e fila de sincronização.

### O que deve ser preservado
- produtos;
- estoque;
- vendas;
- caixa e sessões;
- operações pendentes;
- log de auditoria;
- histórico de cancelamentos e ajustes.

## 4. Recuperação após falha

Em caso de falha, a recuperação deve respeitar a integridade do sistema e restaurar o último estado consistente conhecido.

### Procedimento esperado
1. identificar o último backup válido;
2. verificar integridade dos dados restaurados;
3. reconcilizar operações pendentes;
4. validar caixa, estoque e vendas após restauração;
5. proceder com reprocessamento apenas em estado auditável.

## 5. Reprocessamento e fila pendente

As operações pendentes devem ser separadas do estado operacional já concluído.

### Regras esperadas
- operações sincronizadas não devem ser reprocessadas indevidamente;
- operações pendentes devem manter identificadores únicos;
- falhas de reprocessamento devem ficar registradas;
- reprocessamento deve evitar duplicação de itens ou vendas.

## 6. Integridade de caixa e estoque

Backup e recuperação devem preservar a coerência entre:
- caixa aberto e fechado;
- vendas registradas;
- baixas de estoque;
- cancelamentos autorizados;
- movimentos de suprimento e sangria;
- auditoria de alterações.

A recuperação do sistema não deve mascarar divergências internas importantes.

## 7. Exportação e importação

O sistema deve prever exportação de dados para arquivo ou ambiente de recuperação, sem expor dados reais no repositório público.

Importante:
- exportação deve ocorrer de forma segura;
- arquivos de backup devem ser protegidos;
- dados sensíveis não devem ser expostos em logs ou arquivos de suporte.

## 8. Política de retenção

A estratégia de backup deve documentar:
- periodicidade;
- retenção do backup mais recente;
- retenção de backups históricos;
- critérios para descarte ou arquivamento.

## 9. Decisão em aberto

A forma exata de backup e recuperação será definida conforme o desenvolvimento do sistema e a estratégia de armazenamento local. Neste momento, o nível de exigência é manter a arquitetura preparada para backup local, restauração e auditoria sem comprometer a integridade operacional.
