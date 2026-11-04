import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { certsDir } from './config.js';
import { request } from './http.js';

export const RUSSIAN_CA_URLS = [
  'https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer',
  'https://gu-st.ru/content/Other/doc/russian_trusted_sub_ca.cer',
];

export function derToPem(buffer) {
  const body = buffer.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

/** Accepts both PEM and DER encoded certificates and returns PEM text. */
export function toPem(buffer) {
  const text = buffer.toString('latin1');
  return text.includes('-----BEGIN CERTIFICATE-----') ? buffer.toString('utf8') : derToPem(buffer);
}

export function isValidCertificate(pem) {
  try {
    return new crypto.X509Certificate(pem) !== null;
  } catch {
    return false;
  }
}

/** Certificates from the aigf config folder plus NODE_EXTRA_CA_CERTS (which Node ignores once `ca` is set). */
export function loadExtraCa() {
  const result = [];
  const readInto = (file) => {
    try {
      const pem = toPem(fs.readFileSync(file));
      if (isValidCertificate(pem)) result.push(pem);
    } catch {
      // Unreadable file: ignore.
    }
  };
  try {
    for (const name of fs.readdirSync(certsDir())) {
      if (/\.(pem|crt|cer)$/i.test(name)) readInto(path.join(certsDir(), name));
    }
  } catch {
    // Folder does not exist yet.
  }
  if (process.env.NODE_EXTRA_CA_CERTS) readInto(process.env.NODE_EXTRA_CA_CERTS);
  return result;
}

/** Downloads the Russian root (and, when available, intermediate) certificates into the config folder. */
export async function downloadRussianCa(urls = RUSSIAN_CA_URLS) {
  fs.mkdirSync(certsDir(), { recursive: true });
  const saved = [];
  for (const url of urls) {
    try {
      const response = await request({ url, method: 'GET', timeoutMs: 30000 });
      if (response.status !== 200) continue;
      const pem = toPem(response.buffer);
      if (!isValidCertificate(pem)) continue;
      const file = path.join(certsDir(), path.basename(new URL(url).pathname).replace(/\.cer$/i, '.pem'));
      fs.writeFileSync(file, pem, 'utf8');
      saved.push(file);
    } catch {
      // Try the next URL: the intermediate certificate is optional.
    }
  }
  return saved;
}
