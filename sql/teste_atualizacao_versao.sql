-- ===== SCRIPT DE TESTE: ATUALIZAR VERSÃO DO SISTEMA =====
-- Objetivo: Testar a detecção de atualização mudando a versão no banco
-- Execute este comando para simular uma atualização

-- Ver versão atual ANTES
SELECT '=== VERSÃO ATUAL ===' as info;
SELECT versao, descricao, data_atualizacao, atualizado_por 
FROM configuracoes.versao_sistema;

-- Atualizar para nova versão
SELECT '=== ATUALIZANDO PARA 1.0.1 ===' as info;
SELECT * FROM configuracoes.atualizar_versao_sistema(
  '1.0.1',
  'Teste de atualização - Sistema de detecção funcionando!',
  'teste-desenvolvimento'
);

-- Ver versão atual DEPOIS
SELECT '=== NOVA VERSÃO ===' as info;
SELECT versao, descricao, data_atualizacao, atualizado_por 
FROM configuracoes.versao_sistema;

-- Se quiser voltar para 1.0.0:
-- SELECT * FROM configuracoes.atualizar_versao_sistema('1.0.0', 'Rollback para versão anterior', 'teste');
