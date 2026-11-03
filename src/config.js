import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserError } from './errors.js';

export function configDir() {
  if (process.env.AIFLOW_HOME) return process.env.AIFLOW_HOME;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'aiflow');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'aiflow');
}

export const certsDir = () => path.join(configDir(), 'certs');
const fileIn = (name) => path.join(configDir(), name);
export const configPath = () => fileIn('config.json');

export const BUILTIN_DEFAULTS = Object.freeze({
  lang: 'en',
  remote: 'origin',
  maxCodeGroups: 5,
  maxDiffChars: 6000,
  draft: false,
  author: '',
});

const emptyConfig = () => ({ provider: null, providers: {}, defaults: {} });

export function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { provider: raw.provider ?? null, providers: raw.providers ?? {}, defaults: raw.defaults ?? {} };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyConfig();
    throw new UserError(`Не удалось прочитать ${configPath()}: ${error.message}`);
  }
}

export function saveConfig(config) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(fileIn('credentials.json'), 'utf8'));
  } catch {
    return {};
  }
}

function writeCredentials(credentials) {
  fs.mkdirSync(configDir(), { recursive: true });
  const file = fileIn('credentials.json');
  fs.writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Not supported on some file systems (for example FAT, Windows ACLs apply instead).
  }
}

export function saveCredential(name, key) {
  const credentials = loadCredentials();
  credentials[name] = key;
  writeCredentials(credentials);
}

export function removeCredential(name) {
  const credentials = loadCredentials();
  delete credentials[name];
  writeCredentials(credentials);
}

const asInt = (value, name, min, max) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new UserError(`Параметр ${name} должен быть целым числом от ${min} до ${max}.`);
  }
  return number;
};

/** Merges built-in defaults, the config file and command line flags (flags win). */
export function resolveOptions(flags, config) {
  const defaults = { ...BUILTIN_DEFAULTS, ...config.defaults };
  const pick = (key, fallback) => (flags[key] !== undefined ? flags[key] : fallback);

  const lang = pick('lang', defaults.lang);
  if (lang !== 'en' && lang !== 'ru') throw new UserError('Параметр --lang принимает значения en или ru.');

  return {
    lang,
    remote: pick('remote', defaults.remote),
    maxCodeGroups: asInt(pick('maxCodeGroups', defaults.maxCodeGroups), '--max-code-groups', 2, 10),
    maxDiffChars: asInt(pick('maxDiffChars', defaults.maxDiffChars), '--max-diff-chars', 500, 20000),
    draft: Boolean(pick('draft', defaults.draft)),
    author: pick('author', defaults.author),
    branch: flags.branch,
    base: flags.base,
    model: flags.model,
    prModel: flags.prModel,
    provider: flags.provider,
    type: flags.type,
    year: flags.year !== undefined ? asInt(flags.year, '--year', 1970, 2100) : new Date().getFullYear(),
    labels: flags.labels,
    stay: Boolean(flags.stay || flags.here),
    noPush: Boolean(flags.noPush),
    noPr: Boolean(flags.noPr),
    force: Boolean(flags.force),
    dryRun: Boolean(flags.dryRun || flags.dry),
    yes: Boolean(flags.yes),
    insecure: Boolean(flags.insecure),
    quick: Boolean(flags.quick),
    smallModel: flags.smallModel,
    largeModel: flags.largeModel,
    baseUrl: flags.baseUrl,
    authUrl: flags.authUrl,
    keyEnv: flags.keyEnv,
    explicit: {
      lang: flags.lang !== undefined,
    },
  };
}
