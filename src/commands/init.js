import { downloadRussianCa } from '../certs.js';
import { saveConfig, saveCredential } from '../config.js';
import { UserError } from '../errors.js';
import { ghStatus, installHint } from '../gh.js';
import { gitVersion, hasCommand } from '../git.js';
import { TlsError } from '../http.js';
import { describeError } from '../llm.js';
import { PRESETS, createProvider, getApiKey, resolveProvider } from '../providers.js';
import * as ui from '../ui.js';
import { printCalibration, runCalibration } from './doctor.js';
import { Llm } from '../llm.js';

const slug = (value) => value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

async function pickModel(list, title, defaultValue) {
  if (list && list.length > 0) {
    const shown = list.slice(0, 40);
    ui.print('');
    ui.print(ui.c.white(title));
    shown.forEach((id, index) => ui.print(`${ui.c.gray(String(index + 1).padStart(2))}. ${id}`));
    if (list.length > shown.length) ui.print(ui.c.gray(`    ... и ещё ${list.length - shown.length}. Имя можно ввести вручную.`));
  }
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await ui.ask(`${list?.length ? 'Номер или имя модели' : title}${suffix}:`, defaultValue ?? '');
  const number = Number.parseInt(answer, 10);
  const picked = list && Number.isInteger(number) && number >= 1 && number <= list.length && String(number) === answer ? list[number - 1] : answer;
  if (!picked) throw new UserError('Модель не выбрана.');
  return picked;
}

async function connect(settings, opts) {
  let provider = createProvider(settings, { insecure: opts.insecure });
  try {
    await provider.ready();
    return provider;
  } catch (error) {
    if (error instanceof TlsError && settings.extraCa && !opts.insecure) {
      ui.info('Сертификат сервера не распознан. Скачиваем корневой сертификат Минцифры...');
      const saved = await downloadRussianCa();
      if (saved.length === 0) throw describeError(error);
      ui.ok(`Сертификатов сохранено: ${saved.length}`);
      provider = createProvider(settings, { insecure: opts.insecure });
      await provider.ready();
      return provider;
    }
    throw describeError(error);
  }
}

