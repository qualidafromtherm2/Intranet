/**
 * Resolução segura de conflito de merge (Publicar no site).
 * Nunca descarta trabalho da main; une as duas pontas quando o hunk é mecânico.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function splitLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

function joinLines(lines) {
  return lines.join('\n');
}

function newerCacheVersion(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa === sb) return sa;
  return sa > sb ? sa : sb;
}

function parseAssetLine(line) {
  const m = String(line || '').match(
    /^(\s*<(?:link|script)\b[^>]*(?:href|src)=")([^"?]+)(\?v=)([^"]+)("[^>]*>\s*)$/i
  );
  if (!m) return null;
  return { prefix: m[1], asset: m[2], ver: m[4], suffix: m[5], raw: line };
}

/** Une tags de asset: mesmo arquivo fica com o ?v= mais novo; linhas extras das duas pontas permanecem. */
function mergeCacheBusterHunk(ours, theirs) {
  const oLines = splitLines(ours).filter((l) => l.length);
  const tLines = splitLines(theirs).filter((l) => l.length);
  const parsedO = oLines.map(parseAssetLine);
  const parsedT = tLines.map(parseAssetLine);
  if (!oLines.length || !tLines.length) return null;
  if (parsedO.some((p) => !p) || parsedT.some((p) => !p)) return null;

  const byAsset = new Map();
  const order = [];
  for (const p of [...parsedT, ...parsedO]) {
    if (!byAsset.has(p.asset)) {
      byAsset.set(p.asset, p);
      order.push(p.asset);
    } else {
      const prev = byAsset.get(p.asset);
      if (newerCacheVersion(p.ver, prev.ver) === p.ver) byAsset.set(p.asset, p);
    }
  }
  return order.map((asset) => {
    const p = byAsset.get(asset);
    return `${p.prefix}${p.asset}?v=${p.ver}${p.suffix}`;
  }).join('\n');
}

function parseOptionBag(src) {
  const s = String(src || '').trim();
  const fn = s.match(
    /^(function\s+\w+\s*\(\s*\w+\s*,\s*\{\s*)([^}]*)(\s*\}\s*=\s*\{\}\s*\)\s*\{)$/
  );
  if (fn) return { kind: 'fn', lead: fn[1], body: fn[2], trail: fn[3] };
  const call = s.match(
    /^((?:body:\s*)?\{\s*prompt:\s*wrapPromptForCursor\(\s*\w+\s*,\s*)(\{[^}]*\})(\s*\)\s*\},?)$/
  );
  if (call) return { kind: 'call', lead: call[1], body: call[2], trail: call[3] };
  const bare = s.match(/^(\{\s*)([^}]*)(\s*\})$/);
  if (bare && /(?:followUp|readOnlySql)\s*[:=]/.test(bare[2])) {
    return { kind: 'bare', lead: bare[1], body: bare[2], trail: bare[3] };
  }
  return null;
}

function mergeOptionParts(a, b) {
  const map = new Map();
  for (const raw of `${a},${b}`.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const name = part.split(/[:=]/)[0].trim();
    if (!name) continue;
    if (!map.has(name)) map.set(name, part);
  }
  return [...map.values()].join(', ');
}

function mergeJsOptionHunk(ours, theirs) {
  const o = parseOptionBag(ours);
  const t = parseOptionBag(theirs);
  if (!o || !t || o.kind !== t.kind) return null;
  const bodyO = o.body.replace(/^\{|\}$/g, '').trim();
  const bodyT = t.body.replace(/^\{|\}$/g, '').trim();
  const merged = mergeOptionParts(bodyO, bodyT);
  if (o.kind === 'call') {
    return `${o.lead}{ ${merged} }${o.trail}`;
  }
  if (o.kind === 'fn') {
    return `${o.lead}${merged}${o.trail}`;
  }
  return `${o.lead}${merged}${o.trail}`;
}

