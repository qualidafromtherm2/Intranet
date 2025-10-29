-- Criar tabela public.controle_tecnicos
CREATE TABLE IF NOT EXISTS public.controle_tecnicos (
    nome text,
    cnpj_cpf text,
    endereco text,
    municipio text,
    uf text,
    cep text,
    celular text,
    tipo text,
    qtd_atend_ult_1_ano text,
    tempo_medio text
);
