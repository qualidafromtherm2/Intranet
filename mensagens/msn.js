// mensagens/msn.js
const fs   = require('fs');
const path = require('path');
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');


/* utilidades internas */
function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/* ------------------------------------------------------------ */
/* API PÚBLICA                                                  */
/* ------------------------------------------------------------ */

// devolve { count, messages } aceitando id numérico OU username
function getMessagesForUser(identifier) {
    const users = loadUsers();
    const u = users.find(x =>
      x.id === identifier ||
      (typeof identifier === 'string' &&
       x.username.toLowerCase() === String(identifier).toLowerCase())
    );
    const messages = (u && Array.isArray(u.msn)) ? u.msn : [];
    return { count: messages.length, messages };
  }
  

// adiciona "Recuperar senha: user \"...\"" no msn de todos os admins
function addResetRequest(username) {
  const users = loadUsers();
  users.forEach(u => {
    if (u.roles.includes('admin')) {
      if (!Array.isArray(u.msn)) u.msn = [];
      u.msn.push(`Recuperar senha: user "${username}"`);
    }
  });
  saveUsers(users);
}

// remove uma mensagem pelo índice (admin logado)
// remove uma mensagem pelo índice
function removeMessageForUser(identifier, index) {
    const users = loadUsers();
    const u = users.find(x =>
      x.id === identifier ||
      (typeof identifier === 'string' &&
       x.username.toLowerCase() === String(identifier).toLowerCase())
    );
    if (!u || !Array.isArray(u.msn) || index < 0 || index >= u.msn.length) {
      throw new Error('índice inválido');
    }
    u.msn.splice(index, 1);
    saveUsers(users);
  }
  
  
  module.exports = {
    getMessagesForUser,
    addResetRequest,
    removeMessageForUser         // novo
  };

  
