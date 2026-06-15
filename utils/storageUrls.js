// utils/storageUrls.js — URLs públicas de assets (Cloudflare R2)
const { R2_PUBLIC_BASE_URL, buildPublicUrl } = require('./storage');

const PLACEHOLDER = '{{STORAGE_PUBLIC_BASE_URL}}';
const LEGACY_SUPABASE_PUBLIC_PREFIX = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/';

function getStoragePublicBaseUrl() {
  return R2_PUBLIC_BASE_URL;
}

function injectStoragePublicUrls(content) {
  const base = getStoragePublicBaseUrl();
  if (!base) return String(content || '');
  return String(content || '')
    .split(PLACEHOLDER).join(base)
    .split(LEGACY_SUPABASE_PUBLIC_PREFIX).join(`${base}/`);
}

function assetUrl(bucket, objectPath) {
  return buildPublicUrl(bucket, objectPath);
}

const ASSETS = {
  favicon: assetUrl('compras-anexos', 'favicons/logo_guia_favicon_20260323.png'),
  profileDefault: assetUrl('compras-anexos', 'profile-photos/Captura de tela de 2026-01-29 15-12-33.png'),
  chatbotGif: assetUrl('produtos', 'assets/Gif_chatbot2.gif'),
  logoOs: assetUrl('produtos', 'assets/Logo_OS.png'),
  logoDatacrazy: assetUrl('produtos', 'assets/LOGO-DATACRAZY (1).png'),
  logoGuia: assetUrl('compras-anexos', 'favicons/logo_guia_20260323.png'),
  logoExpressa: assetUrl('compras-anexos', 'favicons/expressa_logo.png'),
  logoCorreios: assetUrl('compras-anexos', 'favicons/Logo_Correios.png'),
  fundoAtLink: assetUrl('produtos', 'assets/fundo.png'),
  logoAtLink: assetUrl('produtos', 'assets/logo.png'),
};

function agenteExeUrl(versao) {
  return assetUrl('agente-impressao', `agente-impressao-v${versao}.exe`);
}

function agenteSetupUrl() {
  return assetUrl('agente-impressao', 'agente-impressao-setup.exe');
}

function fromthermSetupUrl() {
  return assetUrl('produtos', 'fromtherm/Fromtherm-Local-Setup-v1.1.0.exe');
}

module.exports = {
  PLACEHOLDER,
  getStoragePublicBaseUrl,
  injectStoragePublicUrls,
  assetUrl,
  ASSETS,
  agenteExeUrl,
  agenteSetupUrl,
  fromthermSetupUrl,
};
