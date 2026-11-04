import { loadConfig } from './config.js';
import { UserError } from './errors.js';
import { HttpError, NetworkError, TlsError } from './http.js';
import { createProvider, resolveProvider } from './providers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Converts low level errors into messages a user can act on. */
export function describeError(error) {
  if (error instanceof UserError) return error;
  if (error instanceof TlsError) {
    return new UserError(
      `Не удалось проверить TLS-сертификат сервера (${error.code}). Для GigaChat выполните aigf init (он скачает сертификат Минцифры) ` +
        'или укажите файл сертификата в переменной NODE_EXTRA_CA_CERTS. Крайний случай: параметр --insecure.',
    );
  }
  if (error instanceof NetworkError) {
    return new UserError(`Нет соединения с сервером (${error.code ?? 'ошибка сети'}): ${error.message}. Проверьте интернет, VPN и антивирус.`);
  }
  if (error instanceof HttpError) {
    const details = error.body ? ` ${error.body.slice(0, 300)}` : '';
    const reasons = {
      400: 'Сервер отклонил запрос (HTTP 400). Проверьте имя модели.',
      401: 'Авторизация отклонена (HTTP 401). Проверьте ключ: aigf provider key',
      402: 'Недостаточно токенов или средств на балансе (HTTP 402).',
      403: 'Доступ запрещён (HTTP 403). Возможна блокировка по региону или неверный ключ.',
      404: 'Адрес или модель не найдены (HTTP 404). Проверьте baseUrl и имя модели.',
      429: 'Превышен лимит запросов (HTTP 429). Подождите немного и повторите.',
    };
    return new UserError(`${reasons[error.status] ?? `Ошибка сервера (HTTP ${error.status}).`}${details}`);
  }
  return error;
}

function isRetryable(error) {
  if (error instanceof TlsError) return false;
  if (error instanceof NetworkError) return true;
  return error instanceof HttpError && (error.status === 429 || error.status >= 500);
}

export class Llm {
  constructor(provider, models, name) {
    this.provider = provider;
    this.models = models;
    this.name = name;
    this.usage = { requests: 0, prompt: 0, completion: 0, total: 0 };
  }

  async ready() {
    try {
      return await this.provider.ready();
    } catch (error) {
      throw describeError(error);
    }
  }

  async ask({ system, user, tier = 'small', maxTokens = 200 }) {
    const model = tier === 'large' ? this.models.large : this.models.small;
    const delay = Number(process.env.AIGF_RETRY_DELAY_MS ?? 2000);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const { text, usage } = await this.provider.chat({ system, user, model, maxTokens });
        this.usage.requests += 1;
        this.usage.prompt += usage.prompt;
        this.usage.completion += usage.completion;
        this.usage.total += usage.total;
        return text;
      } catch (error) {
        if (isRetryable(error) && attempt < 3) {
          await sleep(delay * attempt);
          continue;
        }
        throw describeError(error);
      }
    }
  }
}

export function createLlm(opts, config = loadConfig()) {
  const name = opts.provider || config.provider;
  if (!name) throw new UserError('Провайдер не настроен. Выполните: npx ai-git-flow init (или aigf init)');
  const settings = resolveProvider(config, name);
  const provider = createProvider(settings, { insecure: opts.insecure });
  const small = opts.model || settings.models.small;
  const large = opts.prModel || settings.models.large || small;
  if (!small) {
    throw new UserError(`Для провайдера ${name} не выбрана модель. Выполните aigf init или укажите --model <имя>.`);
  }
  return new Llm(provider, { small, large }, name);
}
