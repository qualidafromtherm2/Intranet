// watch_print.js (versão enxuta e funcional)
const chokidar   = require('chokidar');
const { execFile } = require('child_process');
const path       = require('path');
const fs         = require('fs');

const watchFolder = path.resolve(__dirname, 'etiquetas', 'Teste');
//  ↓ se PRINTER não estiver definido, o script usa a fila default do sistema
const printerName = process.env.PRINTER || '';

if (!fs.existsSync(watchFolder)) fs.mkdirSync(watchFolder, { recursive: true });

console.log(`Monitorando ${watchFolder} para novas etiquetas…`);
// watch_print.js
chokidar.watch(watchFolder, { ignoreInitial: true })
  .on('add',    filePath => imprimir(filePath))
  .on('change', filePath => imprimir(filePath));   // 👈 NOVO

  function imprimir(filePath) {
  console.log(`→ Etiqueta detectada: ${filePath}`);
  execFile('lpr', ['-o','raw', filePath], (err) => {
    if (err) console.error('❌ Erro ao imprimir:', err.message);
    else     console.log('✔ Impressão enviada');
  });
}
