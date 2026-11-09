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
import { setUiLocale, t, uiLocale } from './i18n.js';
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
  'deep-pr': { type: 'boolean' },
  'pr-max-chars': { type: 'string' },
  'ui-lang': { type: 'string' },
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
    throw new UserError(`${error.message} Справка: aigf help`);
  }
  const flags = {};
  for (const [name, value] of Object.entries(parsed.values)) flags[camel(name)] = value;
  return { flags, positionals: parsed.positionals };
}

export function version() {
  const file = new URL('../package.json', import.meta.url);
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

const HELP = {
  en: `AI Git Flow {version}: Git assistant powered by language models

Usage: aigf [command] [options]

Commands
  commit (default)       branch, commits by group, push and pull request
  readme                 generate README.md from the repository contents
  license                create a LICENSE file (MIT, Apache-2.0, GPL-3.0 and others)
  issue "description"    turn a short note into a structured GitHub issue
  init                   setup wizard: provider, key, models, check
  doctor                 environment check and model calibration
  provider list|use|add|key|remove|models   manage providers
  config show|path|set|unset                default settings

Commit options
  -b, --branch <name>    new branch name; "." stays on the current branch
  --stay, --here         no new branch: commit and push to the current one, no PR
  --dry-run, --dry       show the result, change nothing
  -y, --yes              do not ask for confirmation
  --draft                create the PR as a draft
  --deep-pr              richer PR: sends the diff, adds checks and notes for the reviewer
  --pr-max-chars <n>     diff size sent in deep mode (default 15000)
  --no-pr, --no-push     do not create a PR / do not push
  --base <branch>        base branch for the PR

Common options
  --lang en|ru           language of generated texts (commits, PR, README, issue)
  --ui-lang en|ru        language of the interface
  --provider <name>      provider for this run only
  --model <name>         model for short texts
  --pr-model <name>      model for README, PR and issue
  --type, --author, --year   license: type, copyright holder, year
  --labels a,b           issue: labels
  --force                overwrite LICENSE / README.md without asking
  --insecure             skip TLS verification (unsafe)
  -h, --help             help
  -v, --version          version
`,
  ru: `AI Git Flow {version}: Git-ассистент на основе языковых моделей

Использование: aigf [команда] [параметры]

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
  --deep-pr              подробный PR: в запрос передаётся diff, добавляются проверки и заметки
  --pr-max-chars <n>     размер diff в глубоком режиме (по умолчанию 15000)
  --no-pr, --no-push     не создавать PR / не отправлять ветку
  --base <ветка>         базовая ветка для PR

Общие параметры
  --lang en|ru           язык генерируемых текстов (коммиты, PR, README, issue)
  --ui-lang en|ru        язык интерфейса
  --provider <имя>       провайдер на один запуск
  --model <имя>          модель для коротких текстов
  --pr-model <имя>       модель для README, PR и issue
  --type, --author, --year   license: тип, правообладатель, год
  --labels a,b           issue: метки
  --force                перезаписать LICENSE / README.md без вопроса
  --insecure             отключить проверку TLS (небезопасно)
  -h, --help             справка
  -v, --version          версия
`,
};

export function helpText() {
  return HELP[uiLocale()].replace('{version}', version());
}

export async function main(argv) {
  const { flags, positionals } = parseCli(argv);
  const [first, ...rest] = positionals;
  const savedUiLang = loadConfig().defaults.uiLang;
  if (flags.uiLang !== undefined) setUiLocale(flags.uiLang);
  else if (savedUiLang !== undefined) setUiLocale(savedUiLang);

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
  if (!handler) throw new UserError(t('cli.unknownCommand', { command }));

  const config = loadConfig();
  const opts = resolveOptions(flags, config);
  return handler(opts, config, rest);
}
