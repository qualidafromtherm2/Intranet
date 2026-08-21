# Design: Parada + tempo congelado no Relatório Gerencial de Produção

**Data:** 2026-08-20  
**Status:** Aprovado em brainstorming (aguardando revisão do spec pelo usuário)  
**Escopo:** fluxo sequencial Posto → RI → próximo posto; congelamento de tempos; integração de paradas no relatório

---

## 1. Problema

O Relatório Gerencial de Produção mostra tempos úteis por posto/RI/OP, mas:

1. **Paradas** (`producao."Paradas"`) não entram no relatório — não há como ver se uma OP parou nem o reflexo no tempo total.
2. Os tempos são **recalculados** a cada abertura do relatório a partir de início/fim + padrão de turno do dia. Alterar o “Padrão de turno” (ex.: almoço de 1h para 2h) pode mudar horas de OPs já finalizadas.
3. O fluxo atual inicia **posto e RI juntos** na entrada no posto. O padrão desejado é **sequencial**: finalizar posto → contar RI → ao fechar RI iniciar o próximo posto.

---

## 2. Objetivos

1. Contar e **congelar** tempos só ao finalizar a operação (posto) ou a inspeção (RI).
2. Desconsiderar intervalos do Padrão de turno (café/refeição) no tempo útil.
3. Registrar e exibir **parada** como fatia do tempo bruto (barra empilhada: parada + líquido = bruto).
4. Cruzar parada com ciclo de posto por **sobreposição de horário**.
5. Parada ainda aberta: **alerta + duração parcial** (com aviso).
6. Relatório: indicadores nas páginas atuais **e** página dedicada **Paradas**.
7. Mudar o processo de chão de fábrica para o fluxo sequencial Hermética → RI → Elétrica (etc.).

---

## 3. Fluxo de processo (padrão a seguir)

Exemplo:

1. **Montagem hermética** — início do registro `posto` até **Finalizar operação**.
2. No instante da finalização:
   - calcula e **grava** tempos do posto (bruto / parada / líquido + snapshot do turno);
   - **abre** o registro `ri` (não antes).
3. **RI** — do fechamento do posto até **finalizar o registro de inspeção**.
4. No instante do fechamento da RI:
   - congela tempo da RI;
   - **inicia automaticamente** o registro `posto` do próximo posto (ex.: Montagem elétrica), como se o usuário tivesse entrado nesse posto.

Paradas podem ser abertas/fechadas enquanto o posto está em andamento (modal existente “Registrar parada”).

### O que já existe vs o que muda

Hoje (`finalizar-operacao` + liberação em `routes/qualidadeRiCheck.js`) já:

- finaliza o posto e marca a OP como aguardando RI (sem avançar kanban);
- na liberação da RI, calcula `proximoPosto` e chama `iniciarCicloPosto` no próximo posto.

Ajustes necessários para bater com o padrão:

| Momento | Hoje | Novo |
|---------|------|------|
| Entrada / início de posto (`iniciarCicloPosto`) | Abre `posto` + `ri` juntos | Abre **só** `posto` |
| Finalizar operação | Encerra ciclo do posto; **não** abre registro `ri` com início = agora | Fecha `posto`, **congela**, **abre** registro `ri` (início = instante do finalizar) |
| Finalizar inspeção (RI) | `registrarRiConcluida` fecha `ri` e abre `trabalho`; depois inicia próximo posto | Fecha `ri`, **congela**; **não** abre `trabalho`; inicia próximo posto só com `posto` |
| Próximo posto | Já vem de `proximoPosto` na liberação da RI | Manter essa fonte; se não houver próximo (ex.: Inspeção final → estoque), não abre posto |

Tipo `trabalho`: registros antigos continuam legíveis no relatório; novos ciclos sequenciais não precisam criar `trabalho`.

---

## 4. Modelo de dados

### 4.1 `producao."Registro_tempo"` — novas colunas

| Coluna | Tipo | Uso |
|--------|------|-----|
| `tempo_util_ms` | BIGINT NULL | Bruto útil (abre→fecha, sem café/refeição) |
| `tempo_parada_ms` | BIGINT NULL | Soma das paradas sobrepostas (em ms úteis) |
| `tempo_liquido_ms` | BIGINT NULL | `tempo_util_ms - tempo_parada_ms` (≥ 0) |
| `turno_snapshot` | JSONB NULL | Cópia do(s) turno(s) usados no cálculo |
| `parada_parcial` | BOOLEAN NOT NULL DEFAULT FALSE | True se havia parada aberta no fechamento |
| `congelado_em` | TIMESTAMPTZ NULL | Momento em que o snapshot foi gravado |

Registros abertos (`fim IS NULL`) permanecem sem esses campos preenchidos.  
O relatório **só usa valores congelados** para ciclos fechados; nunca recalcula a partir do turno atual se `tempo_util_ms` estiver preenchido.

### 4.2 `producao."Paradas"`

Sem mudança de schema obrigatória nesta entrega. Uso:

- `parada_inicio` / `parada_fim` (NULL = aberta)
- `numero_op` / `kanban_programacao_id`
- `tipo_parada` / `motivo` / `operacao`

Atribuição ao ciclo: **interseção do intervalo da parada com `[inicio, fim]` do `Registro_tempo` do tipo `posto`**, convertida em ms úteis com o mesmo turno do snapshot (ou turno do dia no backfill).

### 4.3 Backfill

Para registros já fechados com `tempo_util_ms IS NULL`:

1. Na primeira carga do relatório do período (ou script único de migração), calcular uma vez com o `Turno_dia` da época do registro;
2. Gravar as colunas de congelamento;
3. Daí em diante o valor não muda.

---

## 5. Regras de cálculo

