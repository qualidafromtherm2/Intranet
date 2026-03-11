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
  watch: false,
  env: {
    PORT: 5001,
    TRACKINGMORE_API_KEY: 'h5mfcv6x-mwn8-89iz-nl6i-g3m0139q02k6',
    GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbwf4_bEwxzU59N5N9K5Ks1lUE0mP3XznPQrUgVSAfTm3-tdtgBjb0XUUHJAyjVXQwciEA/exec'
  },
  env_pg: {
    PORT: 5001,
    TRACKINGMORE_API_KEY: 'h5mfcv6x-mwn8-89iz-nl6i-g3m0139q02k6',
    GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbwf4_bEwxzU59N5N9K5Ks1lUE0mP3XznPQrUgVSAfTm3-tdtgBjb0XUUHJAyjVXQwciEA/exec'
  }   // se você usa o profile "pg"
}

  ]
};
