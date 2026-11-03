import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

export class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body ?? '';
  }
}

export class NetworkError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
  }
}

export class TlsError extends NetworkError {
  constructor(message, code) {
    super(message, code);
    this.name = 'TlsError';
  }
}

const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function classify(error) {
  if (TLS_CODES.has(error.code)) return new TlsError(error.message, error.code);
  return new NetworkError(error.message, error.code);
}

/**
 * Minimal HTTP client on top of node:http(s).
 * Unlike fetch it accepts extra CA certificates and ignores system proxy settings,
 * so stale proxy entries left behind by VPN clients cannot break requests.
 */
export function request({ url, method = 'POST', headers = {}, body, timeoutMs = 90000, ca, insecure = false }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new NetworkError(`Некорректный адрес: ${url}`, 'EINVALIDURL'));
      return;
    }
    const secure = target.protocol === 'https:';
    const payload = body === undefined || body === null ? null : Buffer.from(body, 'utf8');
    const options = {
      method,
      headers: { ...headers, ...(payload ? { 'Content-Length': payload.length } : {}) },
      timeout: timeoutMs,
    };
    if (secure) {
      if (ca && ca.length > 0) options.ca = [...tls.rootCertificates, ...ca];
      if (insecure) options.rejectUnauthorized = false;
    }
    const transport = secure ? https : http;
    const req = transport.request(target, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', (error) => reject(classify(error)));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, buffer, text: buffer.toString('utf8'), headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Превышено время ожидания ответа'), { code: 'ETIMEDOUT' })));
    req.on('error', (error) => reject(classify(error)));
    if (payload) req.write(payload);
    req.end();
  });
}