1. **Bruto útil** = `calcularTempoUtilMs(inicio, fim, turnos)` (já existe em `utils/tempoProducao.js`), usando o turno vigente **no momento do fechamento** (e guardado em `turno_snapshot`).
2. **Parada útil** = para cada parada da OP que intersecta `[inicio, fim]`, calcular ms úteis da interseção; se `parada_fim` for NULL, usar `NOW()` e marcar `parada_parcial`.
3. **Líquido** = max(0, bruto − parada).
4. **MO (mão de obra):** manter a regra atual de divisão por quantidade de pessoas sobre o tempo de posto **bruto**, como hoje. Parada e líquido no relatório são em horas úteis de relógio (turno), **sem** divisão por MO nesta entrega.
5. Mudança posterior no Padrão de turno / `Turno_dia` **não** altera linhas com `congelado_em` preenchido.

---

## 6. API

### 6.1 Fechamento (processo)

Pontos existentes a ajustar:

- `POST /api/producao/finalizar-operacao` (`routes/producao.js`): após encerrar o `posto`, chamar `congelarRegistroTempo` e **abrir** `iniciarRegistroTempo(..., tipoRegistro: 'ri')` no mesmo posto (início da contagem de RI).
- Liberação da inspeção em `routes/qualidadeRiCheck.js`: substituir o efeito de `registrarRiConcluida` (que hoje abre `trabalho`) por encerrar + congelar `ri`; em seguida, se houver `proximoPosto`, iniciar **apenas** `posto` nesse posto (via `iniciarRegistroTempo` ou `iniciarCicloPosto` já corrigido).
- `iniciarCicloPosto` em `utils/tempoProducao.js`: deixar de abrir `ri` em paralelo.

Função nova: `congelarRegistroTempo(registroId)` em `utils/tempoProducao.js` (calcula bruto/parada/líquido + `turno_snapshot`).

Se não houver próximo posto (Inspeção final → Finalizado/estoque), não abre novo `posto`.

### 6.2 Relatório

`GET /producao/relatorio-gerencial` (`routes/producaoRelatorio.js`):

- Preferir `tempo_util_ms` / `tempo_parada_ms` / `tempo_liquido_ms` quando preenchidos.
- KPIs novos: `ops_com_parada`, `horas_parada`, `pct_parada`, `paradas_abertas`.
- Em `por_posto`, `ciclos_por_op`, `detalhe_postos`: campos `h_bruto`, `h_parada`, `h_liquido`, `teve_parada`, `parada_parcial`.
- Bloco novo `paradas`: lista no período (OP, posto inferido por overlap, tipo, motivo, início, fim, duração, aberta?).
- Agregados por tipo/motivo para a página Paradas.

---

## 7. Front do relatório

Arquivo: `public/js/producao-relatorio-gerencial.js` (+ CSS existente do layout AT/relatórios).

### 7.1 Páginas existentes

- **Dashboard:** KPIs de parada; gráfico de tempo por posto em **barra empilhada** (parada + líquido).
- **Tempo por Posto / Ciclo por OP / Detalhe:** colunas bruto · parada · líquido; badge “teve parada” / “parada aberta”.
- **Plano / Conclusão:** textos padrão passam a citar paradas quando houver dados.

### 7.2 Nova página

- Nav: **Paradas** (inserir após “Detalhe dos Ciclos” ou “Tempo por Posto”).
- Conteúdo: KPIs; tabela de paradas; resumo por tipo/motivo; destaque de abertas.

### 7.3 Visual da barra

Uma única barra = bruto; dentro dela segmentos **parada** (vermelho) e **líquido** (teal), não cards lado a lado.

---

## 8. Arquivos principais

| Arquivo | Mudança |
|---------|---------|
| `utils/tempoProducao.js` | Schema novos campos; `congelarRegistroTempo`; alterar `iniciarCicloPosto` / fluxo RI / próximo posto |
| `utils/paradasProducao.js` | Helpers de overlap + ms úteis no intervalo (se fizer sentido extrair) |
| `routes/producao.js` | Wire do fluxo finalizar posto → RI → próximo posto |
| `routes/producaoRelatorio.js` | Consumir congelados + bloco paradas + KPIs |
| `public/js/producao-relatorio-gerencial.js` | UI KPIs, barras, página Paradas |
| `menu_produto.js` / CSS | Só se o fluxo de finalizar/RI no kanban precisar de ajuste de UX |

---

## 9. Fora de escopo (fase posterior)

- Recalcular ou “corrigir” tempos já congelados via tela admin.
- Dividir tempo de parada por MO.
- Relatórios PDF exportando a nova página (seguir o mesmo padrão dos outros módulos se já existir export; senão, só tela nesta entrega).
- Alterar o modal “Registrar parada” (já existe).

---

## 10. Critérios de aceite

1. Finalizar Montagem hermética grava tempos do posto e inicia RI; finalizar inspeção fecha RI e inicia Montagem elétrica sem ação extra de “entrar no posto”.
2. Alterar Padrão de turno depois **não** muda `tempo_util_ms` de registros já congelados.
3. Relatório mostra bruto/parada/líquido e barra empilhada; OPs com parada identificáveis.
4. Página Paradas lista eventos do período com tipo/motivo.
5. Parada aberta aparece com aviso e entra na duração parcial.
6. `node --check` nas rotas/utils alterados; F5 valida o relatório na tela.

---

## 11. Decisões fechadas no brainstorming

- Tempos: bruto + parada + líquido, visual em **barra empilhada**.
- Relatório: indicadores nas páginas atuais **+** página Paradas.
- Atribuição da parada: **sobreposição de horário** com o ciclo.
- Parada aberta: alerta + duração parcial.
- Congelar tempo **nesta mesma entrega**.
- Fluxo sequencial Posto → RI → próximo posto (**mudança de processo**, não só relatório).
