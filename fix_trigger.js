const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function recreateTriggerFunction() {
  try {
    console.log('1. Removendo trigger...');
    await pool.query('DROP TRIGGER IF EXISTS trg_historico_solicitacao_compras ON compras.solicitacao_compras CASCADE;');
    console.log('✅ Trigger removido');
    
    console.log('\n2. Removendo função antiga...');
    await pool.query('DROP FUNCTION IF EXISTS compras.fn_registrar_historico_solicitacao() CASCADE;');
    console.log('✅ Função removida');
    
    console.log('\n3. Criando função CORRIGIDA com produto_descricao...');
    await pool.query(`
      CREATE FUNCTION compras.fn_registrar_historico_solicitacao()
      RETURNS TRIGGER AS $func$
      DECLARE
        v_usuario TEXT;
      BEGIN
        BEGIN
          v_usuario := current_setting('app.current_user', true);
        EXCEPTION WHEN OTHERS THEN
          v_usuario := current_user;
        END;

        IF (TG_OP = 'INSERT') THEN
          INSERT INTO compras.historico_solicitacao_compras (
            solicitacao_id, operacao, campo_alterado, valor_anterior, valor_novo,
            usuario, descricao_item, status_item, departamento
          ) VALUES (
            NEW.id, 'INSERT', 'NOVO_ITEM', NULL,
            format('Descrição: %s | Qtd: %s | Solicitante: %s',
              COALESCE(NEW.produto_descricao, '-'), COALESCE(NEW.quantidade::TEXT, '-'), COALESCE(NEW.solicitante, '-')),
            v_usuario, NEW.produto_descricao, NEW.status, NEW.departamento
          );
          RETURN NEW;
        END IF;

        IF (TG_OP = 'UPDATE') THEN
          IF (OLD.status IS DISTINCT FROM NEW.status) THEN
            INSERT INTO compras.historico_solicitacao_compras (
              solicitacao_id, operacao, campo_alterado, valor_anterior, valor_novo,
              usuario, descricao_item, status_item, departamento
            ) VALUES (
              NEW.id, 'UPDATE', 'status', OLD.status, NEW.status,
              v_usuario, NEW.produto_descricao, NEW.status, NEW.departamento
            );
          END IF;

          IF (OLD.quantidade IS DISTINCT FROM NEW.quantidade) THEN
            INSERT INTO compras.historico_solicitacao_compras (
              solicitacao_id, operacao, campo_alterado, valor_anterior, valor_novo,
              usuario, descricao_item, status_item, departamento
            ) VALUES (
              NEW.id, 'UPDATE', 'quantidade', OLD.quantidade::TEXT, NEW.quantidade::TEXT,
              v_usuario, NEW.produto_descricao, NEW.status, NEW.departamento
            );
          END IF;

          RETURN NEW;
        END IF;

        IF (TG_OP = 'DELETE') THEN
          INSERT INTO compras.historico_solicitacao_compras (
            solicitacao_id, operacao, campo_alterado, valor_anterior, valor_novo,
            usuario, descricao_item, status_item, departamento
          ) VALUES (
            OLD.id, 'DELETE', 'ITEM_REMOVIDO',
            format('Descrição: %s | Qtd: %s | Status: %s',
              COALESCE(OLD.produto_descricao, '-'), COALESCE(OLD.quantidade::TEXT, '-'), COALESCE(OLD.status, '-')),
            NULL, v_usuario, OLD.produto_descricao, OLD.status, OLD.departamento
          );
          RETURN OLD;
        END IF;

        RETURN NULL;
      END;
      $func$ LANGUAGE plpgsql;
    `);
    console.log('✅ Função criada com produto_descricao');
    
    console.log('\n4. Recriando trigger...');
    await pool.query(`
      CREATE TRIGGER trg_historico_solicitacao_compras
      AFTER INSERT OR UPDATE OR DELETE ON compras.solicitacao_compras
      FOR EACH ROW EXECUTE FUNCTION compras.fn_registrar_historico_solicitacao();
    `);
    console.log('✅ Trigger criado');
    
    console.log('\n5. Verificando código final...');
    const result = await pool.query(`
      SELECT pg_get_functiondef(oid) as definition 
      FROM pg_proc 
      WHERE proname = 'fn_registrar_historico_solicitacao'
    `);
    
    if (result.rows.length > 0) {
      const def = result.rows[0].definition;
      if (def.includes('produto_descricao')) {
        console.log('✅ SUCESSO! A função agora usa produto_descricao');
      } else {
        console.log('❌ ERRO! A função ainda usa descricao');
      }
      console.log('\nPrimeiras linhas da função:');
      console.log(def.split('\n').slice(0, 30).join('\n'));
    }
    
    await pool.end();
    console.log('\n✅ Processo concluído! Agora tente aprovar um item.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Erro:', error.message);
    await pool.end();
    process.exit(1);
  }
}

recreateTriggerFunction();
