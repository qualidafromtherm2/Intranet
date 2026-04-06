/**
 * Importação de atendimentos do Google Sheets → sac.at
 * 
 * Uso:
 *   node scripts/importar_at_sheets.js            (executa a importação)
 *   node scripts/importar_at_sheets.js --dry-run  (só mostra os números sem inserir)
 */

require('dotenv').config();
const { Pool } = require('pg');
const https = require('https');
const { parse } = require('csv-parse/sync');

const SHEETS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI/export?format=csv&gid=661685335';

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baixarCSV(url) {
  return new Promise((resolve, reject) => {
    const seguirRedirect = (u) => {
      https.get(u, { headers: { 'User-Agent': 'nodejs-import' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return seguirRedirect(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    seguirRedirect(url);
  });
}

/** Converte "29/11/2024" → Date ISO ou null */
function parseData(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim();
  // DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  // tenta outros formatos
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Limpa campo: trim + vazio → null */
function limpar(v) {
  const s = (v || '').trim();
  return s || null;
}

/**
 * Divide ENDEREÇO em { rua, numero, bairro }
 * Formato esperado: "rua, numero, bairro"
 * - bairro  = tudo após a última vírgula
 * - numero  = parte entre penúltima e última vírgula (extrai somente dígitos/S/N)
 * - rua     = tudo antes da penúltima vírgula
 */
function parseEndereco(endereco) {
  if (!endereco || !endereco.trim()) return { rua: null, numero: null, bairro: null };
  const partes = endereco.split(',');
  if (partes.length === 1) return { rua: limpar(partes[0]), numero: null, bairro: null };
  if (partes.length === 2) return { rua: limpar(partes[0]), numero: null, bairro: limpar(partes[1]) };

  const bairro  = limpar(partes[partes.length - 1]);
  const numRaw  = limpar(partes[partes.length - 2]);
  const rua     = partes.slice(0, partes.length - 2).map(p => p.trim()).join(', ');

  // numero: tenta extrair dígitos + eventual S/N
  const numMatch = (numRaw || '').match(/(\d[\d/]*|[Ss]\/[Nn])/);
  const numero = numMatch ? numMatch[1] : limpar(numRaw);

  return { rua: limpar(rua), numero, bairro };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('⬇  Baixando planilha do Google Sheets…');
  const csvText = await baixarCSV(SHEETS_CSV_URL);

  console.log('📋 Parseando CSV…');
  const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`   ${rows.length} linhas encontradas`);

  if (DRY_RUN) {
    console.log('\n⚠  Modo DRY-RUN — nenhuma inserção será feita.\n');
  }

  // Busca atendimento_inicial já existentes no banco para evitar duplicatas
  const { rows: existentes } = await pool.query(
    `SELECT atendimento_inicial FROM sac.at WHERE atendimento_inicial IS NOT NULL`
  );
  const jaExistem = new Set(existentes.map(r => String(r.atendimento_inicial).trim()));
  console.log(`   ${jaExistem.size} PROTC. já existem no banco (serão pulados)\n`);

  let inseridos = 0;
  let pulados   = 0;
  let erros     = 0;
  const errosDetalhe = [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const protc = limpar(row['PROTC.']);
      if (!protc) { pulados++; continue; }

      if (jaExistem.has(protc)) { pulados++; continue; }

      const dataVal = parseData(row['DATA']);
      const { rua, numero, bairro } = parseEndereco(row['ENDEREÇO']);
      const telefone = limpar(row['CONTATO WPP']) || limpar(row['CELULAR/FONE']);

      const valores = {
        data:                       dataVal || new Date(),
        tipo:                       limpar(row['TIPO']),
        nome_revenda_cliente:       limpar(row['CLIENTE']),
        numero_telefone:            telefone,
        cpf_cnpj:                   limpar(row['CPF/CNPJ']),
        cep:                        limpar(row['CEP']),
        bairro,
        cidade:                     limpar(row['CIDADE']),
        estado:                     limpar(row['UF']),
        numero,
        rua,
        agendar_atendimento_com:    limpar(row['AGENDAR COM']),
        descreva_reclamacao:        limpar(row['RECLAMAÇÃO']),
        modelo:                     limpar(row['EQUIPAMENTO']),
        tag_problema:               limpar(row['Problema real']),
        motivo_solicitacao:         limpar(row['Problema real']),
        atendimento_inicial:        protc,
      };

      if (DRY_RUN) {
        // Em dry-run só conta
        inseridos++;
        continue;
      }

      try {
        await client.query(
          `INSERT INTO sac.at (
            data, tipo, nome_revenda_cliente, numero_telefone, cpf_cnpj,
            cep, bairro, cidade, estado, numero, rua,
            agendar_atendimento_com, descreva_reclamacao, modelo,
            tag_problema, motivo_solicitacao, atendimento_inicial
          ) VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,$10,$11,
            $12,$13,$14,
            $15,$16,$17
          )`,
          [
            valores.data, valores.tipo, valores.nome_revenda_cliente, valores.numero_telefone, valores.cpf_cnpj,
            valores.cep, valores.bairro, valores.cidade, valores.estado, valores.numero, valores.rua,
            valores.agendar_atendimento_com, valores.descreva_reclamacao, valores.modelo,
            valores.tag_problema, valores.motivo_solicitacao, valores.atendimento_inicial,
          ]
        );
        inseridos++;
      } catch (err) {
        erros++;
        errosDetalhe.push({ protc, erro: err.message });
      }
    }

    if (!DRY_RUN) await client.query('COMMIT');
  } catch (err) {
    if (!DRY_RUN) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('──────────────────────────────');
  console.log(`✅ Inseridos : ${inseridos}`);
  console.log(`⏭  Pulados   : ${pulados}  (já existiam ou sem PROTC.)`);
  if (erros > 0) {
    console.log(`❌ Erros     : ${erros}`);
    errosDetalhe.slice(0, 10).forEach(e => console.log(`   PROTC.${e.protc}: ${e.erro}`));
  }
  if (DRY_RUN) console.log('\n(Dry-run: nada foi gravado no banco)');
  console.log('──────────────────────────────');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('FATAL:', err.message); process.exit(1); });
