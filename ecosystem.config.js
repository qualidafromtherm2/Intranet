// ecosystem.config.js
const NODE_BINARY = process.env.NODE_BINARY || '/home/leandro/.nvm/versions/node/v20.19.5/bin/node';

module.exports = {
  apps: [
    {
      name: 'watch_zpl',
      script: './watch_print.js',
      interpreter: NODE_BINARY,
      watch: true,
      env: {
        PRINTER: 'ZebraZD220'
      }
    },

    {
      name: 'intranet_api',
      script: './server.js',
      interpreter: NODE_BINARY,
      watch: true,
      ignore_watch: ['etiquetas', 'logs', 'node_modules', 'data'],
      watch_delay: 500,
      env: { PORT: 5001 },
      env_pg: { PORT: 5001 }   // se você usa o profile "pg"
    }
  ]
};
