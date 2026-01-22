-- Tabela para configuração de agendamento automático de sincronização
CREATE TABLE IF NOT EXISTS public.agendamento_sincronizacao (
  id SERIAL PRIMARY KEY,
  ativo BOOLEAN DEFAULT false,
  dias_semana INTEGER[] DEFAULT '{}', -- 0=Domingo, 1=Segunda, ..., 6=Sábado
  horario TIME NOT NULL DEFAULT '09:00:00',
  ultima_execucao TIMESTAMP,
  proxima_execucao TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inserir configuração padrão
INSERT INTO public.agendamento_sincronizacao (ativo, dias_semana, horario)
VALUES (false, ARRAY[1, 5], '09:00:00')
ON CONFLICT DO NOTHING;

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_agendamento_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
DROP TRIGGER IF EXISTS trigger_agendamento_updated_at ON public.agendamento_sincronizacao;
CREATE TRIGGER trigger_agendamento_updated_at
BEFORE UPDATE ON public.agendamento_sincronizacao
FOR EACH ROW
EXECUTE FUNCTION update_agendamento_updated_at();
