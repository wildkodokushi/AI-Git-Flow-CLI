import { removeCredential, saveConfig, saveCredential } from '../config.js';
import { UserError } from '../errors.js';
import { describeError } from '../llm.js';
import { PRESETS, createProvider, getApiKey, providerNames, resolveProvider } from '../providers.js';
import * as ui from '../ui.js';
import { initCommand } from './init.js';

function listProviders(config) {
  ui.section('Провайдеры');
  for (const name of providerNames(config)) {
    const settings = resolveProvider(config, name);
    const active = config.provider === name ? ui.c.green('*') : ' ';
    const key = settings.needsKey ? (getApiKey(settings) ? 'ключ есть' : 'нет ключа') : 'ключ не нужен';
    const models = settings.models.small ? `${settings.models.small}${settings.models.large && settings.models.large !== settings.models.small ? ` / ${settings.models.large}` : ''}` : 'модель не выбрана';
    ui.print(`${active} ${ui.c.white(name.padEnd(12))} ${ui.c.gray(key.padEnd(14))} ${ui.c.gray(models)}`);
  }
  ui.print('');
  ui.info('* активный провайдер. Сменить: aigf provider use <имя>. Добавить свой: aigf provider add <имя> --base-url <url>');
}

export async function providerCommand(opts, config, rest) {
  const [action = 'list', name] = rest;
  const target = name ?? opts.provider ?? config.provider;

  switch (action) {
    case 'list':
      listProviders(config);
      return 0;

    case 'use': {
      if (!name) throw new UserError('Укажите имя провайдера: aigf provider use <имя>');
      resolveProvider(config, name);
      config.provider = name;
      saveConfig(config);
      ui.ok(`Активный провайдер: ${name}`);
      return 0;
    }

    case 'add':
      if (!name) throw new UserError('Укажите имя провайдера: aigf provider add <имя> --base-url <url>');
      return initCommand({ ...opts, provider: name }, config);

    case 'key': {
      if (!target) throw new UserError('Провайдер не выбран. Выполните: aigf init');
      const settings = resolveProvider(config, target);
      if (!settings.needsKey) {
        ui.info(`Провайдеру ${target} ключ не нужен.`);
        return 0;
      }
      const key = await ui.askSecret(`Новый ключ для ${target}:`);
      if (!key) throw new UserError('Ключ не указан. Ничего не изменено.');
      saveCredential(target, key);
      ui.ok('Ключ сохранён.');
      if (process.env[settings.keyEnv]) ui.warn(`Переменная окружения ${settings.keyEnv} имеет приоритет над сохранённым ключом.`);
      return 0;
    }

    case 'remove': {
      if (!name) throw new UserError('Укажите имя провайдера: aigf provider remove <имя>');
      if (PRESETS[name]) {
        delete config.providers[name];
        removeCredential(name);
        saveConfig(config);
        ui.ok(`Настройки провайдера ${name} сброшены (встроенный пресет остаётся доступным).`);
        return 0;
      }
      if (!config.providers[name]) throw new UserError(`Провайдер ${name} не найден.`);
      delete config.providers[name];
      removeCredential(name);
      if (config.provider === name) config.provider = null;
      saveConfig(config);
      ui.ok(`Провайдер ${name} удалён.`);
      return 0;
    }

    case 'models': {
      if (!target) throw new UserError('Провайдер не выбран. Выполните: aigf init');
      const settings = resolveProvider(config, target);
      try {
        const provider = createProvider(settings, { insecure: opts.insecure });
        await provider.ready();
        const list = await provider.listModels();
        if (!list) ui.warn('Провайдер не поддерживает список моделей. Укажите имя модели вручную в aigf init.');
        else list.forEach((id) => ui.print(id));
      } catch (error) {
        throw describeError(error);
      }
      return 0;
    }

    default:
      throw new UserError(`Неизвестное действие "${action}". Доступно: list, use, add, key, remove, models.`);
  }
}

