// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'watch_zpl',
      script: './watch_print.js',
      watch: true,
      env: {
        PRINTER: 'ZebraZD220'
      }
    },

    {
      name: 'intranet_api',
      script: './server.js',
      watch: true,
      ignore_watch: ['etiquetas', 'logs', 'node_modules'],
      watch_delay: 500,

      // padrão (sem indicar env) → usa 5001
      env: {
        PORT: 5001
      },

      // === MODO JSON (sem banco) ===
      env_json: {
        PORT: 5001
        // intencionalmente sem DATABASE_URL
      },

      // === MODO POSTGRES (com banco) ===
      env_pg: {
        PORT: 5001
        // A DATABASE_URL será injetada pelo comando (não colocamos aqui)
      }
    }
  ]
};
