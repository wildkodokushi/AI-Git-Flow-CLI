import readline from 'node:readline';
import { Writable } from 'node:stream';
import { UserError } from './errors.js';

const useColor = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor() ? `\x1b[${code}m${text}\x1b[0m` : String(text));

export const c = {
  cyan: paint(36),
  gray: paint(90),
  green: paint(32),
  yellow: paint(33),
  red: paint(31),
  white: paint(97),
};

export const print = (text = '') => process.stdout.write(`${text}\n`);

export function banner(subtitle) {
  print('');
  print(c.cyan('AI Git Flow'));
  print(c.gray(subtitle));
}

export function section(title) {
  print('');
  print(c.cyan(title));
  print(c.gray('-'.repeat([...title].length)));
}

export const info = (message) => print(`${c.gray('[INFO]  ')}${message}`);
export const ok = (message) => print(`${c.green('[OK]    ')}${message}`);
export const warn = (message) => print(`${c.yellow('[WARN]  ')}${message}`);

// ---------------------------------------------------------------------------
// Input. A TTY gets a normal readline prompt, piped stdin is consumed line by line
// (this keeps the CLI scriptable and testable).
// ---------------------------------------------------------------------------

let pipedLines = null;

async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function nextPipedLine() {
  if (pipedLines === null) {
    pipedLines = (await readAllStdin()).split(/\r?\n/);
    if (pipedLines.length && pipedLines[pipedLines.length - 1] === '') pipedLines.pop();
  }
  if (pipedLines.length === 0) {
    throw new UserError('Требуется ввод, но он недоступен. Используйте параметры командной строки (например, --yes, --branch).');
  }
  return pipedLines.shift();
}

export async function ask(question, defaultValue = '') {
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question} `);
    const line = await nextPipedLine();
    process.stdout.write(`${line}\n`);
    return line.trim() || defaultValue;
  }
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new UserError('Прервано пользователем.'));
    });
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function askSecret(question) {
  if (!process.stdin.isTTY) return ask(question);
  return new Promise((resolve, reject) => {
    const muted = new Writable({
      write(chunk, encoding, callback) {
        if (!this.muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new UserError('Прервано пользователем.'));
    });
    process.stdout.write(`${question} `);
    muted.muted = true;
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/** Yes/no question. Enter selects the default. */
export async function confirm(question, defaultYes = true) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`${question} ${hint}`)).toLowerCase();
  if (!answer) return defaultYes;
  return /^(y|yes|д|да)$/.test(answer);
}

/** Numbered menu. Returns the selected index. */
export async function choose(title, items, defaultIndex = 0) {
  print('');
  if (title) print(c.white(title));
  items.forEach((item, index) => {
    const label = typeof item === 'string' ? item : item.label;
    const hint = typeof item === 'string' ? '' : item.hint ?? '';
    print(`${c.gray(String(index + 1).padStart(2))}. ${c.white(label.padEnd(18))}${c.gray(hint)}`);
  });
  const answer = await ask(`Номер [${defaultIndex + 1}]:`, String(defaultIndex + 1));
  const number = Number.parseInt(answer, 10);
  if (!Number.isInteger(number) || number < 1 || number > items.length) throw new UserError('Некорректный выбор.');
  return number - 1;
}
