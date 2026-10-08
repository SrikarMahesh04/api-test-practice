// =====================================================================
//  Automatic tests for the Practice API (positive AND negative)
//  - Needs Node.js 18 or newer, no installs
//  - Start the server first (node server.js), then in a SECOND terminal:
//        node api-tests.js
//  - Watch the server terminal while this runs: you will see every call.
// =====================================================================
'use strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
let passed = 0;
let failed = 0;

// ---------- small helpers ----------
// Sends one request and gives back the status, headers and body.
async function call(method, path, options = {}) {
  const { body, raw, token, headers = {} } = options;
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = raw;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const started = Date.now();
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON, fine */ }
  return { status: res.status, headers: res.headers, text, json, ms: Date.now() - started };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}
function expectStatus(res, wanted) {
  expect(res.status === wanted, `expected status ${wanted} but got ${res.status}`);
}
function expectError(res, status, code) {
  expectStatus(res, status);
  expect(res.json && res.json.code === code, `expected error code ${code} but got ${res.json && res.json.code}`);
}

// Every test starts from the same clean data (tests must not depend on each other).
async function test(name, fn) {
  try {
    await call('POST', '/reset');
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`          ${err.message}`);
  }
}
const heading = (text) => console.log(`\n=== ${text} ===`);

const validUser = (n) => ({ name: 'Test User', email: `test${n}@example.com` });

