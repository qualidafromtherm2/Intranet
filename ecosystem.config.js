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
  env: { PORT: 5001 },
  env_pg: { PORT: 5001 }   // se você usa o profile "pg"
}

  ]
};
