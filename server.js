// =====================================================================
//  Practice API for learning API testing
//  - Zero dependencies: only needs Node.js 18 or newer
//  - Runs only on YOUR computer (127.0.0.1), nobody else can reach it
//  - Every request is printed in this terminal, so you can watch it work
//
//  Start it:  node server.js
// =====================================================================
'use strict';

const http = require('http');
const crypto = require('crypto');

// ---------- settings ----------
const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';                 // local only
const MAX_BODY_BYTES = 2048;              // bigger bodies get 413
const RATE_LIMIT = { max: 5, windowMs: 30000 };   // used by GET /limited
const TOKENS = { 'user-token': 'user', 'admin-token': 'admin' };  // fake logins
const ROLES = ['user', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- the "database": a list that lives in memory ----------
let users;
let nextId;
function resetData() {
  users = [
    { id: 1, name: 'Asha', email: 'asha@example.com', role: 'admin' },
    { id: 2, name: 'Ravi', email: 'ravi@example.com', role: 'user' },
    { id: 3, name: 'Meena', email: 'meena@example.com', role: 'user' },
  ];
  nextId = 4;
}
resetData();

let requestCount = 0;
const rateHits = new Map();               // who -> { count, resetAt }

// ---------- terminal logging ----------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const statusColor = (s) => (s >= 500 ? 31 : s >= 400 ? 33 : s >= 300 ? 36 : 32);
const clock = () => new Date().toTimeString().slice(0, 8);

function logRequest(ctx) {
  const status = ctx.res.statusCode;
  const label = `${status} ${http.STATUS_CODES[status] || ''}`.trim();
  const ms = Date.now() - ctx.startedAt;
  console.log(`[${clock()}] ${ctx.req.method.padEnd(7)} ${ctx.req.url}  ->  ${paint(statusColor(status), label)}  (${ms} ms)`);
  if (ctx.bodyText) console.log(`           body: ${ctx.bodyText}`);
  if (ctx.note) console.log(`           note: ${ctx.note}`);
  if (ctx.showTable) console.table(users);
}

// ---------- response helpers ----------
function send(ctx, status, body, headers = {}) {
  const hasBody = ![204, 205, 304].includes(status) && body !== undefined;
  const payload = hasBody ? JSON.stringify(body, null, 2) : '';
  const h = { ...headers };
  if (hasBody) {
    h['Content-Type'] = 'application/json; charset=utf-8';
    h['Content-Length'] = Buffer.byteLength(payload);
  }
  ctx.res.writeHead(status, h);
  ctx.res.end(payload);
}

// Every error has the same shape: the HTTP status plus our own "code" word.
function fail(ctx, status, code, message, extra = {}, headers = {}) {
  ctx.note = `${code}: ${message}`;
  send(ctx, status, { status, code, message, ...extra }, headers);
}

// ---------- reading and checking request bodies ----------
function readJson(ctx) {
  return new Promise((resolve) => {
    const type = (ctx.req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      fail(ctx, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
      return resolve(null);
    }
    let size = 0;
    const chunks = [];
    ctx.req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    ctx.req.on('end', () => {
      if (size > MAX_BODY_BYTES) {
        fail(ctx, 413, 'PAYLOAD_TOO_LARGE', `Body is ${size} bytes; the limit is ${MAX_BODY_BYTES}`);
        return resolve(null);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      ctx.bodyText = text.length > 200 ? text.slice(0, 200) + ' ...' : text.replace(/\s+/g, ' ');
      if (text.trim() === '') {
        fail(ctx, 400, 'EMPTY_BODY', 'A JSON body is required');
        return resolve(null);
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        fail(ctx, 400, 'INVALID_JSON', 'The body is not valid JSON');
        return resolve(null);
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        fail(ctx, 400, 'INVALID_BODY', 'The body must be a JSON object, like {"name": "..."}');
        return resolve(null);
      }
      resolve(data);
    });
  });
}

// Returns a list of problems (an empty list means the data is fine).
function validateUser(data, { partial }) {
  const errors = [];
  for (const key of Object.keys(data)) {
    if (!['name', 'email', 'role'].includes(key)) errors.push({ field: key, problem: 'unknown field' });
  }
  if (!partial || 'name' in data) {
    const ok = typeof data.name === 'string' && data.name.trim().length >= 2 && data.name.trim().length <= 30;
    if (!ok) errors.push({ field: 'name', problem: 'must be text, 2 to 30 characters' });
  }
  if (!partial || 'email' in data) {
    if (typeof data.email !== 'string' || !EMAIL_RE.test(data.email)) {
      errors.push({ field: 'email', problem: 'must be a valid email address' });
    }
  }
  if ('role' in data && !ROLES.includes(data.role)) {
    errors.push({ field: 'role', problem: `must be one of: ${ROLES.join(', ')}` });
  }
  return errors;
}

const emailTaken = (email, exceptId) =>
  users.some((u) => u.id !== exceptId && u.email.toLowerCase() === email.toLowerCase());

// ---------- who is calling? ----------
function requireAdmin(ctx) {
  if (ctx.role === 'admin') return true;
  if (!ctx.role) {
    fail(ctx, 401, 'UNAUTHENTICATED', 'Send a token: Authorization: Bearer <token>', {},
      { 'WWW-Authenticate': 'Bearer realm="practice-api"' });
  } else {
    fail(ctx, 403, 'FORBIDDEN', 'This action needs the admin role');
  }
  return false;
}

function parseId(ctx) {
  const raw = ctx.params.id;
  if (!/^\d+$/.test(raw)) {
    fail(ctx, 400, 'INVALID_ID', `'${raw}' is not a valid id (use a whole number)`);
    return null;
  }
  return Number(raw);
}

const userNotFound = (ctx, id) => fail(ctx, 404, 'USER_NOT_FOUND', `User ${id} does not exist`);

// ---------- the endpoints ----------
function home(ctx) {
  send(ctx, 200, {
    name: 'Practice API',
    tip: 'Watch the terminal where this server runs: every request is logged there.',
    tokens: { user: 'Authorization: Bearer user-token', admin: 'Authorization: Bearer admin-token' },
    endpoints: [
      'GET    /health',
      'POST   /reset                    put the data back to the starting state',
      'GET    /users                    optional: ?role=admin  ?limit=2',
      'POST   /users                    create (body: name, email, optional role)',
      'GET    /users/:id',
      'PUT    /users/:id                replace name and email',
      'PATCH  /users/:id                change only the fields you send',
      'DELETE /users/:id                admin token required',
      'GET    /admin/stats              admin token required',
      'GET    /status/:code             returns any status from 200 to 599',
      'GET    /redirect                 302 redirect to /users',
      'GET    /slow?ms=3000             answers after a delay (try a timeout)',
      'GET    /limited                  429 after 5 calls in 30 seconds',
      'GET    /simulate/crash           a deliberate server bug (500)',
    ],
  });
}

function health(ctx) {
  send(ctx, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
}

function reset(ctx) {
  resetData();
  rateHits.clear();
  ctx.note = 'data reset to the 3 starting users';
  ctx.showTable = true;
  send(ctx, 200, { message: 'Data reset', users: users.length });
}

function listUsers(ctx) {
  const { role, limit } = ctx.query;
  if (role !== undefined && !ROLES.includes(role)) {
    return fail(ctx, 400, 'INVALID_QUERY', `role must be one of: ${ROLES.join(', ')}`);
  }
  let max = users.length;
  if (limit !== undefined) {
    if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) {
      return fail(ctx, 400, 'INVALID_QUERY', 'limit must be a whole number from 1 to 100');
    }
    max = Number(limit);
  }
  const result = users.filter((u) => role === undefined || u.role === role).slice(0, max);
  ctx.note = `returned ${result.length} user(s)`;
  send(ctx, 200, { count: result.length, users: result });
}

function getUser(ctx) {
  const id = parseId(ctx);
  if (id === null) return;
  const user = users.find((u) => u.id === id);
  if (!user) return userNotFound(ctx, id);
  // ETag lets a client ask "has this changed?" and get a 304 if not
  const etag = 'W/"' + crypto.createHash('md5').update(JSON.stringify(user)).digest('hex') + '"';
  if (ctx.req.headers['if-none-match'] === etag) {
    ctx.note = `user #${id} unchanged, 304 sent with no body`;
    return send(ctx, 304, undefined, { ETag: etag });
  }
  ctx.note = `user #${id} returned`;
  send(ctx, 200, user, { ETag: etag });
}

async function createUser(ctx) {
  const data = await readJson(ctx);
  if (!data) return;
  const errors = validateUser(data, { partial: false });
  if (errors.length) return fail(ctx, 422, 'VALIDATION_FAILED', 'Some fields are invalid', { errors });
  if (data.role === 'admin' && !requireAdmin(ctx)) return;
  if (emailTaken(data.email)) return fail(ctx, 409, 'DUPLICATE_EMAIL', `${data.email} is already registered`);
  const user = { id: nextId++, name: data.name.trim(), email: data.email, role: data.role || 'user' };
  users.push(user);
  ctx.note = `user #${user.id} created (${users.length} users stored)`;
  ctx.showTable = true;
  send(ctx, 201, user, { Location: `/users/${user.id}` });
}

async function replaceUser(ctx) {
  const id = parseId(ctx);
  if (id === null) return;
  const user = users.find((u) => u.id === id);
  if (!user) return userNotFound(ctx, id);
  const data = await readJson(ctx);
  if (!data) return;
  const errors = validateUser(data, { partial: false });
  if (errors.length) return fail(ctx, 422, 'VALIDATION_FAILED', 'Some fields are invalid', { errors });
  if (data.role === 'admin' && !requireAdmin(ctx)) return;
  if (emailTaken(data.email, id)) return fail(ctx, 409, 'DUPLICATE_EMAIL', `${data.email} is already registered`);
  user.name = data.name.trim();
  user.email = data.email;
  if (data.role) user.role = data.role;      // role stays as it was unless you send one
  ctx.note = `user #${id} replaced`;
  ctx.showTable = true;
  send(ctx, 200, user);
}

async function patchUser(ctx) {
  const id = parseId(ctx);
  if (id === null) return;
  const user = users.find((u) => u.id === id);
  if (!user) return userNotFound(ctx, id);
  const data = await readJson(ctx);
  if (!data) return;
  if (Object.keys(data).length === 0) {
    return fail(ctx, 422, 'VALIDATION_FAILED', 'Send at least one field to change', {
      errors: [{ field: '(body)', problem: 'no fields sent' }],
    });
  }
  const errors = validateUser(data, { partial: true });
  if (errors.length) return fail(ctx, 422, 'VALIDATION_FAILED', 'Some fields are invalid', { errors });
  if (data.role === 'admin' && !requireAdmin(ctx)) return;
  if (data.email && emailTaken(data.email, id)) {
    return fail(ctx, 409, 'DUPLICATE_EMAIL', `${data.email} is already registered`);
  }
  if (data.name !== undefined) user.name = data.name.trim();
  if (data.email !== undefined) user.email = data.email;
  if (data.role !== undefined) user.role = data.role;
  ctx.note = `user #${id} updated: ${Object.keys(data).join(', ')}`;
  ctx.showTable = true;
  send(ctx, 200, user);
}

function deleteUser(ctx) {
  if (!requireAdmin(ctx)) return;
  const id = parseId(ctx);
  if (id === null) return;
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return userNotFound(ctx, id);
  users.splice(index, 1);
  ctx.note = `user #${id} deleted (${users.length} users left)`;
  ctx.showTable = true;
  send(ctx, 204);
}

function adminStats(ctx) {
  if (!requireAdmin(ctx)) return;
  ctx.note = 'stats returned';
  send(ctx, 200, {
    totalUsers: users.length,
    admins: users.filter((u) => u.role === 'admin').length,
    requestsServed: requestCount,
  });
}

// Returns whatever status you ask for, handy for practising every code.
function statusDemo(ctx) {
  const raw = ctx.params.code;
  const code = Number(raw);
  if (!/^\d{3}$/.test(raw) || code < 200 || code > 599) {
    return fail(ctx, 400, 'INVALID_STATUS', 'Use a code from 200 to 599 (1xx codes are interim and cannot be a final answer)');
  }
  const headers = {};
  if ([301, 302, 303, 307, 308].includes(code)) headers.Location = '/users';
  if (code === 401) headers['WWW-Authenticate'] = 'Bearer realm="practice-api"';
  if (code === 405) headers.Allow = 'GET';
  if (code === 429 || code === 503) headers['Retry-After'] = '5';
  ctx.note = `simulated ${code}`;
  send(ctx, code, { status: code, message: http.STATUS_CODES[code] || 'Custom status', simulated: true }, headers);
}

function redirect(ctx) {
  ctx.note = 'redirecting to /users';
  send(ctx, 302, { message: 'Moved, follow the Location header' }, { Location: '/users' });
}

async function slow(ctx) {
  const raw = ctx.query.ms === undefined ? '2000' : ctx.query.ms;
  if (!/^\d+$/.test(raw) || Number(raw) > 10000) {
    return fail(ctx, 400, 'INVALID_QUERY', 'ms must be a whole number from 0 to 10000');
  }
  await new Promise((resolve) => setTimeout(resolve, Number(raw)));
  ctx.note = `waited ${raw} ms`;
  send(ctx, 200, { waitedMs: Number(raw) });
}

function limited(ctx) {
  const who = ctx.req.socket.remoteAddress;
  const now = Date.now();
  let hit = rateHits.get(who);
  if (!hit || now > hit.resetAt) {
    hit = { count: 0, resetAt: now + RATE_LIMIT.windowMs };
    rateHits.set(who, hit);
  }
  hit.count++;
  const headers = {
    'X-RateLimit-Limit': String(RATE_LIMIT.max),
    'X-RateLimit-Remaining': String(Math.max(0, RATE_LIMIT.max - hit.count)),
  };
  if (hit.count > RATE_LIMIT.max) {
    const wait = Math.ceil((hit.resetAt - now) / 1000);
    return fail(ctx, 429, 'RATE_LIMITED', `Too many requests. Try again in ${wait} seconds`, {},
      { ...headers, 'Retry-After': String(wait) });
  }
  ctx.note = `call ${hit.count} of ${RATE_LIMIT.max} in this window`;
  send(ctx, 200, { message: 'ok', callsInWindow: hit.count }, headers);
}

function crash() {
  throw new Error('Simulated crash: this is a deliberate bug');
}

// ---------- routing: which function handles which method + path ----------
const routes = [];
function route(method, pattern, handler) {
  const names = [];
  const source = pattern.replace(/:(\w+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  routes.push({ method, regex: new RegExp(`^${source}/?$`), names, handler });
}

route('GET', '/', home);
route('GET', '/health', health);
route('POST', '/reset', reset);
route('GET', '/users', listUsers);
route('POST', '/users', createUser);
route('GET', '/users/:id', getUser);
route('PUT', '/users/:id', replaceUser);
route('PATCH', '/users/:id', patchUser);
route('DELETE', '/users/:id', deleteUser);
route('GET', '/admin/stats', adminStats);
route('GET', '/status/:code', statusDemo);
route('GET', '/redirect', redirect);
route('GET', '/slow', slow);
route('GET', '/limited', limited);
route('GET', '/simulate/crash', crash);

// ---------- every request starts here ----------
async function handle(req, res) {
  const qIndex = req.url.indexOf('?');
  const pathname = qIndex === -1 ? req.url : req.url.slice(0, qIndex);
  const query = Object.fromEntries(new URLSearchParams(qIndex === -1 ? '' : req.url.slice(qIndex + 1)));
  const ctx = { req, res, query, params: {}, role: null, startedAt: Date.now() };
  requestCount++;

  res.on('finish', () => logRequest(ctx));
  res.on('close', () => {
    if (!res.writableFinished) {
      console.log(`[${clock()}] ${req.method.padEnd(7)} ${req.url}  ->  ${paint(33, 'client disconnected before the answer was sent')}`);
    }
  });

  try {
    // 1. Who is calling? No header = anonymous. A wrong token = 401.
    if (req.headers.authorization !== undefined) {
      const header = req.headers.authorization;
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!TOKENS[token]) {
        return fail(ctx, 401, 'INVALID_TOKEN', 'The token is not recognised', {},
          { 'WWW-Authenticate': 'Bearer realm="practice-api"' });
      }
      ctx.role = TOKENS[token];
    }

    // 2. Can we answer in a format the client accepts? (we only speak JSON)
    const accept = req.headers.accept;
    if (accept && !/json|\*\/\*|application\/\*/i.test(accept)) {
      return fail(ctx, 406, 'NOT_ACCEPTABLE', 'This API only returns application/json');
    }

    // 3. Find the endpoint
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const matches = routes.filter((r) => r.regex.test(pathname));
    if (matches.length === 0) {
      return fail(ctx, 404, 'ROUTE_NOT_FOUND', `There is no endpoint at ${pathname}`);
    }
    const allowed = [...new Set(matches.map((r) => r.method))];
    if (req.method === 'OPTIONS') {
      ctx.note = 'the Allow header lists what this URL accepts';
      return send(ctx, 204, undefined, { Allow: [...allowed, 'OPTIONS'].join(', ') });
    }
    const match = matches.find((r) => r.method === method);
    if (!match) {
      return fail(ctx, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on ${pathname}`,
        { allowed }, { Allow: allowed.join(', ') });
    }
    const found = match.regex.exec(pathname);
    match.names.forEach((name, i) => { ctx.params[name] = found[i + 1]; });

    // 4. Run it
    await match.handler(ctx);
  } catch (err) {
    // Real bug: show the details HERE in the terminal, tell the client nothing secret.
    console.error(paint(31, `[${clock()}] UNEXPECTED ERROR while handling ${req.method} ${req.url}`));
    console.error(err.stack);
    if (!res.headersSent) fail(ctx, 500, 'INTERNAL_ERROR', 'Something went wrong on the server');
  }
}

// ---------- start ----------
const server = http.createServer(handle);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the other program or choose another port (see README).`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(paint(32, `Practice API is running at http://${HOST}:${PORT}`));
  console.log('Open that address in a browser or Postman, or use curl. Press Ctrl+C to stop.');
  console.log('Fake logins:  user-token (normal user)   admin-token (admin)');
  console.log('Every request will be printed below.');
  console.log('');
});
