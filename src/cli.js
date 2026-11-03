import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { configCommand } from './commands/config.js';
import { commitCommand } from './commands/commit.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { issueCommand } from './commands/issue.js';
import { licenseCommand } from './commands/license.js';
import { providerCommand } from './commands/provider.js';
import { readmeCommand } from './commands/readme.js';
import { loadConfig, resolveOptions } from './config.js';
import { UserError } from './errors.js';
import * as ui from './ui.js';

const OPTIONS = {
  branch: { type: 'string', short: 'b' },
  base: { type: 'string' },
  remote: { type: 'string' },
  model: { type: 'string' },
  'pr-model': { type: 'string' },
  lang: { type: 'string' },
  'max-code-groups': { type: 'string' },
  'max-diff-chars': { type: 'string' },
  type: { type: 'string' },
  author: { type: 'string' },
  year: { type: 'string' },
  labels: { type: 'string' },
  provider: { type: 'string' },
  'small-model': { type: 'string' },
  'large-model': { type: 'string' },
  'base-url': { type: 'string' },
  'auth-url': { type: 'string' },
  'key-env': { type: 'string' },
  stay: { type: 'boolean' },
  here: { type: 'boolean' },
  'no-push': { type: 'boolean' },
  'no-pr': { type: 'boolean' },
  draft: { type: 'boolean' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  dry: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  insecure: { type: 'boolean' },
  quick: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const HANDLERS = {
  commit: commitCommand,
  readme: readmeCommand,
  license: licenseCommand,
  issue: issueCommand,
  init: initCommand,
  doctor: doctorCommand,
  provider: providerCommand,
  config: configCommand,
};

const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UserError(`${error.message} Справка: aiflow help`);
  }
  const flags = {};
  for (const [name, value] of Object.entries(parsed.values)) flags[camel(name)] = value;
  return { flags, positionals: parsed.positionals };
}

export function version() {
  const file = new URL('../package.json', import.meta.url);
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

export function helpText() {
  return `AI Git Flow ${version()}: Git-ассистент на основе языковых моделей

Использование: aiflow [команда] [параметры]

Команды
  commit (по умолчанию)  ветка, коммиты по группам, push и pull request
  readme                 сгенерировать README.md по содержимому репозитория
  license                создать файл LICENSE (MIT, Apache-2.0, GPL-3.0 и другие)
  issue "описание"       превратить заметку в структурированный issue на GitHub
  init                   мастер настройки: провайдер, ключ, модели, проверка
  doctor                 диагностика окружения и проверка модели
  provider list|use|add|key|remove|models   управление провайдерами
  config show|path|set|unset                настройки по умолчанию

Параметры commit
  -b, --branch <имя>     имя новой ветки; "." оставляет текущую ветку
  --stay, --here         не создавать ветку: коммит и push в текущую ветку, без PR
  --dry-run, --dry       показать результат, ничего не менять
  -y, --yes              не спрашивать подтверждение
  --draft                создать PR как черновик
  --no-pr, --no-push     не создавать PR / не отправлять ветку
  --base <ветка>         базовая ветка для PR

Общие параметры
  --lang en|ru           язык текстов (коммиты, PR, README, issue)
  --provider <имя>       провайдер на один запуск
  --model <имя>          модель для коротких текстов
  --pr-model <имя>       модель для README, PR и issue
  --type, --author, --year   license: тип, правообладатель, год
  --labels a,b           issue: метки
  --force                перезаписать LICENSE / README.md без вопроса
  --insecure             отключить проверку TLS (небезопасно)
  -h, --help             справка
  -v, --version          версия
`;
}

export async function main(argv) {
  const { flags, positionals } = parseCli(argv);
  const [first, ...rest] = positionals;

  if (flags.version || first === 'version') {
    ui.print(version());
    return 0;
  }
  if (flags.help || first === 'help') {
    ui.print(helpText());
    return 0;
  }

  const command = first ?? 'commit';
  const handler = HANDLERS[command];
  if (!handler) throw new UserError(`Неизвестная команда "${command}". Справка: aiflow help`);

  const config = loadConfig();
  const opts = resolveOptions(flags, config);
  return handler(opts, config, rest);
}
