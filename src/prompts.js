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

export function prPrompt(subjects, stat, lang) {
  return {
    system: 'You write concise, factual pull request descriptions for software engineers. Follow the requested output format exactly.',
    user: [
      'Write a pull request title and summary for the commits and diff summary below.',
      'Output format, plain text without markdown:',
      'Line 1: the pull request title in Conventional Commits style, at most 70 characters, no trailing period.',
      'Line 2 and onward: a summary of 2 to 4 sentences describing what changed and why it matters.',
      `Language of the summary: ${langName(lang)}.`,
      'Do not invent details that are not visible in the input.',
      '',
      'Commits:',
      ...subjects.map((s) => `- ${s}`),
      '',
      'Diff summary:',
      stat,
    ].join('\n'),
  };
}

export function parsePr(answer, lang) {
  const lines = String(answer ?? '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { title: null, summary: '' };
  let title = toSubject(lines[0].replace(/^(title|заголовок)\s*:\s*/i, ''), 72);
  if (title) title = applyImperative(title, lang);
  const summary = lines.slice(1).join('\n').trim().replace(/^(summary|описание)\s*:\s*/i, '');
  return { title, summary };
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
