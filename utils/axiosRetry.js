// utils/axiosRetry.js
const axios = require('axios');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function axiosPostWithRetry(url, payload, options, retries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.post(url, payload, options);
    } catch (error) {
      if (error.code === 'ECONNRESET' || error.code === 'ERR_NETWORK') {
        console.error(`Tentativa ${attempt} falhou. Retentando em ${delayMs} ms...`);
        await delay(delayMs);
      } else {
        throw error;
      }
    }
  }
  throw new Error('Número máximo de tentativas excedido');
}

module.exports = { axiosPostWithRetry, delay };
