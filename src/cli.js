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
import { helpFor } from './help.js';
import { setUiLocale, t, uiLocale } from './i18n.js';
import { showCurrentValue } from './query.js';
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

const LONG_OPTIONS = Object.keys(OPTIONS);

/** Edit distance, used only to suggest a close option name. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export function suggestOption(name) {
  let best = null;
  for (const candidate of LONG_OPTIONS) {
    const d = distance(name, candidate);
    if (d <= 2 && (!best || d < best.d)) best = { name: candidate, d };
  }
  return best ? `--${best.name}` : null;
}

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      const raw = /'(-{1,2}[^']+)'/.exec(error.message)?.[1] ?? '';
      const suggestion = suggestOption(raw.replace(/^-+/, ''));
      throw new UserError(t('cli.unknownOption', {
        option: raw,
        suggestion: suggestion ? t('cli.didYouMean', { suggestion }) : '',
      }));
    }
    throw new UserError(t('cli.badArgs', { message: error.message }));
  }
  const flags = {};
  for (const [name, value] of Object.entries(parsed.values)) flags[camel(name)] = value;
  return { flags, positionals: parsed.positionals };
}

// ---------------------------------------------------------------------------
// An option that takes a value but was given none (aigf --lang, aigf -b) shows its current value
// instead of failing.
// ---------------------------------------------------------------------------

function valueOptionName(token) {
  if (/^--[a-z-]+$/.test(token)) {
    const name = token.slice(2);
    return Object.hasOwn(OPTIONS, name) && OPTIONS[name].type === 'string' ? name : null;
  }
  if (/^-[a-zA-Z]$/.test(token)) {
    const entry = Object.entries(OPTIONS).find(([, option]) => option.short === token[1] && option.type === 'string');
    return entry ? entry[0] : null;
  }
  return null;
}

export function findMissingValue(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--') return null;
    const name = valueOptionName(argv[i]);
    if (!name) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('-')) return name;
    i += 1; // the next token is this option's value
  }
  return null;
}

/** The interface language must be known before anything is printed, even for argument errors. */
function applyUiLocale(argv, config) {
  const index = argv.findIndex((token) => token === '--ui-lang' || token.startsWith('--ui-lang='));
  if (index >= 0) {
    const value = argv[index].includes('=') ? argv[index].split('=')[1] : argv[index + 1];
    if (value === 'en' || value === 'ru') {
      setUiLocale(value);
      return;
    }
  }
  if (config.defaults.uiLang === 'en' || config.defaults.uiLang === 'ru') setUiLocale(config.defaults.uiLang);
}

export function version() {
  const file = new URL('../package.json', import.meta.url);
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

export function helpText() {
  return helpFor(uiLocale(), version());
}

export async function main(argv) {
  const config = loadConfig();
  applyUiLocale(argv, config);

  const missing = findMissingValue(argv);
  if (missing) return showCurrentValue(missing, { opts: resolveOptions({}, config), config });

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
  if (!handler) throw new UserError(t('cli.unknownCommand', { command }));

  const opts = resolveOptions(flags, config);
  return handler(opts, config, rest);
}
