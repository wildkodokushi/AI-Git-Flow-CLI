import crypto from 'node:crypto';
import { loadExtraCa } from './certs.js';
import { loadCredentials } from './config.js';
import { UserError } from './errors.js';
import { HttpError, request } from './http.js';

/**
 * Built-in provider presets. Everything except GigaChat speaks the OpenAI-compatible
 * /chat/completions protocol. Model names are only suggested where they are stable;
 * otherwise `aigf init` lists the models offered by the provider.
 */
export const PRESETS = {
  gigachat: {
    label: 'GigaChat (Сбер)',
    hint: 'бесплатный Freemium, доступен из России',
    type: 'gigachat',
    baseUrl: 'https://gigachat.devices.sberbank.ru/api/v1',
    authUrl: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    scope: 'GIGACHAT_API_PERS',
    keyEnv: 'GIGACHAT_AUTH_KEY',
    needsKey: true,
    extraCa: true,
    models: { small: 'GigaChat-2', large: 'GigaChat-2-Pro' },
  },
  deepseek: {
    label: 'DeepSeek',
    hint: 'дешёвый API, OpenAI-совместимый',
    baseUrl: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    needsKey: true,
    models: { small: 'deepseek-chat', large: 'deepseek-chat' },
  },
  grok: {
    label: 'xAI Grok',
    hint: 'модель выбирается из списка',
    baseUrl: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY',
    needsKey: true,
  },
  openrouter: {
    label: 'OpenRouter',
    hint: 'множество моделей одним ключом',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    needsKey: true,
  },
  groq: {
    label: 'Groq',
    hint: 'быстрый инференс, есть бесплатный тариф',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    needsKey: true,
  },
  openai: {
    label: 'OpenAI',
    hint: 'модель выбирается из списка',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    needsKey: true,
  },
  ollama: {
    label: 'Ollama (локально)',
    hint: 'без ключа, код не покидает компьютер',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
  },
};

export function providerNames(config) {
  return [...new Set([...Object.keys(PRESETS), ...Object.keys(config.providers)])];
}

export function resolveProvider(config, name) {
  const preset = PRESETS[name];
  const custom = config.providers[name];
  if (!preset && !custom) {
    throw new UserError(`Неизвестный провайдер "${name}". Список провайдеров: aigf provider list`);
  }
  const merged = { type: 'openai', needsKey: true, ...preset, ...custom, name };
  merged.models = { ...(preset?.models ?? {}), ...(custom?.models ?? {}) };
  if (!merged.keyEnv && merged.needsKey) {
    merged.keyEnv = `AIGF_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_KEY`;
  }
  return merged;
}

export function getApiKey(provider) {
  if (provider.keyEnv) {
    const fromEnv = process.env[provider.keyEnv];
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  }
  const stored = loadCredentials()[provider.name];
  return stored && stored.trim() ? stored.trim() : null;
}

const parseJson = (text, what) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new UserError(`Сервер вернул некорректный ответ (${what}): ${text.slice(0, 200)}`);
  }
};

export class OpenAIProvider {
  constructor(settings, key, { insecure = false } = {}) {
    this.settings = settings;
    this.key = key;
    this.insecure = insecure;
    this.ca = settings.extraCa ? loadExtraCa() : undefined;
    this.tokenParam = 'max_tokens';
    this.useTemperature = true;
  }

  get name() {
    return this.settings.name;
  }

  async authHeaders() {
    return this.key ? { Authorization: `Bearer ${this.key}` } : {};
  }

  async send(method, route, payload) {
    const headers = { Accept: 'application/json', ...(await this.authHeaders()) };
    if (payload !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    const response = await request({
      url: `${this.settings.baseUrl.replace(/\/+$/, '')}${route}`,
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      ca: this.ca,
      insecure: this.insecure,
    });
    if (response.status >= 400) throw new HttpError(response.status, response.text);
    return parseJson(response.text, route);
  }

  /** Verifies connectivity and authorization. Overridden where an extra handshake is needed. */
  async ready() {
    return true;
  }

  async listModels() {
    try {
      const data = await this.send('GET', '/models');
      const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
      return list.map((item) => item.id ?? item.name).filter(Boolean).sort();
    } catch (error) {
      if (error instanceof HttpError && error.status !== 401 && error.status !== 403) return null;
      throw error;
    }
  }

  async chat({ system, user, model, maxTokens }) {
    const usage = { prompt: 0, completion: 0, total: 0 };
    let tokens = maxTokens;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const payload = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (this.useTemperature) payload.temperature = 0.2;
      payload[this.tokenParam] = tokens;

      let data;
      try {
        data = await this.send('POST', '/chat/completions', payload);
      } catch (error) {
        if (error instanceof HttpError && error.status === 400) {
          const message = error.body.toLowerCase();
          if (this.tokenParam === 'max_tokens' && message.includes('max_completion_tokens')) {
            this.tokenParam = 'max_completion_tokens';
            continue;
          }
          if (this.useTemperature && message.includes('temperature')) {
            this.useTemperature = false;
            continue;
          }
        }
        throw error;
      }

      if (data.usage) {
        usage.prompt += data.usage.prompt_tokens ?? 0;
        usage.completion += data.usage.completion_tokens ?? 0;
        usage.total += data.usage.total_tokens ?? 0;
      }
      const choice = data.choices?.[0];
      const text = String(choice?.message?.content ?? '').trim();
      if (text) return { text, usage };
      if (choice?.finish_reason === 'length' && tokens < 4096) {
        // Reasoning models spend the whole budget on hidden thinking: retry with more room.
        tokens = Math.max(tokens * 8, 1024);
        continue;
      }
      break;
    }
    throw new UserError(
      `Модель ${model} вернула пустой ответ. Для aigf подходят обычные (не «рассуждающие») модели. Выберите другую: aigf provider models`,
    );
  }
}

export class GigaChatProvider extends OpenAIProvider {
  constructor(settings, key, options) {
    super(settings, key, options);
    this.token = null;
    this.tokenExpires = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    const response = await request({
      url: this.settings.authUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: crypto.randomUUID(),
        Authorization: `Basic ${this.key}`,
      },
      body: `scope=${this.settings.scope ?? 'GIGACHAT_API_PERS'}`,
      ca: this.ca,
      insecure: this.insecure,
    });
    if (response.status >= 400) throw new HttpError(response.status, response.text);
    const data = parseJson(response.text, 'oauth');
    if (!data.access_token) throw new UserError('GigaChat не вернул access token.');
    this.token = data.access_token;
    // The token lives 30 minutes; renew it a little earlier.
    this.tokenExpires = Date.now() + 25 * 60 * 1000;
    return this.token;
  }

  async authHeaders() {
    return { Authorization: `Bearer ${await this.accessToken()}` };
  }

  async ready() {
    await this.accessToken();
    return true;
  }
}

export function createProvider(settings, { insecure = false } = {}) {
  if (!settings.baseUrl) throw new UserError(`У провайдера ${settings.name} не задан baseUrl.`);
  const key = getApiKey(settings);
  if (settings.needsKey && !key) {
    throw new UserError(
      `Не найден ключ для провайдера ${settings.name}. Выполните: aigf provider key ${settings.name} (или задайте переменную ${settings.keyEnv}).`,
    );
  }
  const Provider = settings.type === 'gigachat' ? GigaChatProvider : OpenAIProvider;
  return new Provider(settings, key, { insecure });
}
