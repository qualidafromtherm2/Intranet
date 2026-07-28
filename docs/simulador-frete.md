# Simulador de frete

## Objetivo e escopo

O módulo apoia o Comercial na montagem de um pré-romaneio e na comparação de transportadoras que atendem ao destino. A origem é fixa na Fromtherm (Rua Edgard Hoffmann, 699, Biguaçu/SC, CEP 88164-275) e o destino pode ser informado por CEP ou por cidade/UF.

Somente produtos ativos de `public.produtos_omie` com tipo fiscal `00` ou `04` participam. Peso, dimensões e identificação são sempre relidos do banco pelo servidor; valores enviados pelo navegador não são usados como fonte cadastral.

## Fluxo inicial

1. Informar CEP ou cidade/UF e o valor da mercadoria.
2. Pesquisar máquinas e mercadorias dos tipos fiscais permitidos.
3. Informar quantidades e revisar peso, volumes e cubagem.
4. Comparar apenas tabelas homologadas e ativas que tenham cobertura compatível.
5. Registrar a cotação, os itens e a memória de cálculo no schema `frete`.
6. Reabrir uma das últimas cotações do próprio usuário para ajustar destino, valor ou quantidades e simular novamente.

A UF possui pesquisa por sigla e a cidade é sugerida pelo catálogo oficial de municípios do IBGE. Cada sugestão informa se já existe cobertura de transportadora, sem impedir a seleção de um município ainda não atendido. A cidade continua aceitando digitação manual. O valor da mercadoria aceita formatos como `12.000,00`, `12000` e `12000,00` e é normalizado antes do cálculo.

## Modelo SQL

O arquivo `sql/20260728_create_frete_simulador.sql` cria o schema `frete` e as estruturas abaixo:

- `configuracao`: origem padrão e futuras configurações versionáveis;
- `municipio`: catálogo oficial de municípios e códigos IBGE usado no destino;
- `transportadora`: cadastro permanente da transportadora;
- `tabela_preco`: versão, vigência, status e fator de cubagem;
- `importacao` e `importacao_linha`: rastreabilidade do arquivo e preservação das linhas de origem;
- `cobertura`: CEP, município, UF, IBGE, prazo, frequência e taxas locais;
- `tarifa_faixa`: faixa de peso, preço base, excedente, mínimo, ad valorem, despacho e pedágio;
- `regra_adicional`: taxas condicionais com memória de cálculo;
- `cotacao`, `cotacao_item` e `cotacao_resultado`: histórico imutável da simulação e snapshots dos dados usados.

Cada nova planilha cria uma nova versão de tabela. Uma importação nunca sobrescreve silenciosamente a fonte anterior.

## Fontes recebidas em 28/07/2026

| Fonte | Linhas preservadas | Normalização inicial | Situação |
|---|---:|---|---|
| Expresso EJL — tabela | 41 | staging auditável | Em revisão |
| Expresso EJL — TDE | 54 | staging auditável | Em revisão |
| Fitlog | 473 | staging auditável | Em revisão |
| Bristot Rocha | 371 | 305 coberturas e 104 faixas | Em revisão |
| Mengue Express | 2.289 | 2.222 coberturas | Em revisão |
| Rodonaves XLSM | 7.835 | staging auditável | Em revisão |
| Rodonaves PDF atualizado | 103 | staging auditável | Em revisão |

Total: 11.166 linhas de fonte preservadas. Nenhuma tabela foi ativada automaticamente.

## Regras do motor

- cubagem do item: `altura_cm × largura_cm × profundidade_cm / 1.000.000`;
- peso cubado: `cubagem_m3 × fator_cubagem_da_tabela`;
- peso cobravel: maior valor entre peso real e peso cubado;
- a cobertura por uma faixa específica de CEP prevalece sobre cobertura genérica da cidade;
- frete mínimo, excedente por kg, ad valorem, despacho, pedágio por 100 kg, TDE e TRT são armazenados separadamente e exibidos na memória;
- dimensão maior que 500 cm é bloqueada como provável divergência de unidade;
- produtos sem todas as dimensões ou sem peso não podem ser simulados;
- tabela com status `em_revisao` nunca gera preço, mesmo que já possua cobertura ou faixa importada.

## Qualidade dos produtos

Na fotografia da base usada no desenvolvimento havia 106 produtos ativos dos tipos fiscais 00/04, sendo 57 aptos segundo as validações de peso, dimensões e limite de unidade. Sete cadastros da família FH240 possuíam altura `1000`, largura `92` e profundidade `92`, provável mistura de milímetros e centímetros. Esses registros permanecem bloqueados até correção cadastral.

## Importação

Prévia sem gravar:

```powershell
node scripts/importar_tabelas_frete.js --dir "C:\Users\Jair - Logística\Desktop\ANALISE TRANSPORTE\TABELAS"
```

Aplicação explícita:

```powershell
node scripts/importar_tabelas_frete.js --apply --dir "C:\Users\Jair - Logística\Desktop\ANALISE TRANSPORTE\TABELAS"
```

O importador calcula SHA-256, registra alertas, preserva a fonte e mantém a versão em revisão. Rodar novamente o mesmo arquivo não duplica a versão.

## Homologação antes de ativar preços

Ainda é necessário confirmar com o setor responsável:

- unidade oficial das dimensões cadastradas na Omie;
- política do valor declarado e quais componentes entram em ad valorem/GRIS;
- incidência de ICMS, pedágio, despacho, TDE, TRT, TAS, dificuldade de acesso e outras generalidades por transportadora;
- vínculo exato entre regiões de preço e cidades da Fitlog, EJL e Mengue;
- regras da Rodonaves atualizadas pelo PDF, especialmente taxas por cidade e zonas;
- pelo menos três cotações conhecidas por transportadora para conferência do valor e prazo.

Somente depois dessa conferência a versão correta deve mudar de `em_revisao` para `ativa`. Até lá, a interface identifica a transportadora, mas informa que ela não participa da comparação.

### Ordem recomendada de homologação

1. **Bristot Rocha**: faixas e coberturas já normalizadas; falta confirmar a chave final entre classificação da cidade e tarifa e comparar cotações conhecidas.
2. **Mengue Express**: cobertura extensa já importada; falta consolidar o vínculo entre cidade, sigla de praça e tarifas.
3. **Fitlog**: precisa definir a aba de saída oficial e congelar os resultados das fórmulas cruzadas antes da normalização.
4. **Expresso EJL**: tabela simples, mas precisa confirmar a fórmula comercial e as chaves geográficas.
5. **Rodonaves**: o PDF confirma cubagem, frete valor, TAS, GRIS, pedágio e várias taxas; permanecem pendentes a exceção de Camboriú, listas completas de CEP e prazos.

## Acesso e navegação

A navegação `side:log:simulador-frete` é liberada para usuários ativos dos setores Logística (`sector_id = 4`), Comercial (`sector_id = 10`) e administradores. Toda rota `/api/frete/*` repete a autorização no servidor.

O histórico recente é individual: a API lista e reabre apenas cotações vinculadas ao usuário autenticado. Os dados cadastrais dos produtos são relidos da base atual ao reabrir, preservando a quantidade da cotação original.

## Validação executada

- testes unitários do romaneio, unidade, cobertura, peso cubado, excedente e adicionais;
- sintaxe dos arquivos JavaScript;
- carga real das sete fontes no SQL, todas em revisão;
- busca e seleção de produto real, consulta de CEP e simulação controlada;
- 1920×1080, 1366×768, tablet 768×1024 e celular 390×844 sem overflow horizontal;
- confirmação de que tabelas não homologadas não geram preço.
