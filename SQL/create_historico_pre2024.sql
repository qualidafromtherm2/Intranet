CREATE TABLE IF NOT EXISTS public.historico_pre2024 (
    pedido                     text,
    nome_fantasia_revende      text,
    razao_social_faturamento   text,
    ano                        integer,
    mes_referencia             text,
    data_entrada_pedido        date,
    data_aprovacao_pedido      date,
    numero_op_informacoes      text,
    data_op                    date,
    data_prevista_entrega      date,
    quantidade                 numeric,
    modelo                     text,
    control                    text,
    tipo_quadro                text,
    esq_esf                    text,
    situacao                   text,
    transportadora             text,
    nfe                        text,
    numero_ordem_coleta        text,
    mes_faturamento            text,
    forma_pgto                 text,
    data_entrega               date,
    cond_pagto                 text,
    data_pagto                 date,
    valor                      numeric,
    uf                         text,
    representante              text,
    observacoes                text,
    os                         text,
    formula_regexextract       text,
    formula_switch             text,
    ft_ou_fh                   text,
    data_entrega_dashboard     date,
    data_entrada_pedido_alt    date,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historico_pre2024_pedido
    ON public.historico_pre2024 (pedido);

CREATE INDEX IF NOT EXISTS idx_historico_pre2024_modelo
    ON public.historico_pre2024 (modelo);
