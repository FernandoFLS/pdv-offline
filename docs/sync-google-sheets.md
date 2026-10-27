# Integração com Google Sheets

## 1. Objetivo

Documentar a integração externa do PDV com o Google Sheets como canal futuro de sincronização e exportação, sem assumir ainda uma decisão técnica definitiva.

## 2. Premissa

O Google Sheets será considerado uma integração externa, e não uma fonte primária de verdade do sistema.

A base operacional local do PDV será o IndexedDB. A sincronização externa será um processo posterior, eventual e orientado por fila.

## 3. Limites da integração externa

O Google Sheets não é um banco transacional robusto e não resolve automaticamente:
- conflitos de dados;
- exclusões lógicas com auditoria;
- idempotência do reprocessamento;
- consistência entre caixa, estoque e vendas.

Por isso, ele deve ser tratado como canal de sincronização e exportação, e não como solução única para integridade do sistema.

## 4. Requisitos para a sincronização

A sincronização futura deve manter:
- fila persistente;
- identificadores únicos por operação;
- idempotência;
- retry em caso de falha;
- prevenção de duplicação;
- registro de status da sincronização;
- rastreio de erro e reprocessamento.

## 5. Decisão técnica pendente

Ainda não foi escolhida a tecnologia exata da camada de integração.

As opções a serem avaliadas no futuro incluem:
- backend próprio;
- função serverless;
- Google Apps Script.

A escolha será feita com base em:
- segurança;
- manutenção;
- confiabilidade;
- custo;
- facilidade de monitoramento;
- necessidade de autenticação segura.

## 6. Segurança na integração externa

Não serão incluídas credenciais reais nesta documentação.

A integração externa deve respeitar as seguintes regras:
- o segredo não deve ficar em frontend;
- acesso ao serviço deve ser feito por uma camada segura;
- credenciais e tokens devem ser protegidos de forma adequada;
- o navegador não deve ser usado como ambiente de armazenamento de segredos de servidor.

## 7. Modelo de operação previsto

A operação recomendada, quando a integração for implementada, deve seguir um padrão de separação:

- frontend local: gerencia a operação do PDV;
- camada local: persiste dados e fila de pendências;
- integração externa: processa sincronização;
- camada segura: recebe, valida e encaminha os dados para o Google Sheets ou para a infraestrutura escolhida.

Essa separação reduz riscos e permite manter a operação local funcional mesmo quando a integração externa falha.

## 8. Estratégia de recuperação em integração

Em caso de falha de sincronização, o sistema deve:
- manter a operação em fila;
- preservar a identificação original;
- tentar reprocessar em novo ciclo;
- registrar o erro sem destruir a operação local;
- não duplicar registros em reprocessamentos.

## 9. Decisão de arquitetura

A arquitetura atual foi definida de forma a permitir essa integração sem comprometer a estabilidade do sistema local. Enquanto a tecnologia da integração externa não for escolhida, a documentação manterá essa decisão como pendente e a integração como uma etapa posterior ao desenvolvimento local do PDV.
