// sync_omie_imagens_estoque.js
// Sincroniza imagens de TODOS os produtos da tabela produtos_omie
// Consulta cada produto na Omie e atualiza/insere na tabela produtos_omie_imagens

import 'dotenv/config';
import { Client } from 'pg';

// ======= CONFIG via variáveis de ambiente =======
const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

// ======= AJUSTES =======
const DELAY_MS = 400; // Rate limit Omie: aumentado para 400ms para evitar redundância
const LOG_INTERVAL = 500; // Mostra progresso a cada 500 produtos
const MAX_RETRIES = 3; // Tentativas em caso de erro
const RETRY_DELAY_MS = 30000; // 30 segundos de espera quando detectar redundância

// ======= HELPERS =======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function consultarProdutoOmie(codigoProduto) {
  const body = {
    call: 'ConsultarProduto',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{ codigo_produto: parseInt(codigoProduto) }]
  };

  const res = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} - ${txt}`);
  }

  return await res.json();
}

async function atualizarImagensProduto(client, codigoProduto, imagens) {
  // Remove imagens antigas
  await client.query(
    'DELETE FROM public.produtos_omie_imagens WHERE codigo_produto = $1',
    [codigoProduto]
  );

  // Insere novas imagens
  if (imagens && Array.isArray(imagens) && imagens.length > 0) {
    for (let pos = 0; pos < imagens.length; pos++) {
      const img = imagens[pos];
      if (img.url_imagem) {
        await client.query(
          `INSERT INTO public.produtos_omie_imagens (codigo_produto, pos, url_imagem, path_key)
           VALUES ($1, $2, $3, $4)`,
          [codigoProduto, pos, img.url_imagem.trim(), img.path_key || null]
        );
      }
    }
    return imagens.length;
  }
  return 0;
}

async function main() {
  const startTime = Date.now();
  console.log('[SYNC IMAGENS ESTOQUE] Iniciando sincronização...\n');

  // Conecta ao banco
  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('[DB] Conectado ao PostgreSQL');

  try {
    // Busca todos os produtos ativos da tabela produtos_omie
    const result = await client.query(`
      SELECT codigo_produto, codigo, descricao
      FROM public.produtos_omie
      WHERE inativo = 'N' AND bloqueado = 'N'
        AND codigo_produto IS NOT NULL
      ORDER BY codigo
    `);

    const produtos = result.rows;
    console.log(`[SYNC] ${produtos.length} produtos encontrados na tabela produtos_omie\n`);

    let processados = 0;
    let sucessos = 0;
    let erros = 0;
    let semImagem = 0;
    let totalImagens = 0;

    for (let i = 0; i < produtos.length; i++) {
      const produto = produtos[i];
      const progresso = i + 1;

      let tentativas = 0;
      let sucesso = false;

      while (tentativas < MAX_RETRIES && !sucesso) {
        try {
          // Consulta produto na Omie
          const omieData = await consultarProdutoOmie(produto.codigo_produto);

          // Atualiza imagens no banco
          const numImagens = await atualizarImagensProduto(
            client,
            produto.codigo_produto,
            omieData.imagens
          );

          if (numImagens > 0) {
            sucessos++;
            totalImagens += numImagens;
          } else {
            semImagem++;
          }

          processados++;
          sucesso = true;

          // Log a cada 500 produtos ou no final
          if (progresso % LOG_INTERVAL === 0 || progresso === produtos.length) {
            const tempoDecorrido = ((Date.now() - startTime) / 1000).toFixed(1);
            const taxaProcessamento = (processados / (Date.now() - startTime) * 1000).toFixed(2);
            
            console.log(`[PROGRESSO] ${progresso}/${produtos.length} produtos`);
            console.log(`  ✓ Com imagens: ${sucessos}`);
            console.log(`  ○ Sem imagens: ${semImagem}`);
            console.log(`  ✗ Erros: ${erros}`);
            console.log(`  📸 Total imagens: ${totalImagens}`);
            console.log(`  ⏱️  Tempo: ${tempoDecorrido}s | Taxa: ${taxaProcessamento} prod/seg\n`);
          }

          // Aguarda para respeitar rate limit
          if (i < produtos.length - 1) {
            await sleep(DELAY_MS);
          }

        } catch (err) {
          tentativas++;
          
          // Se detectar consumo redundante, espera mais tempo
          if (err.message.includes('Consumo redundante') || err.message.includes('CACHED')) {
            if (tentativas < MAX_RETRIES) {
              console.log(`[AGUARDANDO] Consumo redundante detectado. Esperando 30s antes de tentar novamente... (tentativa ${tentativas}/${MAX_RETRIES})`);
              await sleep(RETRY_DELAY_MS);
            } else {
              erros++;
              console.error(`[ERRO] Produto ${produto.codigo} (${produto.omie_prod_id}): Máximo de tentativas atingido`);
            }
          } else {
            erros++;
            console.error(`[ERRO] Produto ${produto.codigo} (${produto.codigo_produto}): ${err.message}`);
            break; // Não tenta novamente para outros tipos de erro
          }
        }
      }

      // Log a cada 500 mesmo com erro (se não foi sucesso)
      if (!sucesso && progresso % LOG_INTERVAL === 0) {
        console.log(`[PROGRESSO] ${progresso}/${produtos.length} - Processados: ${processados}, Erros: ${erros}\n`);
      }
    }

    // Resumo final
    const tempoTotal = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n' + '='.repeat(60));
    console.log('[SYNC IMAGENS] CONCLUÍDO');
    console.log('='.repeat(60));
    console.log(`Total de produtos: ${produtos.length}`);
    console.log(`Processados: ${processados}`);
    console.log(`✓ Com imagens atualizadas: ${sucessos}`);
    console.log(`○ Sem imagens: ${semImagem}`);
    console.log(`✗ Erros: ${erros}`);
    console.log(`📸 Total de imagens inseridas: ${totalImagens}`);
    console.log(`⏱️  Tempo total: ${tempoTotal}s`);
    console.log('='.repeat(60) + '\n');

  } catch (err) {
    console.error('[ERRO FATAL]', err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('[DB] Desconectado');
  }
}

// Executa
main().catch(err => {
  console.error('[ERRO]', err);
  process.exit(1);
});
