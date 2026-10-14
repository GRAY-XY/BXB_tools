import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';

// Real JSONL bridge + isolated disk + local HTTP: removing the probe or allowing
// it to save configuration/tools/remote errors breaks these assertions.
async function fixture(t, native = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bxb-setup-'));
  const calls = [];
  const secret = 'fixture-sensitive-setup-key';
  let mode = 'ok';
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, method: req.method, body: body ? JSON.parse(body) : null, key: req.headers.authorization });
    if (mode === 'timeout') return;
    if (/^\d+$/.test(mode)) { res.writeHead(Number(mode)); res.end(secret); return; }
    if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: mode === 'empty' ? [] : [{ id: 'test-model' }] })); return; }
    if (body && JSON.parse(body).stream === true) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('data: {"choices":[{"delta":{"content":"fixture assistant reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    res.end(mode === 'invalid' ? '{bad' : JSON.stringify({ choices: [{ message: { content: mode === 'blank' ? '' : 'OK' } }] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const child = spawn(process.execPath, ['backend/bridge/winui-backend.js'], { env: { ...process.env, APPDATA: root, BXB_MACOS_NATIVE: native ? '1' : '0' } });
  let seq = 0; let stderr = ''; const pending = new Map();
  child.stderr.on('data', b => stderr += b);
  readline.createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line); if (r.event === 'progress') return; pending.get(r.id)?.(r); pending.delete(r.id); });
  const invoke = (method, params = {}) => new Promise(resolve => { const id = String(++seq); pending.set(id, resolve); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  t.after(async () => { child.kill(); server.closeAllConnections(); await new Promise(r => server.close(r)); await fs.rm(root, { recursive: true, force: true }); });
  return { invoke, calls, secret, root, get stderr() { return stderr; }, setMode(m) { mode = m; }, candidate: { apiKey: secret, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelName: 'test-model', provider: { id: 'setup-test', name: 'Test' } } };
}

test('native probe sends only fixed text and never persists candidate or calls tools', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const before = (await f.invoke('modelConfig.load')).result;
  const result = await f.invoke('modelConfig.probe', { config: f.candidate });
  assert.equal(result.ok, true); assert.equal(result.result?.ok, true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, '/v1/chat/completions');
  assert.equal(f.calls[0].key, `Bearer ${f.secret}`);
  assert.deepEqual(f.calls[0].body.messages, [{ role: 'user', content: 'Reply with OK.' }]);
  assert.equal(f.calls[0].body.tools, undefined); assert.equal(f.calls[0].body.stream, false);
  assert.deepEqual((await f.invoke('modelConfig.load')).result, before);
  assert.equal(JSON.stringify(result).includes(f.secret), false); assert.equal(f.stderr.includes(f.secret), false);
  await assert.rejects(fs.access(path.join(f.root, 'bxb-homework-electron/model-config.json')));
});

test('native probe and model listing bound requests and hide remote error bodies', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  for (const mode of ['401', '403', '429', 'invalid', 'blank', 'timeout']) {
    f.setMode(mode);
    const r = await f.invoke('modelConfig.probe', { config: { ...f.candidate, timeoutMs: 100 } });
    assert.equal(r.ok, false, mode); assert.equal(JSON.stringify(r).includes(f.secret), false, mode);
  }
  f.setMode('401');
  const listed = await f.invoke('modelConfig.list', { config: f.candidate });
  assert.equal(listed.ok, false); assert.equal(JSON.stringify(listed).includes(f.secret), false);
  f.setMode('empty'); assert.deepEqual((await f.invoke('modelConfig.list', { config: f.candidate })).result.modelIds, []);
  assert.equal((await f.invoke('modelConfig.probe', { config: f.candidate })).result.ok, true);
});

test('setup commit preserves other roles, rejects stale snapshots and stores no key', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await f.invoke('modelConfig.save', { config: { modelRole: 'image_caption', provider: { id: 'image', name: 'Image', modelName: 'vision' }, enabled: true } });
  const before = (await f.invoke('modelConfig.load')).result;
  const params = { config: { ...f.candidate, provider: { ...f.candidate.provider, baseUrl: f.candidate.baseUrl, modelName: 'test-model' } }, expectedChat: before.modelRoles.chat };
  const r = await f.invoke('modelConfig.setupSave', params);
  assert.equal(r.ok, true); assert.equal(r.result.activeProviderId, 'setup-test');
  assert.deepEqual(r.result.modelRoles.image_caption, before.modelRoles.image_caption);
  assert.equal((await f.invoke('modelConfig.setupSave', params)).ok, false);
  const disk = await fs.readFile(path.join(f.root, 'bxb-homework-electron/model-config.json'), 'utf8');
  assert.equal(disk.includes(f.secret), false);
});

test('Windows modelConfig.test continues saving and checking model listing', { timeout: 10000 }, async t => {
  const f = await fixture(t, false);
  const r = await f.invoke('modelConfig.test', { config: f.candidate });
  assert.equal(r.result.ok, true); assert.equal(f.calls[0].url, '/v1/models');
  assert.equal((await f.invoke('modelConfig.load')).result.activeProviderId, 'setup-test');
});

test('native configuration parse failures hide malformed legacy secrets', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const target = path.join(f.root, 'bxb-homework-electron/model-config.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, '{"apiKey":"' + f.secret + '" bad json');
  const r = await f.invoke('modelConfig.load');
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(r).includes(f.secret), false);
  assert.match(r.error.message, /配置/);
  assert.equal(await fs.readFile(target, 'utf8'), '{"apiKey":"' + f.secret + '" bad json');
});

test('saved native setup can chat using an ephemeral Keychain key without storing it in conversations', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const before = (await f.invoke('modelConfig.load')).result;
  const provider = { id: 'setup-chat', name: 'Fixture Chat', type: 'openai', baseUrl: f.candidate.baseUrl, modelName: 'test-model' };
  assert.equal((await f.invoke('modelConfig.setupSave', { config: { provider }, expectedChat: before.modelRoles.chat })).ok, true);
  const r = await f.invoke('agent.chat', { text: 'fixture conversation', conversationId: 'setup-conversation',
    userMessageId: 'fixture-user', assistantMessageId: 'fixture-assistant', apiKeys: { chat: { 'setup-chat': f.secret } } });
  assert.equal(r.ok, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].key, `Bearer ${f.secret}`);
  assert.equal(f.calls[0].body.model, 'test-model');
  assert.equal(f.calls[0].body.messages.at(-1).content, 'fixture conversation');
  assert.equal(JSON.stringify(r).includes('fixture assistant reply'), true);
  for (const file of ['model-config.json', 'agent-conversations.json']) {
    assert.equal((await fs.readFile(path.join(f.root, 'bxb-homework-electron', file), 'utf8')).includes(f.secret), false);
  }
});
