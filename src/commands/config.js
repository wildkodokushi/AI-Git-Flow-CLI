import { BUILTIN_DEFAULTS, configDir, configPath, saveConfig } from '../config.js';
import { UserError } from '../errors.js';
import * as ui from '../ui.js';

const COERCE = {
  lang: (v) => {
    if (v !== 'en' && v !== 'ru') throw new UserError('lang принимает значения en или ru.');
    return v;
  },
  remote: (v) => v,
  author: (v) => v,
  draft: (v) => {
    if (!/^(true|false)$/i.test(v)) throw new UserError('draft принимает значения true или false.');
    return v.toLowerCase() === 'true';
  },
  maxCodeGroups: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 2 || n > 10) throw new UserError('maxCodeGroups: целое число от 2 до 10.');
    return n;
  },
  maxDiffChars: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 500 || n > 20000) throw new UserError('maxDiffChars: целое число от 500 до 20000.');
    return n;
  },
};

export async function configCommand(opts, config, rest) {
  const [action = 'show', key, value] = rest;
  switch (action) {
    case 'path':
      ui.print(configPath());
      return 0;
    case 'show':
      ui.section('Настройки');
      ui.info(`Папка: ${configDir()}`);
      ui.info(`Активный провайдер: ${config.provider ?? 'не выбран'}`);
      ui.print(JSON.stringify({ ...BUILTIN_DEFAULTS, ...config.defaults }, null, 2));
      return 0;
    case 'set': {
      if (!key || value === undefined) throw new UserError(`Использование: aigf config set <ключ> <значение>. Ключи: ${Object.keys(COERCE).join(', ')}`);
      if (!COERCE[key]) throw new UserError(`Неизвестный ключ "${key}". Доступно: ${Object.keys(COERCE).join(', ')}`);
      config.defaults = { ...config.defaults, [key]: COERCE[key](value) };
      saveConfig(config);
      ui.ok(`${key} = ${JSON.stringify(config.defaults[key])}`);
      return 0;
    }
    case 'unset': {
      if (!key) throw new UserError('Использование: aigf config unset <ключ>');
      const { [key]: removed, ...rest2 } = config.defaults;
      config.defaults = rest2;
      saveConfig(config);
      ui.ok(removed === undefined ? `${key} не был задан.` : `${key} сброшен к значению по умолчанию.`);
      return 0;
    }
    default:
      throw new UserError(`Неизвестное действие "${action}". Доступно: show, path, set, unset.`);
  }
}
