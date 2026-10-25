import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp } from '../server/app.js';
import { createDeps, closeDeps, type Deps } from '../server/deps.js';
import { startReportWorker, csvCell } from '../server/reports.js';
const database = process.env.DATABASE_URL;
if (!database || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(database).hostname))
  throw new Error('Integration tests require the isolated local database.');
let deps: Deps, server: Server, base: string, worker: ReturnType<typeof startReportWorker> | null;
let alice = '',
  bob = '',
  aliceId = '',
  bobId = '',
  projectId = '',
  taskId = '',
  version = 1;
const suffix = randomUUID(),
  password = 'Local-test-password-43';
const emailA = `alice-${suffix}@example.test`,
  emailB = `bob-${suffix}@example.test`;
async function cacheReady() {
  if (deps.cache && deps.cache.status !== 'ready') await once(deps.cache, 'ready');
}
async function start() {
  await new Promise<void>((resolve) => {
    server = createApp(deps).listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
}
async function request(path: string, method = 'GET', body?: unknown, cookie = '', origin?: string) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const content =
    response.status === 204
      ? null
      : response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : await response.text();
  return {
    status: response.status,
    body: content,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
    headers: response.headers,
  };
}
before(async () => {
  deps = createDeps();
  await cacheReady();
  worker = startReportWorker(deps.pool, process.env.REDIS_URL!);
  await worker.waitUntilReady();
  await start();
});
after(async () => {
  await worker?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const id of [aliceId, bobId]) {
    if (id) {
      await deps.cache?.del(`delivery:workspace:${id}`).catch(() => {});
      await deps.pool.query('DELETE FROM users WHERE id=$1', [id]);
    }
  }
  await closeDeps(deps);
});
test('anonymous access can read samples but cannot read a private workspace', async () => {
  assert.equal((await request('/api/workspace')).status, 401);
  const sample = await request('/api/demo');
  assert.equal(sample.status, 200);
  assert.equal(sample.body.sample, true);
});
test('registration hashes passwords and issues HttpOnly sessions', async () => {
  const a = await request('/api/auth/register', 'POST', {
    name: 'Alice QA',
    email: emailA,
    password,
  });
  assert.equal(a.status, 201);
  alice = a.cookie;
  aliceId = a.body.id;
  assert.match(a.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(a.headers.get('set-cookie')!, /SameSite=Lax/);
  const row = await deps.pool.query('SELECT password_hash FROM users WHERE id=$1', [aliceId]);
  assert.notEqual(row.rows[0].password_hash, password);
  const b = await request('/api/auth/register', 'POST', {
    name: 'Bob QA',
    email: emailB,
    password,
  });
  assert.equal(b.status, 201);
  bob = b.cookie;
  bobId = b.body.id;
});
test('project creation and task creation persist data', async () => {
  const p = await request(
    '/api/projects',
    'POST',
    { name: 'QA project', description: 'Disposable integration records' },
    alice,
  );
  assert.equal(p.status, 201);
  projectId = p.body.id;
  const task = await request(
    `/api/projects/${projectId}/tasks`,
    'POST',
    {
      tasks: [
        {
          title: 'Verify saved state',
          description: 'Keep this description',
          priority: 'high',
          dueDate: '2026-12-01',
        },
      ],
    },
    alice,
  );
  assert.equal(task.status, 201);
  taskId = task.body[0].id;
  assert.equal(
    (await request('/api/workspace', 'GET', undefined, alice)).body.tasks[0].dueDate,
    '2026-12-01',
  );
});
test('cached reads are invalidated after task mutations', async () => {
  await request('/api/workspace', 'GET', undefined, alice);
  assert.ok(await deps.cache!.get(`delivery:workspace:${aliceId}`));
  const change = await request(`/api/tasks/${taskId}`, 'PATCH', { status: 'done', version }, alice);
  assert.equal(change.status, 200);
  version = change.body.version;
  assert.equal(change.body.description, 'Keep this description');
  assert.equal(change.body.priority, 'high');
  assert.equal(await deps.cache!.get(`delivery:workspace:${aliceId}`), null);
  assert.equal(
    (await request('/api/workspace', 'GET', undefined, alice)).body.tasks[0].status,
    'done',
  );
});
test('stale updates return conflict and cannot overwrite newer changes', async () => {
  assert.equal(
    (
      await request(
        `/api/tasks/${taskId}`,
        'PATCH',
        { title: 'Should not overwrite', version: 1 },
        alice,
      )
    ).status,
    409,
  );
  const [a, b] = await Promise.all([
    request(
      `/api/tasks/${taskId}`,
      'PATCH',
      { description: 'First concurrent update', version },
      alice,
    ),
    request(
      `/api/tasks/${taskId}`,
      'PATCH',
      { description: 'Second concurrent update', version },
      alice,
    ),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  version = (a.status === 200 ? a : b).body.version;
});
test('other users cannot read or mutate private projects and tasks', async () => {
  const workspace = await request('/api/workspace', 'GET', undefined, bob);
  assert.equal(workspace.body.projects.length, 0);
  assert.equal(workspace.body.tasks.length, 0);
  assert.equal(
    (await request(`/api/tasks/${taskId}`, 'PATCH', { status: 'todo', version }, bob)).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/api/projects/${projectId}/tasks`,
        'POST',
        { tasks: [{ title: 'Not allowed' }] },
        bob,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request(`/api/projects/${projectId}/reports`, 'POST', undefined, bob)).status,
    404,
  );
});
test('invalid batches and impossible dates are rejected without partial inserts', async () => {
  const before = (await request('/api/workspace', 'GET', undefined, alice)).body.tasks.length;
  assert.equal(
    (
      await request(
        `/api/projects/${projectId}/tasks`,
        'POST',
        { tasks: [{ title: 'Valid task' }, { title: 'x' }] },
        alice,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/api/projects/${projectId}/tasks`,
        'POST',
        { tasks: [{ title: 'Invalid date task', dueDate: '2026-02-30' }] },
        alice,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request('/api/workspace', 'GET', undefined, alice)).body.tasks.length,
    before,
  );
});
test('BullMQ worker generates a downloadable report with CSV formula escaping', async () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  await request(
    `/api/projects/${projectId}/tasks`,
    'POST',
    { tasks: [{ title: '=SUM(A1:A2)' }] },
    alice,
  );
  const created = await request(`/api/projects/${projectId}/reports`, 'POST', undefined, alice);
  assert.equal(created.status, 202);
  const reportId = created.body.id;
  let state = '';
  for (let i = 0; i < 50; i++) {
    const rows = await request(`/api/projects/${projectId}/reports`, 'GET', undefined, alice);
    state = rows.body.find((r: { id: string }) => r.id === reportId)?.state;
    if (state === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(state, 'completed');
  const report = await request(`/api/reports/${reportId}/download`, 'GET', undefined, alice);
  assert.equal(report.status, 200);
  assert.match(report.body, /'=SUM\(A1:A2\)/);
  assert.match(report.headers.get('content-disposition')!, /attachment/);
  assert.equal(
    (await request(`/api/reports/${reportId}/download`, 'GET', undefined, bob)).status,
    404,
  );
});
test('cross-origin mutations are rejected', async () => {
  assert.equal(
    (
      await request(
        '/api/projects',
        'POST',
        { name: 'Blocked' },
        alice,
        'https://untrusted.example',
      )
    ).status,
    403,
  );
});
test('logout invalidates a session and login creates a fresh session', async () => {
  assert.equal((await request('/api/auth/logout', 'POST', undefined, alice)).status, 204);
  assert.equal((await request('/api/workspace', 'GET', undefined, alice)).status, 401);
  assert.equal(
    (await request('/api/auth/login', 'POST', { email: emailA, password: 'wrong-password-here' }))
      .status,
    401,
  );
  const login = await request('/api/auth/login', 'POST', { email: emailA, password });
  assert.equal(login.status, 200);
  assert.notEqual(login.cookie, alice);
  alice = login.cookie;
});
test('a new API instance preserves account, session and project data; inline exports also work', async () => {
  await worker!.close();
  worker = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDeps(deps);
  deps = createDeps({ database, redis: process.env.REDIS_URL, mode: 'inline' });
  await cacheReady();
  await deps.cache!.del(`delivery:workspace:${aliceId}`);
  await start();
  const workspace = await request('/api/workspace', 'GET', undefined, alice);
  assert.equal(workspace.status, 200);
  assert.ok(workspace.body.projects.some((p: { id: string }) => p.id === projectId));
  const report = await request(`/api/projects/${projectId}/reports`, 'POST', undefined, alice);
  assert.equal(report.status, 202);
  assert.equal(
    (await request(`/api/reports/${report.body.id}/download`, 'GET', undefined, alice)).status,
    200,
  );
});
