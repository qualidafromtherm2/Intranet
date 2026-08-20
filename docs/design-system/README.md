# Thermo Design System

Esta pasta reúne a identidade visual e o design system aprovados para a evolução da Intranet para **Thermo - Sistema de Gestão**.

O material aqui documentado é a referência oficial para planejamento, desenvolvimento, revisão visual e migração progressiva das telas do sistema.

## Por onde começar

1. Leia [`brand-spec.md`](./brand-spec.md) para conhecer as regras essenciais da marca e os tokens principais.
2. Consulte o [`Manual de Identidade Visual`](./manual/Manual_de_Identidade_Visual_Thermo.pdf) para aplicações do logotipo, cores, tipografia, grafismos e usos incorretos.
3. Abra [`thermo-design-system.html`](./reference/thermo-design-system.html) no navegador para consultar componentes, navegação, estados, responsividade e acessibilidade.
4. Abra [`thermo-app-5telas-reference.html`](./reference/thermo-app-5telas-reference.html) para visualizar a aplicação da identidade em cinco telas de referência.
5. Utilize os arquivos em [`assets/`](./assets/) nas interfaces e materiais, respeitando as regras do manual.

## Estrutura

```text
design-system/
|-- README.md
|-- brand-spec.md
|-- assets/
|   |-- thermo-app-icon.png
|   |-- thermo-logo-fundo-escuro.png
|   |-- thermo-logo-principal.png
|   |-- thermo-pilar-controle.png
|   |-- thermo-pilar-gestao.png
|   |-- thermo-pilar-integracao.png
|   `-- thermo-simbolo.png
|-- manual/
|   |-- Manual_de_Identidade_Visual_Thermo.pdf
|   `-- Manual_de_Identidade_Visual_Thermo.pptx
`-- reference/
    |-- thermo-app-5telas-reference.html
    `-- thermo-design-system.html
```

## Fontes oficiais

- Interface, títulos e textos: **Inter**.
- Códigos, IDs e números técnicos: **IBM Plex Mono**.
- Pesos recomendados: 400, 500 e 600.

## Cores principais

- Azul navy: `#0B1D34`.
- Vermelho: `#E31837`.
- Branco: `#FFFFFF`.
- Cinza claro: `#E6E8EB`.

O vermelho deve ser usado com moderação, principalmente na marca, em alertas críticos e em ações que exigem atenção.

## Regras para implementação

- Trate a aplicação atual como um ERP em produção: preserve regras de negócio, permissões, integrações e contratos do backend.
- Não copie o HTML de referência diretamente para produção. Extraia tokens e implemente componentes reutilizáveis.
- A migração deve ser progressiva, por tela ou fluxo, mantendo o sistema utilizável durante todo o processo.
- Novos componentes não devem criar cores, sombras, raios, fontes ou padrões paralelos sem atualizar esta documentação.
- Priorize interfaces densas, claras, previsíveis e adequadas ao uso operacional diário.
- Desenvolva com comportamento responsivo para celular, tablet, notebook e desktop.
- Use ícones lineares da biblioteca Lucide, conforme especificado no design system.
- O tema inicialmente aprovado é exclusivamente claro.

## Hierarquia em caso de divergência

1. Decisões registradas posteriormente e aprovadas pelo responsável do projeto.
2. Manual de Identidade Visual.
3. `brand-spec.md`.
4. Design system HTML.
5. Implementações existentes no sistema legado.

Ao encontrar uma divergência, não invente uma solução local. Registre a decisão e atualize a documentação oficial.

## Orientação para agentes e colaboradores

Antes de planejar ou implementar qualquer redesign, leia completamente este arquivo, o `brand-spec.md` e as seções relevantes do manual e do design system HTML.

O objetivo não é redesenhar cada tela de forma isolada. É aplicar a mesma identidade Thermo por meio de tokens, componentes e padrões compartilhados, sem alterar inadvertidamente o funcionamento do ERP.

## Pendência de ativos

Os ativos atuais estão disponíveis em PNG. Antes da aplicação definitiva da marca no produto, devem ser adicionadas versões vetoriais em SVG do logotipo principal, símbolo isolado e versão para fundo escuro, além dos tamanhos finais de favicon e ícone instalável.