function mergePreambleHunk(ours, theirs) {
  const blob = `${ours}\n${theirs}`;
  if (!/sqlAccessPreamble/.test(blob)) return null;
  const hasFollow = /followUpHint/.test(blob);
  const hasReadOnly = /readOnly/.test(blob);
  if (!hasFollow || !hasReadOnly) return null;
  const indent = (String(ours).match(/^(\s*)/) || ['', '  '])[1];
  return `${indent}text: \`\${sqlAccessPreamble({ readOnly: readOnlySql })}\\n---\\n\${followUpHint}\${text}\`,`;
}

function isAdditiveLine(line) {
  const l = String(line || '');
  return (
    /^\s*<link\b/i.test(l) ||
    /^\s*<script\b/i.test(l) ||
    /^\s*import\s/.test(l) ||
    /^\s*(?:const|let|var)\s+\{[^}]+\}\s*=\s*require\(/.test(l)
  );
}

function bothUniqueAdditions(ours, theirs) {
  const o = splitLines(ours).filter((l) => l.trim());
  const t = splitLines(theirs).filter((l) => l.trim());
  if (!o.length || !t.length) return false;
  if (![...o, ...t].every(isAdditiveLine)) return false;
  const oSet = new Set(o.map((l) => l.trim()));
  const tSet = new Set(t.map((l) => l.trim()));
  return o.every((l) => !tSet.has(l.trim())) && t.every((l) => !oSet.has(l.trim()));
}

/**
 * Resolve um hunk <<<<<<< / ======= / >>>>>>>.
 * ours = branch do PR, theirs = main.
 */
function resolveConflictHunk(oursRaw, theirsRaw) {
  const ours = String(oursRaw || '').replace(/\n$/, '');
  const theirs = String(theirsRaw || '').replace(/\n$/, '');
  if (ours === theirs) return { ok: true, text: ours, strategy: 'identical' };
  if (!ours.trim()) return { ok: true, text: theirs, strategy: 'take-main-addition' };
  if (!theirs.trim()) return { ok: true, text: ours, strategy: 'take-pr-addition' };

  const cache = mergeCacheBusterHunk(ours, theirs);
  if (cache != null) return { ok: true, text: cache, strategy: 'cache-buster' };

  const opts = mergeJsOptionHunk(ours, theirs);
  if (opts != null) return { ok: true, text: opts, strategy: 'js-options' };

  const preamble = mergePreambleHunk(ours, theirs);
  if (preamble != null) return { ok: true, text: preamble, strategy: 'preamble' };

  if (bothUniqueAdditions(ours, theirs)) {
    return { ok: true, text: `${theirs}\n${ours}`, strategy: 'keep-both-additions' };
  }

  return {
    ok: false,
    reason: 'hunk inseguro: as duas pontas mudaram o mesmo trecho de forma não mecânica',
  };
}

function applyConflictMarkers(text) {
  const src = String(text || '');
  const re =
    /<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n/g;
  let out = '';
  let last = 0;
  let match;
  const strategies = [];
  while ((match = re.exec(src))) {
    out += src.slice(last, match.index);
    const resolved = resolveConflictHunk(match[1], match[2]);
    if (!resolved.ok) {
      return { ok: false, reason: resolved.reason, text: src };
    }
    strategies.push(resolved.strategy);
    out += resolved.text.endsWith('\n') ? resolved.text : `${resolved.text}\n`;
    last = match.index + match[0].length;
  }
  if (last === 0) return { ok: true, text: src, strategies: ['clean'] };
  out += src.slice(last);
  if (/<<<<<<<|>>>>>>>/.test(out)) {
    return { ok: false, reason: 'ainda há marcadores de conflito', text: out };
  }
  return { ok: true, text: out, strategies };
}

function writeTemp(dir, name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, String(text ?? ''), 'utf8');
  return file;
}

