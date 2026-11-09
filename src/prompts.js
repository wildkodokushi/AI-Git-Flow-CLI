import { applyImperative, toSubject } from './text.js';

export const langName = (lang) => (lang === 'ru' ? 'Russian' : 'English');

// ---------------------------------------------------------------------------
// Commit subjects
// ---------------------------------------------------------------------------

export function commitPrompt(group, context, lang) {
  const files = group.files.slice(0, 30).map((f) => `- ${f}`).join('\n');
  const task =
    group.category === 'code'
      ? [
          'Write a one-line commit message in the format "<type>: <subject>".',
          'Allowed types: feat (new functionality), fix (bug fix), refactor (restructuring without behaviour change), perf (performance improvement).',
        ]
      : ['Write only the subject of a commit message. The type prefix is added separately, so do not include "feat:", "docs:" or similar.'];
  const rules = [
    `Subject language: ${langName(lang)}.`,
    'Use the imperative mood ("add", "fix", "update") and never the past tense ("added", "fixed"). Start with a lowercase letter, no trailing period.',
    'Keep the subject under 60 characters.',
    'Describe what changed, not which files were touched.',
    'Reply with a single line and nothing else.',
  ];
  return {
    system:
      'You are a senior software engineer who writes precise Git commit messages in the Conventional Commits style. Never add quotes, markdown or explanations.',
    user: [...task, ...rules, '', 'Changed files:', files, '', 'Diff summary:', context].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Pull request
// ---------------------------------------------------------------------------

/**
 * Concise mode asks for a title and a list of changes. Deep mode also gets the diff and asks
 * for manual checks and notes for the reviewer.
 */
export function prPrompt({ lang, subjects, stat, patch, deep }) {
  const layout = [
    'TITLE: <pull request title in Conventional Commits style, at most 70 characters, no trailing period>',
    'DONE:',
    '- <what changed, one short sentence per item, 3 to 6 items>',
  ];
  if (deep) {
    layout.push(
      'CHECKS:',
      '- <a concrete manual check a reviewer can run, based only on these changes, 2 to 4 items>',
      'NOTES:',
      '- <risks, breaking changes or follow-up work; write "none" if there are none>',
    );
  }
  const rules = [
    'Plain text only: no markdown headings, no code fences, no commentary before or after the layout.',
    'Describe only what is visible in the input. Do not invent features, tests or results that are not in the diff.',
    `Language of every item: ${langName(lang)}.`,
  ];
  if (deep) rules.push('Name concrete files or functions in DONE and CHECKS items when that helps the reviewer.');
  return {
    system: 'You write precise, factual pull request descriptions for software engineers. Follow the requested layout exactly.',
    user: [
      'Write the pull request text for the changes below.',
      'Layout:',
      ...layout,
      'Rules:',
      ...rules,
      '',
      'Commits:',
      ...subjects.map((s) => `- ${s}`),
      '',
      'Diff summary:',
      stat,
      ...(patch ? ['', 'Diff:', patch] : []),
    ].join('\n'),
  };
}

const PR_KEYWORDS = /^(TITLE|DONE|CHECKS|NOTES)\s*:\s*(.*)$/i;
const NONE = /^(none|нет)\.?$/i;

export function parsePr(answer, lang) {
  const result = { title: null, done: [], checks: [], notes: [] };
  let section = null;
  for (const raw of String(answer ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const keyword = PR_KEYWORDS.exec(line);
    if (keyword) {
      section = keyword[1].toUpperCase();
      if (section === 'TITLE') result.title = keyword[2];
      continue;
    }
    const bullet = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (bullet && section && section !== 'TITLE') {
      const item = bullet[1].trim();
      if (!NONE.test(item)) result[section.toLowerCase()].push(item);
    }
  }
  if (!result.title) {
    const firstLine = String(answer ?? '').split(/\r?\n/).find((l) => l.trim() && !PR_KEYWORDS.test(l.trim()));
    result.title = firstLine ?? null;
  }
  result.title = result.title ? applyImperative(toSubject(result.title, 72) ?? '', lang) || null : null;
  result.done = result.done.slice(0, 6);
  result.checks = result.checks.slice(0, 4);
  result.notes = result.notes.slice(0, 5);
  return result;
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

export function readmePrompt(info, tree, excerpt, lang) {
  return {
    system: 'You write accurate, concise README content for software projects. You never invent facts.',
    user: [
      'Analyse the repository summary below and write two things for its README file.',
      'Output format, plain text without markdown headings:',
      'DESCRIPTION: one or two sentences describing what the project is and does.',
      'FEATURES:',
      '- three to six short bullet points describing what the project offers',
      'Rules:',
      'Describe only what is visible in the input. Do not invent features, URLs, badges, authors or installation steps.',
      'If the purpose is unclear, state what the files show (for example, a static website built with HTML and CSS) and use fewer bullet points.',
      `Language: ${langName(lang)}.`,
      '',
      `Project name: ${info.name}`,
      `Technologies detected: ${info.stack.join(', ')}`,
      `Existing description: ${info.description ?? ''}`,
      '',
      'File tree:',
      tree.slice(0, 3000),
      '',
      'Key file excerpts:',
      excerpt,
    ].join('\n'),
  };
}

export function parseReadme(answer) {
  const text = String(answer ?? '');
  const description = /DESCRIPTION:\s*([\s\S]+?)\s*(?:FEATURES:|$)/i.exec(text)?.[1]?.trim() ?? null;
  const features = text
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim())
    .slice(0, 6);
  return { description, features };
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export function issuePrompt({ request, branch, recent, topLevel }, lang) {
  return {
    system: 'You are a careful engineering assistant who writes clear, factual GitHub issues.',
    user: [
      'Turn the developer note below into a GitHub issue.',
      'Output format, plain text, no code fences:',
      'TYPE: one of bug, feature, task',
      'TITLE: a concise title, at most 80 characters, no trailing period',
      'BODY:',
      '<issue body in markdown>',
      'Body structure:',
      '- bug: "## Description", "## Steps to reproduce", "## Expected behavior", "## Actual behavior"',
      '- feature: "## Description", "## Motivation", "## Acceptance criteria" as a checklist',
      '- task: "## Description", "## Tasks" as a checklist, "## Acceptance criteria" as a checklist',
      'Rules:',
      'Use only facts from the note. Where details are unknown, write "To be clarified." instead of inventing them.',
      `Language: ${langName(lang)}. Keep markdown headings in English.`,
      '',
      'Developer note:',
      request,
      '',
      `Current branch: ${branch}`,
      'Recent commits:',
      recent,
      `Top-level files and folders: ${topLevel.join(', ')}`,
    ].join('\n'),
  };
}

export function parseIssue(answer) {
  const text = String(answer ?? '');
  let type = 'task';
  const typeMatch = /^\s*TYPE:\s*(\w+)/im.exec(text);
  if (typeMatch && ['bug', 'feature', 'task'].includes(typeMatch[1].toLowerCase())) type = typeMatch[1].toLowerCase();

  let title = /^\s*TITLE:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? null;
  if (title) {
    title = title.replace(/^["'`]+|["'`]+$/g, '').replace(/\.+$/, '');
    if (title.length > 80) title = title.slice(0, 80).trim();
  }

  let body = null;
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*BODY:/.test(line));
  if (index >= 0) {
    const first = lines[index].replace(/^\s*BODY:\s*/, '');
    body = [first, ...lines.slice(index + 1)].join('\n').trim();
    body = body.replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
  }
  return { type, title, body };
}
