# Resumo Executivo da Conversa

## Tema
Padronização para salvar histórico de conversas com IA em pasta específica do projeto, com foco em retomada futura.

## Objetivo
Definir um processo simples e reutilizável para encerrar cada conversa gerando um resumo útil, organizado por tema, para continuidade do trabalho em sessões futuras.

## Contexto inicial
O usuário queria saber se era possível guardar conversas por assunto em uma pasta local e depois evoluiu para um fluxo padronizado de encerramento, incluindo criação automática de pastas e geração de arquivo de resumo.

## O que foi decidido
- Não há salvamento automático nativo da conversa inteira em pasta local sem ação explícita.
- O fluxo mais confiável é salvar um resumo estruturado ao final de cada sessão.
- A estrutura de pastas padrão deve ser:
  - `Historico de conversar IA/`
  - `Instrução para guardar conversas com a IA/`
  - `Primeira orientação/`
- O nome do arquivo deve seguir o padrão `AAAA-MM-DD_HH-mm_resumo_conversa.md`.
- O conteúdo deve priorizar continuidade: decisões, pendências e próximos passos.

## O que foi implementado
- Foi criado um prompt padrão de encerramento para ser reutilizado ao fim das conversas.
- Foi executado um teste real de gravação do histórico conforme o padrão solicitado.
- A estrutura de pastas foi criada (caso inexistente) e o arquivo de resumo foi salvo no caminho definido.

## Pendências
- Definir se o histórico deverá sempre registrar também “responsável”, “módulo” e “status”.
- Definir se, além do resumo, haverá salvamento da transcrição completa em arquivo separado.

## Próximos passos (ordem de execução)
1. Reutilizar o prompt padrão no encerramento de toda conversa relevante.
2. Validar se o formato atual do resumo está suficiente para retomada rápida.
3. Opcional: criar versão 2 do prompt com placeholders (projeto, módulo, responsável, prioridade).
4. Opcional: criar um `README.md` índice nessa pasta para listar todos os resumos.

## Prompt de retomada (pronto para copiar e colar)
Continue o trabalho do tema “histórico de conversas com IA” usando como base o último resumo salvo na pasta `Historico de conversar IA/Instrução para guardar conversas com a IA/Primeira orientação/`. Considere as decisões já tomadas, execute primeiro as pendências em aberto e proponha próximos passos objetivos para evolução do processo.

## Como retomar na próxima conversa
Cole o “Prompt de retomada” acima e informe o nome do arquivo de resumo mais recente para continuidade direta do contexto.
