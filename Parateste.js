const fs = require('fs');
const path = require('path');
const Papa = require('papaparse').default || require('papaparse');

// Array simples para teste
const teste = [
  { cCodigo: "123", cDescricao: "Teste de conversão" },
  { cCodigo: "456", cDescricao: "Outro teste" }
];

// Converte o array para CSV
const csvTeste = Papa.unparse(teste);

// Exibe no terminal o CSV gerado
console.log("CSV de teste gerado:");
console.log(csvTeste);

// Define o caminho do arquivo de teste
const filePath = path.join(__dirname, 'teste.csv');

// Escreve o CSV no arquivo
fs.writeFileSync(filePath, csvTeste, 'utf8');
console.log("Arquivo teste.csv salvo em:", filePath);
