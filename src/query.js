import { currentBranch, defaultBranch, git, hasCommand, userName } from './git.js';
import { t, uiLocale } from './i18n.js';
import { resolveProvider } from './providers.js';
import * as ui from './ui.js';

const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** null when the folder is not a Git repository. */
function repoBranch() {
  if (!hasCommand('git')) return null;
  if (git(['rev-parse', '--is-inside-work-tree']).code !== 0) return null;
  return currentBranch();
}

function modelsOf(config) {
  if (!config.provider) return {};
  try {
    return resolveProvider(config, config.provider).models;
  } catch {
    return {};
  }
}

/**
 * What a value option reports when it is used without a value.
 * A function returns the current value; null means "not available here" (outside a repository),
 * an empty string means "not set".
 */
const CURRENT = {
  lang: ({ opts }) => opts.lang,
  uiLang: () => uiLocale(),
  branch: () => repoBranch(),
  base: ({ opts }) => {
    const branch = repoBranch();
    if (branch === null) return null;
    return branch === 'HEAD' ? defaultBranch(opts.remote, branch) : branch;
  },
  remote: ({ opts }) => opts.remote,
  provider: ({ config }) => config.provider ?? '',
  model: ({ config }) => modelsOf(config).small ?? '',
  prModel: ({ config }) => {
    const models = modelsOf(config);
    return models.large ?? models.small ?? '';
  },
  author: ({ opts }) => opts.author || userName() || '',
  year: ({ opts }) => String(opts.year),
  maxCodeGroups: ({ opts }) => String(opts.maxCodeGroups),
  maxDiffChars: ({ opts }) => String(opts.maxDiffChars),
  prMaxChars: ({ opts }) => String(opts.prMaxChars),
};

/** Options that have no meaningful "current value": the tip shows how to use them. */
const EXAMPLES = {
  type: 'aigf license --type mit   (mit, apache-2.0, gpl-3.0, bsd-3-clause, isc ...)',
  labels: 'aigf issue "Button does nothing" --labels bug,ui',
  smallModel: 'aigf init --small-model <model>',
  largeModel: 'aigf init --large-model <model>',
  baseUrl: 'aigf init --provider <name> --base-url https://api.example.com/v1',
  authUrl: 'aigf init --provider gigachat --auth-url https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
  keyEnv: 'aigf init --provider <name> --key-env MY_API_KEY',
};

const flagLabel = (name) => (name === 'branch' ? '-b, --branch' : `--${name}`);

/** Shows the current value of an option that was given without a value. Returns the exit code. */
export function showCurrentValue(optionName, ctx) {
  const key = camel(optionName);
  const compute = CURRENT[key];

  if (!compute) {
    ui.tip(t('tip.needsValue', { flag: `--${optionName}`, example: EXAMPLES[key] ?? `aigf --${optionName} <value>` }));
    return 1;
  }

  const value = compute(ctx);
  if (value === null) {
    ui.tip(t('tip.notRepo'));
    return 0;
  }
  ui.tip(t('tip.current', {
    title: t(`tip.title.${key}`),
    flag: flagLabel(optionName),
    value: value === '' ? t('tip.none') : value,
  }));
  ui.tip(t('tip.change', { how: t(`tip.how.${key}`) }));
  return 0;
}