// ---------- the tests ----------
async function main() {
  try {
    await call('GET', '/health');
  } catch {
    console.log(`Cannot reach the server at ${BASE}. Start it first with:  node server.js`);
    process.exit(1);
  }

  heading('POSITIVE TESTS: things that should work (2xx and 3xx)');

  await test('GET /health returns 200', async () => {
    expectStatus(await call('GET', '/health'), 200);
  });

  await test('GET /users returns 200 and 3 starting users', async () => {
    const res = await call('GET', '/users');
    expectStatus(res, 200);
    expect(res.json.count === 3, `expected 3 users but got ${res.json.count}`);
  });

  await test('GET /users?role=admin filters the list (1 admin)', async () => {
    const res = await call('GET', '/users?role=admin');
    expectStatus(res, 200);
    expect(res.json.count === 1, `expected 1 admin but got ${res.json.count}`);
  });

  await test('GET /users/1 returns 200 with the right fields and types', async () => {
    const res = await call('GET', '/users/1');
    expectStatus(res, 200);
    const u = res.json;
    expect(typeof u.id === 'number', 'id should be a number');
    expect(typeof u.name === 'string', 'name should be text');
    expect(typeof u.email === 'string', 'email should be text');
    expect(u.name === 'Asha', `expected name Asha but got ${u.name}`);
    expect(res.headers.get('content-type').includes('application/json'), 'Content-Type should be JSON');
  });

  await test('GET /users/1 responds quickly (under 300 ms)', async () => {
    const res = await call('GET', '/users/1');
    expect(res.ms < 300, `took ${res.ms} ms`);
  });

  await test('GET /users/1 again with the ETag returns 304 and no body', async () => {
    const first = await call('GET', '/users/1');
    const etag = first.headers.get('etag');
    expect(etag, 'the first response should have an ETag header');
    const second = await call('GET', '/users/1', { headers: { 'If-None-Match': etag } });
    expectStatus(second, 304);
    expect(second.text === '', 'a 304 must have an empty body');
  });

  await test('POST /users creates a user: 201, Location header, then GET finds it', async () => {
    const res = await call('POST', '/users', { body: validUser(1) });
    expectStatus(res, 201);
    const location = res.headers.get('location');
    expect(location === `/users/${res.json.id}`, `Location header was ${location}`);
    const check = await call('GET', location);
    expectStatus(check, 200);
    expect(check.json.email === 'test1@example.com', 'the saved email does not match');
  });

  await test('PUT /users/2 replaces name and email: 200', async () => {
    const res = await call('PUT', '/users/2', { body: { name: 'Ravi Kumar', email: 'ravi.kumar@example.com' } });
    expectStatus(res, 200);
    expect(res.json.name === 'Ravi Kumar', 'name was not replaced');
  });

  await test('PUT is idempotent: sending the same PUT twice gives the same result', async () => {
    const body = { name: 'Same Again', email: 'same@example.com' };
    const a = await call('PUT', '/users/2', { body });
    const b = await call('PUT', '/users/2', { body });
    expectStatus(a, 200);
    expectStatus(b, 200);
    expect(JSON.stringify(a.json) === JSON.stringify(b.json), 'the two results differ');
  });

  await test('PATCH /users/2 changes only the name: 200', async () => {
    const before = (await call('GET', '/users/2')).json;
    const res = await call('PATCH', '/users/2', { body: { name: 'Ravi S' } });
    expectStatus(res, 200);
    expect(res.json.name === 'Ravi S', 'name was not changed');
    expect(res.json.email === before.email, 'email should not have changed');
  });

  await test('DELETE /users/3 as admin returns 204, then GET returns 404', async () => {
    const res = await call('DELETE', '/users/3', { token: 'admin-token' });
    expectStatus(res, 204);
    expect(res.text === '', 'a 204 must have an empty body');
    expectStatus(await call('GET', '/users/3'), 404);
  });

  await test('OPTIONS /users returns 204 with an Allow header', async () => {
    const res = await call('OPTIONS', '/users');
    expectStatus(res, 204);
    expect(res.headers.get('allow').includes('POST'), 'Allow should list POST');
  });

  await test('GET /redirect returns 302 with a Location header (not followed)', async () => {
    const res = await call('GET', '/redirect');
    expectStatus(res, 302);
    expect(res.headers.get('location') === '/users', 'Location should be /users');
  });

  await test('GET /admin/stats with the admin token returns 200', async () => {
    expectStatus(await call('GET', '/admin/stats', { token: 'admin-token' }), 200);
  });

  heading('NEGATIVE TESTS: reading data wrongly (4xx)');

  await test('GET /users/999 returns 404 USER_NOT_FOUND', async () => {
    expectError(await call('GET', '/users/999'), 404, 'USER_NOT_FOUND');
  });

  await test('GET /users/abc returns 400 INVALID_ID', async () => {
    expectError(await call('GET', '/users/abc'), 400, 'INVALID_ID');
  });

  await test('GET /users?role=boss returns 400 INVALID_QUERY', async () => {
    expectError(await call('GET', '/users?role=boss'), 400, 'INVALID_QUERY');
  });

  await test('GET /users?limit=0 returns 400 (boundary: limit starts at 1)', async () => {
    expectError(await call('GET', '/users?limit=0'), 400, 'INVALID_QUERY');
  });

  await test('GET /nothing-here returns 404 ROUTE_NOT_FOUND', async () => {
    expectError(await call('GET', '/nothing-here'), 404, 'ROUTE_NOT_FOUND');
  });

  await test('DELETE /users (wrong method on this URL) returns 405 with an Allow header', async () => {
    const res = await call('DELETE', '/users', { token: 'admin-token' });
    expectError(res, 405, 'METHOD_NOT_ALLOWED');
    expect(res.headers.get('allow'), 'a 405 should include an Allow header');
  });

  await test('GET with Accept: application/xml returns 406', async () => {
    expectError(await call('GET', '/users', { headers: { Accept: 'application/xml' } }), 406, 'NOT_ACCEPTABLE');
  });

  heading('NEGATIVE TESTS: sending bad data (400, 413, 415, 422)');

  await test('POST broken JSON returns 400 INVALID_JSON', async () => {
    const res = await call('POST', '/users', { raw: '{"name": "Oops"', headers: { 'Content-Type': 'application/json' } });
    expectError(res, 400, 'INVALID_JSON');
  });

  await test('POST with no body returns 400 EMPTY_BODY', async () => {
    const res = await call('POST', '/users', { raw: '', headers: { 'Content-Type': 'application/json' } });
    expectError(res, 400, 'EMPTY_BODY');
  });

  await test('POST with Content-Type text/plain returns 415', async () => {
    const res = await call('POST', '/users', { raw: 'hello', headers: { 'Content-Type': 'text/plain' } });
    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  await test('POST with a huge body returns 413', async () => {
    const res = await call('POST', '/users', { body: { name: 'x'.repeat(5000), email: 'big@example.com' } });
    expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  await test('POST with no fields returns 422 and lists the problems', async () => {
    const res = await call('POST', '/users', { body: {} });
    expectError(res, 422, 'VALIDATION_FAILED');
    expect(res.json.errors.length === 2, `expected 2 problems but got ${res.json.errors.length}`);
  });

  await test('POST with a bad email returns 422', async () => {
    expectError(await call('POST', '/users', { body: { name: 'Bad Mail', email: 'not-an-email' } }), 422, 'VALIDATION_FAILED');
  });

  await test('POST with a number where text is expected returns 422', async () => {
    expectError(await call('POST', '/users', { body: { name: 12345, email: 'num@example.com' } }), 422, 'VALIDATION_FAILED');
  });

  await test('Boundary: name of 2 characters is accepted (201), 1 character is rejected (422)', async () => {
    expectStatus(await call('POST', '/users', { body: { name: 'Jo', email: 'jo@example.com' } }), 201);
    expectStatus(await call('POST', '/users', { body: { name: 'J', email: 'j@example.com' } }), 422);
  });

  await test('Boundary: name of 30 characters is accepted (201), 31 characters is rejected (422)', async () => {
    expectStatus(await call('POST', '/users', { body: { name: 'a'.repeat(30), email: 'a30@example.com' } }), 201);
    expectStatus(await call('POST', '/users', { body: { name: 'a'.repeat(31), email: 'a31@example.com' } }), 422);
  });

  await test('POST with an unknown field (id) returns 422: extra fields are not trusted', async () => {
    const res = await call('POST', '/users', { body: { id: 99, name: 'Sneaky', email: 'sneaky@example.com' } });
    expectError(res, 422, 'VALIDATION_FAILED');
  });

  await test('POST with an email that already exists returns 409 DUPLICATE_EMAIL', async () => {
    expectError(await call('POST', '/users', { body: { name: 'Copy', email: 'asha@example.com' } }), 409, 'DUPLICATE_EMAIL');
  });

  await test('Failed POSTs do not change the data (still 3 users)', async () => {
    await call('POST', '/users', { body: { name: 'X' } });
    await call('POST', '/users', { body: { name: 'Copy', email: 'asha@example.com' } });
    expect((await call('GET', '/users')).json.count === 3, 'a rejected request must not create a user');
  });

  await test('PUT /users/999 returns 404', async () => {
    expectError(await call('PUT', '/users/999', { body: validUser(2) }), 404, 'USER_NOT_FOUND');
  });

  await test('PUT without a required field returns 422', async () => {
    expectError(await call('PUT', '/users/2', { body: { name: 'Only Name' } }), 422, 'VALIDATION_FAILED');
  });

  await test('PATCH with an empty object returns 422', async () => {
    expectError(await call('PATCH', '/users/2', { body: {} }), 422, 'VALIDATION_FAILED');
  });

  await test('PATCH to an email owned by someone else returns 409', async () => {
    expectError(await call('PATCH', '/users/2', { body: { email: 'asha@example.com' } }), 409, 'DUPLICATE_EMAIL');
  });

  heading('NEGATIVE TESTS: security (401 and 403)');

  await test('DELETE with no token returns 401 UNAUTHENTICATED', async () => {
    const res = await call('DELETE', '/users/2');
    expectError(res, 401, 'UNAUTHENTICATED');
    expect(res.headers.get('www-authenticate'), 'a 401 should include WWW-Authenticate');
  });

  await test('DELETE with a made-up token returns 401 INVALID_TOKEN', async () => {
    expectError(await call('DELETE', '/users/2', { token: 'hacker-token' }), 401, 'INVALID_TOKEN');
  });

  await test('DELETE with a normal user token returns 403 FORBIDDEN', async () => {
    expectError(await call('DELETE', '/users/2', { token: 'user-token' }), 403, 'FORBIDDEN');
  });

  await test('A forbidden DELETE does not delete anything', async () => {
    await call('DELETE', '/users/2', { token: 'user-token' });
    expectStatus(await call('GET', '/users/2'), 200);
  });

  await test('DELETE /users/abc as admin returns 400 INVALID_ID', async () => {
    expectError(await call('DELETE', '/users/abc', { token: 'admin-token' }), 400, 'INVALID_ID');
  });

  await test('DELETE twice: first 204, second 404', async () => {
    expectStatus(await call('DELETE', '/users/2', { token: 'admin-token' }), 204);
    expectStatus(await call('DELETE', '/users/2', { token: 'admin-token' }), 404);
  });

  await test('GET /admin/stats: no token 401, user token 403', async () => {
    expectStatus(await call('GET', '/admin/stats'), 401);
    expectStatus(await call('GET', '/admin/stats', { token: 'user-token' }), 403);
  });

  await test('Creating an admin: no token 401, user token 403, admin token 201', async () => {
    const body = { name: 'New Admin', email: 'newadmin@example.com', role: 'admin' };
    expectStatus(await call('POST', '/users', { body }), 401);
    expectStatus(await call('POST', '/users', { body, token: 'user-token' }), 403);
    expectStatus(await call('POST', '/users', { body, token: 'admin-token' }), 201);
  });

  heading('SERVER ERRORS, LIMITS AND TIMEOUTS (429, 5xx)');

  await test('GET /status/500 returns 500', async () => {
    expectStatus(await call('GET', '/status/500'), 500);
  });

  await test('GET /status/503 returns 503 with a Retry-After header', async () => {
    const res = await call('GET', '/status/503');
    expectStatus(res, 503);
    expect(res.headers.get('retry-after'), 'a 503 should include Retry-After');
  });

  await test('GET /status/999 is rejected with 400 (not a valid status)', async () => {
    expectError(await call('GET', '/status/999'), 400, 'INVALID_STATUS');
  });

  await test('A real server crash returns 500 but does NOT leak details to the client', async () => {
    const res = await call('GET', '/simulate/crash');
    expectError(res, 500, 'INTERNAL_ERROR');
    expect(!/Simulated crash|\bat .*server\.js|stack/i.test(res.text), 'the response leaked internal details');
  });

  await test('Rate limit: 5 calls to /limited are 200, the 6th is 429 with Retry-After', async () => {
    for (let i = 1; i <= 5; i++) expectStatus(await call('GET', '/limited'), 200);
    const sixth = await call('GET', '/limited');
    expectError(sixth, 429, 'RATE_LIMITED');
    expect(sixth.headers.get('retry-after'), 'a 429 should include Retry-After');
  });

  await test('Timeout: a 2-second endpoint is cut off by a 500 ms client timeout', async () => {
    let timedOut = false;
    try {
      await fetch(BASE + '/slow?ms=2000', { signal: AbortSignal.timeout(500) });
    } catch (err) {
      timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    }
    expect(timedOut, 'the request should have timed out');
  });

  // ---------- summary ----------
  console.log(`\nResult: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

main();
