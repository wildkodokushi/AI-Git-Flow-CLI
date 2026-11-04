import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Llm, describeError } from '../src/llm.js';
import { HttpError, NetworkError, TlsError, request } from '../src/http.js';
import { GigaChatProvider, OpenAIProvider, resolveProvider } from '../src/providers.js';
import { UserError } from '../src/errors.js';
import { startMockLlm } from './helpers.js';

process.env.AIGF_RETRY_DELAY_MS = '0';

let mock;
let behaviour = () => 'hello';
before(async () => {
  mock = await startMockLlm((prompt, body, requests) => behaviour(prompt, body, requests));
});
after(() => mock.close());

const settings = (extra = {}) => ({ name: 'mock', baseUrl: `${mock.url}/v1`, needsKey: false, ...extra });

test('OpenAIProvider sends an OpenAI-compatible request and reads usage', async () => {
  behaviour = () => 'hello world';
  const provider = new OpenAIProvider(settings(), 'sk-test');
  const { text, usage } = await provider.chat({ system: 'sys', user: 'usr', model: 'm1', maxTokens: 50 });
  assert.equal(text, 'hello world');
  assert.deepEqual(usage, { prompt: 10, completion: 5, total: 15 });
  const sent = mock.requests.at(-1);
  assert.equal(sent.headers.authorization, 'Bearer sk-test');
  const body = JSON.parse(sent.raw);
  assert.equal(body.model, 'm1');
  assert.equal(body.max_tokens, 50);
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
});

test('OpenAIProvider adapts to max_completion_tokens and temperature restrictions', async () => {
  let calls = 0;
  behaviour = (prompt, body) => {
    calls += 1;
    if ('max_tokens' in body) return { status: 400, body: { error: { message: "Use 'max_completion_tokens' instead" } } };
    if ('temperature' in body) return { status: 400, body: { error: { message: 'temperature is not supported' } } };
    return 'adapted';
  };
  const provider = new OpenAIProvider(settings(), null);
  const { text } = await provider.chat({ system: 's', user: 'u', model: 'm', maxTokens: 10 });
  assert.equal(text, 'adapted');
  assert.equal(calls, 3);
  assert.equal(provider.tokenParam, 'max_completion_tokens');
  assert.equal(provider.useTemperature, false);
});

test('OpenAIProvider gives a reasoning model more room when the budget ran out', async () => {
  const budgets = [];
  behaviour = (prompt, body) => {
    budgets.push(body.max_tokens);
    return body.max_tokens < 1000 ? { emptyLength: true } : 'finally an answer';
  };
  const provider = new OpenAIProvider(settings(), null);
  const { text } = await provider.chat({ system: 's', user: 'u', model: 'm', maxTokens: 80 });
  assert.equal(text, 'finally an answer');
  assert.deepEqual(budgets, [80, 1024]);
});

test('OpenAIProvider rejects an empty answer with advice', async () => {
  behaviour = () => '';
  const provider = new OpenAIProvider(settings(), null);
  await assert.rejects(() => provider.chat({ system: 's', user: 'u', model: 'm', maxTokens: 80 }), /не «рассуждающие»/);
});

test('OpenAIProvider lists models sorted', async () => {
  const provider = new OpenAIProvider(settings(), null);
  assert.deepEqual(await provider.listModels(), ['model-a', 'model-b']);
});

test('GigaChatProvider exchanges the authorization key for a token and caches it', async () => {
  behaviour = () => 'giga says hi';
  const provider = new GigaChatProvider(settings({ authUrl: `${mock.url}/api/v2/oauth`, scope: 'GIGACHAT_API_PERS' }), 'BASE64KEY');
  const before = mock.requests.length;
  await provider.chat({ system: 's', user: 'u', model: 'GigaChat-2', maxTokens: 10 });
  await provider.chat({ system: 's', user: 'u', model: 'GigaChat-2', maxTokens: 10 });

  const mine = mock.requests.slice(before);
  const oauth = mine.filter((r) => r.url.endsWith('/oauth'));
  assert.equal(oauth.length, 1, 'token is requested once');
  assert.equal(oauth[0].headers.authorization, 'Basic BASE64KEY');
  assert.equal(oauth[0].headers['content-type'], 'application/x-www-form-urlencoded');
  assert.match(oauth[0].headers.rquid, /^[0-9a-f-]{36}$/);
  assert.equal(oauth[0].raw, 'scope=GIGACHAT_API_PERS');
  const chats = mine.filter((r) => r.url.endsWith('/chat/completions'));
  assert.equal(chats.length, 2);
  assert.equal(chats[0].headers.authorization, 'Bearer tok-123');
});

test('Llm retries on 5xx and 429 but reports other errors in plain language', async () => {
  let attempts = 0;
  behaviour = () => {
    attempts += 1;
    return attempts < 3 ? { status: 503, body: { error: 'busy' } } : 'recovered';
  };
  const llm = new Llm(new OpenAIProvider(settings(), null), { small: 'a', large: 'b' }, 'mock');
  assert.equal(await llm.ask({ system: 's', user: 'u' }), 'recovered');
  assert.equal(attempts, 3);
  assert.equal(llm.usage.requests, 1);

  behaviour = () => ({ status: 401, body: { error: 'bad key' } });
  await assert.rejects(() => llm.ask({ system: 's', user: 'u' }), /401/);
});

test('describeError gives actionable messages', () => {
  assert.match(describeError(new TlsError('x', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')).message, /aigf init/);
  assert.match(describeError(new NetworkError('boom', 'ECONNREFUSED')).message, /ECONNREFUSED/);
  assert.match(describeError(new HttpError(402, '')).message, /402/);
  assert.match(describeError(new HttpError(429, '')).message, /лимит/);
  const user = new UserError('already friendly');
  assert.equal(describeError(user), user);
});

test('request reports connection errors as NetworkError', async () => {
  await assert.rejects(() => request({ url: 'http://127.0.0.1:1/x', method: 'GET', timeoutMs: 2000 }), NetworkError);
  await assert.rejects(() => request({ url: 'not a url', method: 'GET' }), NetworkError);
});

test('resolveProvider merges presets with user overrides', () => {
  const config = { providers: { gigachat: { models: { large: 'GigaChat-2-Max' } }, mine: { baseUrl: 'http://x/v1', models: { small: 'm' } } } };
  const giga = resolveProvider(config, 'gigachat');
  assert.equal(giga.type, 'gigachat');
  assert.deepEqual(giga.models, { small: 'GigaChat-2', large: 'GigaChat-2-Max' });
  const mine = resolveProvider(config, 'mine');
  assert.equal(mine.keyEnv, 'AIGF_MINE_KEY');
  assert.equal(mine.type, 'openai');
  assert.throws(() => resolveProvider(config, 'nope'), UserError);
});
