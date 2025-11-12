-- Adiciona a coluna que referencia o ID Omie (public.produtos_omie.codigo_produto)
ALTER TABLE "OrdemProducao".tab_op
  ADD COLUMN IF NOT EXISTS codigo_produto_id bigint;

-- Preenche a nova coluna com os IDs já conhecidos a partir do código textual
UPDATE "OrdemProducao".tab_op op
   SET codigo_produto_id = po.codigo_produto
  FROM public.produtos_omie po
 WHERE op.codigo_produto_id IS NULL
   AND (
         TRIM(UPPER(po.codigo)) = TRIM(UPPER(op.codigo_produto))
      OR TRIM(UPPER(po.codigo_produto_integracao::text)) = TRIM(UPPER(op.codigo_produto))
       );

-- Garante um índice para buscas futuras por codigo_produto_id
CREATE INDEX IF NOT EXISTS tab_op_codigo_produto_id_idx
    ON "OrdemProducao".tab_op (codigo_produto_id);

-- Cria (se ainda não existir) a foreign key com produtos_omie
DO $$
BEGIN
  IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = 'tab_op_codigo_produto_fk'
         AND conrelid = '"OrdemProducao".tab_op'::regclass
    ) THEN
    ALTER TABLE "OrdemProducao".tab_op
      ADD CONSTRAINT tab_op_codigo_produto_fk
      FOREIGN KEY (codigo_produto_id)
      REFERENCES public.produtos_omie(codigo_produto)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END $$;
