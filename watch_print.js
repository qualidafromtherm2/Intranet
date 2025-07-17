// watch_print.js
const chokidar    = require('chokidar');
const { exec }    = require('child_process');
const path        = require('path');
const fs          = require('fs');

// Pasta onde o kanban_base.js grava as ZPL em local
const watchFolder = path.resolve(__dirname, 'etiquetas', 'Teste');

// Nome da fila da impressora no CUPS (confira em `lpstat -p`)
const printerName = 'Zebra_Raw';

// Garante que a pasta existe
if (!fs.existsSync(watchFolder)) {
  fs.mkdirSync(watchFolder, { recursive: true });
  console.log(`Criada pasta de monitoramento: ${watchFolder}`);
}

console.log(`Monitorando ${watchFolder} para novas etiquetas...`);
chokidar.watch(watchFolder, { ignoreInitial: true })
  .on('add', filePath => {
    console.log(`→ Nova etiqueta detectada: ${filePath}`);
    // envia para a impressora via lpr em modo RAW
    exec(`lpr -P "${printerName}" -o raw "${filePath}"`, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Erro ao imprimir:', stderr || err);
      } else {
        console.log(`✔ Impressão enviada (stdout: ${stdout.trim()})`);
        // opcional: mover ou apagar o arquivo após imprimir
        // fs.unlinkSync(filePath);
      }
    });
  });
