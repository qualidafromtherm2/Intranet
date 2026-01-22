/**
 * Worker de Agendamento Automático de Sincronização
 * 
 * Verifica a cada minuto se deve executar a sincronização automática
 * com base na configuração de dias da semana e horário
 */

const fetch = require('node-fetch');

// Configuração
const CHECK_INTERVAL = 60 * 1000; // Verificar a cada 1 minuto
const API_URL = process.env.API_URL || 'http://localhost:5001';

let ultimaVerificacao = null;

/**
 * Buscar configuração de agendamento
 */
async function buscarConfiguracao() {
  try {
    const response = await fetch(`${API_URL}/api/sincronizacao/agendamento/config`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[Agendador] Erro ao buscar configuração:', error.message);
    return null;
  }
}

/**
 * Iniciar sincronização automática
 */
async function iniciarSincronizacao() {
  try {
    console.log('[Agendador] ⏰ Iniciando sincronização automática...');
    
    const response = await fetch(`${API_URL}/api/sincronizacao/agendamento/executar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('[Agendador] ✅ Sincronização iniciada:', result.message);
    return true;
  } catch (error) {
    console.error('[Agendador] ❌ Erro ao iniciar sincronização:', error.message);
    return false;
  }
}

/**
 * Verificar se deve executar a sincronização
 */
async function verificarExecucao() {
  const agora = new Date();
  const horaAtual = agora.getHours();
  const minutoAtual = agora.getMinutes();
  const diaSemanAtual = agora.getDay(); // 0=Domingo, 1=Segunda, ..., 6=Sábado
  
  // Buscar configuração
  const config = await buscarConfiguracao();
  
  if (!config || !config.ativo) {
    return; // Agendamento desativado
  }
  
  // Verificar se o dia da semana está configurado
  if (!config.dias_semana || !config.dias_semana.includes(diaSemanAtual)) {
    return; // Hoje não está configurado
  }
  
  // Extrair hora e minuto da configuração
  const [horaConfig, minutoConfig] = config.horario.split(':').map(Number);
  
  // Verificar se é o horário configurado
  if (horaAtual === horaConfig && minutoAtual === minutoConfig) {
    // Verificar se já executou neste minuto (evitar duplicação)
    const chaveVerificacao = `${agora.toDateString()}-${horaAtual}:${minutoAtual}`;
    
    if (ultimaVerificacao === chaveVerificacao) {
      return; // Já executou neste minuto
    }
    
    ultimaVerificacao = chaveVerificacao;
    
    console.log(`[Agendador] 🎯 Horário de execução atingido! ${horaAtual}:${minutoAtual < 10 ? '0' + minutoAtual : minutoAtual}`);
    await iniciarSincronizacao();
  }
}

/**
 * Iniciar worker
 */
function iniciar() {
  console.log('='.repeat(80));
  console.log('[Agendador] 🚀 Worker de Agendamento Automático iniciado');
  console.log('[Agendador] 📍 API URL:', API_URL);
  console.log('[Agendador] ⏱️  Verificando a cada', CHECK_INTERVAL / 1000, 'segundos');
  console.log('='.repeat(80));
  
  // Primeira verificação imediata
  verificarExecucao();
  
  // Verificações periódicas
  setInterval(verificarExecucao, CHECK_INTERVAL);
}

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('[Agendador] ❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Agendador] ❌ Promise rejeitada não tratada:', reason);
});

// Iniciar
iniciar();
