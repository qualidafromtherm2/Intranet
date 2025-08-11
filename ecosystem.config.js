module.exports = {
  apps: [
    {
      name: 'watch_zpl',
      script: './watch_print.js',
      watch: true,
      env: {
        PRINTER: 'ZebraZD220'     //  ← nome da fila do CUPS
      }
    },

    
    {
  name: 'intranet_api',
  script: './server.js',
  watch: true,
  ignore_watch: ['etiquetas', 'logs', 'node_modules'],
  watch_delay: 500
}

  ]
};
