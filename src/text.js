import { META } from './grouping.js';

/** First meaningful line, stripped of quotes, list markers and the trailing period. */
export function toSubject(text, maxLen = 64) {
  if (!text || !String(text).trim()) return null;
  let line = String(text)
    .split(/\r?\n/)
    .find((l) => l.trim());
  if (!line) return null;
  line = line.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  line = line.replace(/^[-*]\s+/, '').replace(/\.+$/, '');
  if (line.length > maxLen) {
    line = line.slice(0, maxLen);
    const cut = line.lastIndexOf(' ');
    if (cut > 20) line = line.slice(0, cut);
  }
  if (line.length > 1 && /[A-Z]/.test(line[0]) && /[a-z]/.test(line[1])) {
    line = line[0].toLowerCase() + line.slice(1);
  }
  return line.trim() || null;
}

const VERBS = [
  'add', 'update', 'fix', 'remove', 'implement', 'change', 'create', 'improve', 'refactor', 'introduce', 'move',
  'rename', 'delete', 'configure', 'enable', 'disable', 'adjust', 'correct', 'optimize', 'replace', 'resolve',
  'integrate', 'simplify', 'extend', 'use', 'handle', 'apply', 'support', 'rewrite', 'clean', 'merge', 'align',
  'switch', 'restructure', 'expand', 'reorganize', 'document', 'polish', 'tweak', 'harden', 'bump', 'upgrade',
  'migrate', 'install', 'include', 'ensure', 'prepare', 'build', 'make', 'display', 'show', 'organize', 'rework',
  'extract', 'split', 'set', 'allow', 'prevent', 'reduce', 'separate', 'initialize', 'define', 'provide', 'streamline',
];

let imperativeMap = null;

export function getImperativeMap() {
  if (imperativeMap) return imperativeMap;
  const map = new Map();
  for (const verb of VERBS) {
    let past;
    let third;
    let ing;
    if (/[^aeiou]y$/.test(verb)) {
      const stem = verb.slice(0, -1);
      [past, third, ing] = [`${stem}ied`, `${stem}ies`, `${verb}ing`];
    } else if (/e$/.test(verb)) {
      [past, third, ing] = [`${verb}d`, `${verb}s`, `${verb.slice(0, -1)}ing`];
    } else if (/(s|x|ch|sh)$/.test(verb)) {
      [past, third, ing] = [`${verb}ed`, `${verb}es`, `${verb}ing`];
    } else {
      [past, third, ing] = [`${verb}ed`, `${verb}s`, `${verb}ing`];
    }
    for (const form of [past, third, ing]) if (!map.has(form)) map.set(form, verb);
  }
  for (const [form, verb] of [['setting', 'set'], ['splitting', 'split'], ['built', 'build'], ['made', 'make'], ['rewrote', 'rewrite'], ['rewritten', 'rewrite']]) {
    map.set(form, verb);
  }
  imperativeMap = map;
  return map;
}

/** Models like to answer "added x"; Conventional Commits expects "add x". English only. */
export function applyImperative(text, lang) {
  if (lang !== 'en' || !text || !text.trim()) return text;
  const match = /^((?:[a-z]+(?:\([^)]*\))?!?:\s*)?)([A-Za-z]+)(.*)$/s.exec(text);
  if (!match) return text;
  const base = getImperativeMap().get(match[2].toLowerCase());
  return base ? `${match[1]}${base}${match[3]}` : text;
}

const FALLBACK = {
  deps: 'update project dependencies',
  ci: 'update CI and container configuration',
  config: 'update project configuration',
  assets: 'update static assets',
  style: 'update styles',
  test: 'update tests',
  docs: 'update documentation',
};

const prefixOf = (type, scope) => (scope ? `${type}(${scope})` : type);

export function fallbackMessage(group) {
  if (group.category === 'code') return `${prefixOf('feat', group.scope)}: update ${group.scope ?? 'project code'}`;
  const meta = META[group.category];
  return `${prefixOf(meta.type, meta.scope)}: ${FALLBACK[group.category]}`;
}

/** Turns the raw model answer into a validated Conventional Commits line. */
export function buildCommitMessage(group, answer, lang) {
  const line = toSubject(answer, 100);
  if (!line) return fallbackMessage(group);

  const typed = /^([a-z]+)(\([^)]*\))?!?:\s*(.+)$/.exec(line);
  let subject = line;
  let prefix;
  if (group.category === 'code') {
    let type = 'feat';
    if (typed) {
      if (['feat', 'fix', 'refactor', 'perf'].includes(typed[1])) type = typed[1];
      subject = typed[3];
    }
    prefix = prefixOf(type, group.scope);
  } else {
    if (typed) subject = typed[3];
    const meta = META[group.category];
    prefix = prefixOf(meta.type, meta.scope);
  }
  subject = toSubject(subject, 64);
  if (!subject) return fallbackMessage(group);
  return `${prefix}: ${applyImperative(subject, lang)}`;
}