function gitMergeFile(baseText, oursText, theirsText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-safe-merge-'));
  try {
    const ours = writeTemp(dir, 'ours', oursText);
    const base = writeTemp(dir, 'base', baseText);
    const theirs = writeTemp(dir, 'theirs', theirsText);
    const proc = spawnSync('git', ['merge-file', '-p', '-L', 'pr', '-L', 'base', '-L', 'main', ours, base, theirs], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    if (proc.error) {
      return { ok: false, reason: `git merge-file: ${proc.error.message}` };
    }
    // 0 = limpo, 1 = conflitos, >1 = erro
    if (proc.status > 1) {
      return { ok: false, reason: proc.stderr || `git merge-file status ${proc.status}` };
    }
    const merged = proc.stdout || '';
    if (proc.status === 0 && !/<<<<<<</.test(merged)) {
      return { ok: true, text: merged, strategies: ['git-clean'] };
    }
    return applyConflictMarkers(merged);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function mergeFile3Way(baseText, oursText, theirsText) {
  const base = String(baseText ?? '');
  const ours = String(oursText ?? '');
  const theirs = String(theirsText ?? '');
  if (ours === theirs) return { ok: true, text: ours, strategies: ['identical'] };
  if (ours === base) return { ok: true, text: theirs, strategies: ['take-main'] };
  if (theirs === base) return { ok: true, text: ours, strategies: ['take-pr'] };
  return gitMergeFile(base, ours, theirs);
}

function isMergeConflictError(err) {
  const msg = String(err?.message || err?.data?.message || '');
  return (
    err?.status === 405 ||
    err?.status === 409 ||
    /merge conflicts?/i.test(msg) ||
    /Pull Request is not mergeable/i.test(msg)
  );
}

async function githubGetBlobText(githubFetch, owner, repo, commitSha, filePath) {
  const commit = await githubFetch(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
  let treeSha = commit?.tree?.sha;
  const parts = String(filePath).split('/').filter(Boolean);
  let sha = null;
  for (let i = 0; i < parts.length; i += 1) {
    const tree = await githubFetch(`/repos/${owner}/${repo}/git/trees/${treeSha}`);
    const entry = (tree?.tree || []).find((e) => e.path === parts[i]);
    if (!entry) return i === parts.length - 1 ? '' : null;
    if (i === parts.length - 1) {
      sha = entry.sha;
      break;
    }
    treeSha = entry.sha;
  }
  if (!sha) return '';
  const blob = await githubFetch(`/repos/${owner}/${repo}/git/blobs/${sha}`);
  const enc = String(blob?.encoding || 'utf-8');
  if (enc === 'base64') {
    return Buffer.from(String(blob.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
  }
  return String(blob?.content || '');
}

async function githubCommitFiles({
  githubFetch,
  owner,
  repo,
  branch,
  parentSha,
  files,
  message,
  secondParentSha = null,
}) {
  const parent = await githubFetch(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const treeItems = [];
  for (const file of files) {
    if (file.delete) {
      treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await githubFetch(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: { content: file.content, encoding: 'utf-8' },
    });
    treeItems.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }
  const tree = await githubFetch(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: { base_tree: parent.tree.sha, tree: treeItems },
  });
  const parents = [parentSha];
  if (secondParentSha) parents.push(secondParentSha);
  const commit = await githubFetch(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents },
  });
  await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${String(branch).replace(/^refs\/heads\//, '')}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
  });
  return commit;
}

async function waitUntilMergeable(githubFetch, owner, repo, prNumber, { tries = 8 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    last = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`);
    if (last.mergeable === true) return last;
    if (last.mergeable === false && String(last.mergeable_state || '') === 'dirty' && i > 1) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return last;
}

/**
 * Atualiza a branch do PR com a main, resolvendo só hunks seguros.
 */
async function resolvePrConflictsSafely({ githubFetch, owner, repo, prNumber }) {
  const pr = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const headSha = pr?.head?.sha;
  const baseSha = pr?.base?.sha;
  const branch = pr?.head?.ref;
  if (!headSha || !baseSha || !branch) {
    return { ok: false, message: 'PR sem head/base para resolver conflito.' };
  }

  const compare = await githubFetch(
    `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`
  );
  const mergeBase = compare?.merge_base_commit?.sha;
  if (!mergeBase) {
    return { ok: false, message: 'Não achei o merge-base do PR.' };
  }

  const mainFiles = await githubFetch(
    `/repos/${owner}/${repo}/compare/${mergeBase}...${baseSha}`
  );
  const prFiles = await githubFetch(
    `/repos/${owner}/${repo}/compare/${mergeBase}...${headSha}`
  );
  const prChanged = new Set((prFiles?.files || []).map((f) => f.filename));
  const updates = [];
  const report = [];

  for (const file of mainFiles?.files || []) {
    const filename = file.filename;
    if (file.status === 'removed' && !prChanged.has(filename)) {
      updates.push({ path: filename, delete: true });
      report.push({ file: filename, strategy: 'delete-from-main' });
      continue;
    }
    if (file.status === 'renamed' && file.previous_filename && !prChanged.has(file.previous_filename)) {
      updates.push({ path: file.previous_filename, delete: true });
    }
    if (!prChanged.has(filename)) {
      const content = await githubGetBlobText(githubFetch, owner, repo, baseSha, filename);
      if (content == null) continue;
      updates.push({ path: filename, content });
      report.push({ file: filename, strategy: 'take-main-only' });
      continue;
    }
    if (/\.(png|jpe?g|gif|webp|pdf|woff2?|zip)$/i.test(filename)) {
      return {
        ok: false,
        message: `Conflito em arquivo binário (${filename}) — não resolvo no automático.`,
        file: filename,
      };
    }
    const [baseText, oursText, theirsText] = await Promise.all([
      githubGetBlobText(githubFetch, owner, repo, mergeBase, filename),
      githubGetBlobText(githubFetch, owner, repo, headSha, filename),
      githubGetBlobText(githubFetch, owner, repo, baseSha, filename),
    ]);
    const merged = mergeFile3Way(baseText || '', oursText || '', theirsText || '');
    if (!merged.ok) {
      return {
        ok: false,
        message:
          `Conflito em ${filename} não é mecânico (${merged.reason}). ` +
          'O agente precisa olhar o trecho antes de publicar.',
        file: filename,
        reason: merged.reason,
      };
    }
    updates.push({ path: filename, content: merged.text });
    report.push({ file: filename, strategy: (merged.strategies || []).join('+') });
  }

  if (!updates.length) {
    return { ok: false, message: 'GitHub ainda marca conflito, mas não achei arquivos para unir.' };
  }

  const commit = await githubCommitFiles({
    githubFetch,
    owner,
    repo,
    branch,
    parentSha: headSha,
    secondParentSha: baseSha,
    files: updates,
    message: `merge(main): resolver conflitos do #${prNumber} com segurança`,
  });

  return {
    ok: true,
    sha: commit?.sha || null,
    files: report,
    message: `Conflitos resolvidos com segurança (${report.length} arquivo(s)).`,
  };
}

const CONFLICT_FOLLOWUP_PROMPT = [
  'O PR desta conversa está com merge conflict na main e o botão Publicar falhou.',
  'Resolva COM SEGURANÇA:',
  '1. git fetch origin main e faça merge da main na branch do PR.',
  '2. Não descarte trabalho da main (ex.: chamado-ia CSS/JS, SQL read-only).',
  '3. Não descarte o trabalho desta conversa.',
  '4. Cache buster: fique com o ?v= mais novo e mantenha os assets novos das duas pontas.',
  '5. Se wrapPrompt / opções JS divergirem, una as chaves (followUp + readOnlySql).',
  '6. Nunca deixe marcadores <<<<<<< no código.',
  '7. Commit e push na branch do PR. NÃO faça merge na main e NÃO clique em publicar — o usuário publica.',
].join('\n');

module.exports = {
  splitLines,
  joinLines,
  mergeCacheBusterHunk,
  mergeJsOptionHunk,
  mergePreambleHunk,
  resolveConflictHunk,
  applyConflictMarkers,
  mergeFile3Way,
  isMergeConflictError,
  resolvePrConflictsSafely,
  CONFLICT_FOLLOWUP_PROMPT,
};
