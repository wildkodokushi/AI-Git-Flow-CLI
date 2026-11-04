import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { derToPem, isValidCertificate, loadExtraCa } from '../src/certs.js';
import { TlsError, request } from '../src/http.js';
import { GigaChatProvider } from '../src/providers.js';
import { runCli, tmp, writeFiles, makeRepo } from './helpers.js';

// A private CA, like the Russian Ministry of Digital Development CA that signs GigaChat servers.
const dir = tmp('aigf-tls-');
let server;
let port;
let opensslOk = true;

before(async () => {
  try {
    const sh = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
    sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Test Russian Trusted Root CA');
    sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=localhost');
    fs.writeFileSync(path.join(dir, 'ext.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
    sh('x509', '-req', '-in', 'srv.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.pem', '-days', '2', '-extfile', 'ext.cnf');
    sh('x509', '-in', 'ca.pem', '-outform', 'DER', '-out', 'ca.der');
  } catch {
    opensslOk = false;
    return;
  }
  server = https.createServer({ key: fs.readFileSync(path.join(dir, 'srv.key')), cert: fs.readFileSync(path.join(dir, 'srv.pem')) }, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.endsWith('/oauth')) res.end(JSON.stringify({ access_token: 't' }));
      else res.end(JSON.stringify({ choices: [{ message: { content: 'secure hello' }, finish_reason: 'stop' }], usage: { total_tokens: 3 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(() => server?.close());

const skip = () => !opensslOk && 'openssl is not available';

test('an unknown CA is rejected with a TlsError, a trusted one is accepted', { skip: skip() }, async () => {
  const url = `https://127.0.0.1:${port}/x`;
  await assert.rejects(() => request({ url, method: 'GET' }), TlsError);
  const response = await request({ url, method: 'GET', ca: [fs.readFileSync(path.join(dir, 'ca.pem'), 'utf8')] });
  assert.equal(response.status, 200);
  const insecure = await request({ url, method: 'GET', insecure: true });
  assert.equal(insecure.status, 200);
});

test('DER and PEM certificates are both understood', { skip: skip() }, () => {
  const pem = fs.readFileSync(path.join(dir, 'ca.pem'), 'utf8');
  const der = fs.readFileSync(path.join(dir, 'ca.der'));
  assert.equal(isValidCertificate(derToPem(der)), true);
  assert.equal(isValidCertificate('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'), false);

  const home = tmp('aigf-home-');
  fs.mkdirSync(path.join(home, 'certs'));
  fs.copyFileSync(path.join(dir, 'ca.der'), path.join(home, 'certs', 'root.cer'));
  fs.writeFileSync(path.join(home, 'certs', 'broken.pem'), 'garbage');
  const savedExtra = process.env.NODE_EXTRA_CA_CERTS;
  delete process.env.NODE_EXTRA_CA_CERTS; // the host may define its own
  process.env.AIGF_HOME = home;
  try {
    assert.equal(loadExtraCa().length, 1);
  } finally {
    delete process.env.AIGF_HOME;
    if (savedExtra !== undefined) process.env.NODE_EXTRA_CA_CERTS = savedExtra;
  }
  assert.ok(pem.includes('BEGIN CERTIFICATE'));
});

test('GigaChatProvider works over TLS with a certificate from the config folder', { skip: skip() }, async () => {
  const home = tmp('aigf-home-');
  fs.mkdirSync(path.join(home, 'certs'));
  fs.copyFileSync(path.join(dir, 'ca.der'), path.join(home, 'certs', 'russian_trusted_root_ca.cer'));
  const settings = { name: 'gigachat', baseUrl: `https://127.0.0.1:${port}/api/v1`, authUrl: `https://127.0.0.1:${port}/api/v2/oauth`, extraCa: true };

  process.env.AIGF_HOME = home;
  try {
    const provider = new GigaChatProvider(settings, 'KEY', {});
    const { text } = await provider.chat({ system: 's', user: 'u', model: 'GigaChat-2', maxTokens: 10 });
    assert.equal(text, 'secure hello');
  } finally {
    delete process.env.AIGF_HOME;
  }

  const bare = new GigaChatProvider({ ...settings, extraCa: false }, 'KEY', {});
  await assert.rejects(() => bare.ready(), TlsError);
});

test('NODE_EXTRA_CA_CERTS is honoured', { skip: skip() }, async () => {
  const settings = { name: 'gigachat', baseUrl: `https://127.0.0.1:${port}/api/v1`, authUrl: `https://127.0.0.1:${port}/api/v2/oauth`, extraCa: true };
  process.env.NODE_EXTRA_CA_CERTS = path.join(dir, 'ca.pem');
  process.env.AIGF_HOME = tmp('aigf-home-');
  try {
    const provider = new GigaChatProvider(settings, 'KEY', {});
    assert.equal(await provider.ready(), true);
  } finally {
    delete process.env.NODE_EXTRA_CA_CERTS;
    delete process.env.AIGF_HOME;
  }
});

test('the CLI explains a certificate problem and how to fix it', { skip: skip() }, async () => {
  const repo = makeRepo();
  writeFiles(repo.dir, { 'style.css': 'a {}\n' });
  const home = tmp('aigf-home-');
  fs.writeFileSync(
    path.join(home, 'config.json'),
    JSON.stringify({
      provider: 'gigachat',
      providers: { gigachat: { baseUrl: `https://127.0.0.1:${port}/api/v1`, authUrl: `https://127.0.0.1:${port}/api/v2/oauth` } },
      defaults: {},
    }),
  );
  const result = await runCli(['--dry-run'], { cwd: repo.dir, home, env: { GIGACHAT_AUTH_KEY: 'KEY' } });
  assert.equal(result.code, 1);
  assert.match(result.output, /TLS-сертификат/);
  assert.match(result.output, /aigf init/);
});
