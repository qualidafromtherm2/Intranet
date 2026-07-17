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
  name: 'proxy_3001',
  script: './scripts/proxy-3001.js',
  watch: false,
  env: {
    PROXY_PORT: 3001,
    PROXY_TARGET_PORT: 5001
  }
},

{
  name: 'intranet_api',
  script: './server.js',
  watch: false,
  env: {
    PORT: 5001,
    TRACKINGMORE_API_KEY: 'h5mfcv6x-mwn8-89iz-nl6i-g3m0139q02k6',
    GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbwf4_bEwxzU59N5N9K5Ks1lUE0mP3XznPQrUgVSAfTm3-tdtgBjb0XUUHJAyjVXQwciEA/exec',
    GOOGLE_SHEETS_OP_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbyjr60Iw3OpWMSwD7NDJ1D5qigSTCj-fuzAKI546EIlfZFt65Mxy40_K5y2R1dJ2mpLyQ/exec',
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || '541888944201-2r3e0cokq5opj97os15t5m4inhp2b6h2.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'COLE_AQUI_O_CLIENT_SECRET_DO_GOOGLE_CLOUD',
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://intranet-30av.onrender.com/api/google-calendar/callback'
  },
  env_pg: {
    PORT: 5001,
    TRACKINGMORE_API_KEY: 'h5mfcv6x-mwn8-89iz-nl6i-g3m0139q02k6',
    GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbwf4_bEwxzU59N5N9K5Ks1lUE0mP3XznPQrUgVSAfTm3-tdtgBjb0XUUHJAyjVXQwciEA/exec',
    GOOGLE_SHEETS_OP_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycbyjr60Iw3OpWMSwD7NDJ1D5qigSTCj-fuzAKI546EIlfZFt65Mxy40_K5y2R1dJ2mpLyQ/exec',
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || '541888944201-2r3e0cokq5opj97os15t5m4inhp2b6h2.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'COLE_AQUI_O_CLIENT_SECRET_DO_GOOGLE_CLOUD',
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://intranet-30av.onrender.com/api/google-calendar/callback'
  }   // se você usa o profile "pg"
}

  ]
};