export async function initCommand(opts, config) {
  ui.banner('Мастер настройки');

  ui.section('1. Окружение');
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ui.ok(`Node.js ${process.versions.node}`);
  else ui.warn(`Node.js ${process.versions.node}: нужна версия 20 или новее.`);
  if (hasCommand('git')) ui.ok(gitVersion());
  else ui.warn('Git не найден в PATH: установите его с https://git-scm.com');
  const gh = ghStatus();
  if (gh.installed && gh.authed) ui.ok('GitHub CLI установлен и авторизован.');
  else if (gh.installed) ui.warn('GitHub CLI не авторизован. Для PR и issue выполните: gh auth login');
  else ui.warn(`GitHub CLI не найден (нужен для PR и issue, остальное работает без него): ${installHint()}`);

  ui.section('2. Провайдер модели');
  const presetNames = Object.keys(PRESETS);
  let name = opts.provider;
  if (!name) {
    if (opts.yes) throw new UserError('В режиме --yes укажите провайдера: --provider <имя>.');
    const items = [
      ...presetNames.map((n) => ({ label: PRESETS[n].label, hint: PRESETS[n].hint })),
      { label: 'Другой', hint: 'любой OpenAI-совместимый API' },
    ];
    const index = await ui.choose('Какой провайдер использовать?', items, 0);
    name = index < presetNames.length ? presetNames[index] : 'custom';
  }

  const draft = { ...(config.providers[name] ?? {}) };
  const known = Boolean(PRESETS[name] || config.providers[name]);
  if (name === 'custom' || !known) {
    if (name === 'custom') {
      name = slug(await ui.ask('Имя провайдера (латиницей, например myserver):'));
      if (!name) throw new UserError('Имя провайдера не указано.');
    }
    const baseUrl = opts.baseUrl || (await ui.ask('Базовый URL API (например, https://api.example.com/v1):'));
    if (!/^https?:\/\//i.test(baseUrl)) throw new UserError('Базовый URL должен начинаться с http:// или https://');
    const needsKey = opts.yes ? true : await ui.confirm('Нужен ключ API?', true);
    Object.assign(draft, { type: 'openai', baseUrl, needsKey });
    if (opts.keyEnv) draft.keyEnv = opts.keyEnv;
  } else {
    if (opts.baseUrl) draft.baseUrl = opts.baseUrl;
    if (opts.authUrl) draft.authUrl = opts.authUrl;
    if (opts.keyEnv) draft.keyEnv = opts.keyEnv;
  }
  const withDraft = { ...config, providers: { ...config.providers, [name]: draft } };
  let settings = resolveProvider(withDraft, name);
  ui.info(`Провайдер: ${settings.label ?? name} (${settings.baseUrl})`);

  if (settings.needsKey) {
    const existing = getApiKey(settings);
    let replace = !existing;
    if (existing && !opts.yes) replace = await ui.confirm('Ключ для этого провайдера уже найден. Заменить?', false);
    if (replace) {
      if (opts.yes) throw new UserError(`В режиме --yes задайте ключ в переменной окружения ${settings.keyEnv}.`);
      const key = await ui.askSecret(`${name === 'gigachat' ? 'Authorization key из личного кабинета GigaChat' : 'API-ключ'}:`);
      if (!key) throw new UserError('Ключ не указан.');
      saveCredential(name, key);
      if (process.env[settings.keyEnv]) ui.warn(`Переменная окружения ${settings.keyEnv} имеет приоритет над сохранённым ключом.`);
      ui.ok('Ключ сохранён.');
    } else {
      ui.info('Используется найденный ключ.');
    }
  }

  ui.section('3. Проверка подключения');
  let provider;
  try {
    provider = await connect(settings, opts);
    ui.ok('Подключение и авторизация работают.');
  } catch (error) {
    ui.warn(error.message);
    if (opts.yes || !(await ui.confirm('Сохранить настройки несмотря на ошибку?', false))) throw new UserError('Настройка прервана: подключение не удалось.');
    provider = createProvider(settings, { insecure: opts.insecure });
  }

  ui.section('4. Модели');
  let small = opts.smallModel ?? settings.models.small;
  let large = opts.largeModel ?? settings.models.large;
  if (!small) {
    if (opts.yes) throw new UserError('В режиме --yes укажите модель: --small-model <имя>.');
    let list = null;
    try {
      list = await provider.listModels();
    } catch {
      list = null;
    }
    small = await pickModel(list, 'Модель для коротких текстов (темы коммитов). Подойдёт обычная, быстрая модель, не «рассуждающая»:', undefined);
    large = await pickModel(list, 'Модель для README, PR и issue (Enter, чтобы использовать ту же):', small);
  }
  large ||= small;
  ui.info(`Короткие тексты: ${small}`);
  ui.info(`Длинные тексты: ${large}`);

  let lang = config.defaults.lang ?? opts.lang;
  if (opts.explicit.lang) lang = opts.lang;
  else if (!opts.yes) lang = (await ui.ask('Язык текстов в коммитах, PR и README (en или ru) [en]:', lang || 'en')).toLowerCase();
  if (lang !== 'en' && lang !== 'ru') throw new UserError('Язык должен быть en или ru.');

  const stored = { ...draft, models: { small, large } };
  config.providers[name] = stored;
  config.provider = name;
  config.defaults = { ...config.defaults, lang };
  saveConfig(config);
  ui.ok(`Настройки сохранены. Активный провайдер: ${name}`);

  settings = resolveProvider(config, name);
  if (!opts.quick) {
    const run = opts.yes || (await ui.confirm('Проверить модель тестовыми запросами (около 3 000 токенов)?', true));
    if (run) {
      ui.section('5. Проверка модели');
      const llm = new Llm(createProvider(settings, { insecure: opts.insecure }), { small, large }, name);
      const results = await runCalibration(llm, lang);
      printCalibration(results, llm.models);
      ui.info(`Использовано токенов: ${llm.usage.total || 'нет данных'}`);
    }
  }

  ui.section('Готово');
  ui.print('  aigf -h             справка');
  ui.print('  aigf --dry-run      показать план коммитов, ничего не меняя');
  ui.print('  aigf                ветка, коммиты, push и pull request');
  ui.print('  aigf doctor         повторная диагностика');
  return 0;
}
