# Practice API: a small server on your own computer

A tiny API you run locally so you can practise API testing safely.
It has every common method (GET, POST, PUT, PATCH, DELETE), returns many different status codes, and **prints every request in the terminal** so you can watch what happens.

- Needs only **Node.js 18 or newer** (nothing else to install)
- Runs only on your computer (`127.0.0.1`), nobody else can reach it
- Data is kept in memory and goes back to the starting 3 users when you restart

## 1. Start it

1. Check Node is installed: open a terminal and run `node --version` (should show v18 or higher; if not, install it from nodejs.org).
2. Put `server.js`, `api-tests.js` and the `samples` folder in one folder.
3. Open a terminal **in that folder** and run:

```
node server.js
```

You should see `Practice API is running at http://127.0.0.1:3000`. Leave this terminal open: **this is where the logs appear**.

If the port is busy, use another one:
- Mac / Linux / Git Bash: `PORT=3001 node server.js`
- Windows Command Prompt: `set PORT=3001 && node server.js`
- Windows PowerShell: `$env:PORT=3001; node server.js`

> On Windows PowerShell, type `curl.exe` instead of `curl` in the commands below.

## 2. Try it by hand (open a second terminal)

Each command below says what status code you should get. Watch the server terminal after each one.
`-i` shows the status line and headers.

### Part A: things that should work

| # | Command | Expect |
|---|---|---|
| 1 | `curl -i http://127.0.0.1:3000/health` | 200 |
| 2 | `curl -i http://127.0.0.1:3000/users` | 200, 3 users |
| 3 | `curl -i http://127.0.0.1:3000/users/1` | 200, look for an `ETag` header |
| 4 | `curl -i -X POST http://127.0.0.1:3000/users -H "Content-Type: application/json" -d @samples/new-user.json` | **201** and a `Location` header. The server terminal prints the updated user table |
| 5 | `curl -i http://127.0.0.1:3000/users/4` | 200 (the user you just created) |
| 6 | `curl -i -X PUT http://127.0.0.1:3000/users/2 -H "Content-Type: application/json" -d @samples/replace-user.json` | 200 |
| 7 | `curl -i -X PATCH http://127.0.0.1:3000/users/3 -H "Content-Type: application/json" -d @samples/patch-user.json` | 200, only the name changed |
| 8 | `curl -i -X DELETE http://127.0.0.1:3000/users/4 -H "Authorization: Bearer admin-token"` | **204**, no body |
| 9 | `curl -i http://127.0.0.1:3000/users/4` | now **404** (it is gone) |
| 10 | `curl -i -X OPTIONS http://127.0.0.1:3000/users` | 204 with an `Allow` header |
| 11 | `curl -i http://127.0.0.1:3000/redirect` then `curl -iL http://127.0.0.1:3000/redirect` | 302, then with `-L` it follows to a 200 |

### Part B: things that should fail (negative testing)

| # | Command | Expect | Why |
|---|---|---|---|
| 12 | `curl -i http://127.0.0.1:3000/users/999` | 404 | No such user |
| 13 | `curl -i http://127.0.0.1:3000/users/abc` | 400 | The id is not a number |
| 14 | `curl -i http://127.0.0.1:3000/nothing-here` | 404 | No such endpoint |
| 15 | `curl -i -X DELETE http://127.0.0.1:3000/users` | 405 | Wrong method; see the `Allow` header |
| 16 | `curl -i -X POST http://127.0.0.1:3000/users -H "Content-Type: application/json" -d @samples/bad-user.json` | **422** | Name too short, bad email; the reply lists each problem |
| 17 | `curl -i -X POST http://127.0.0.1:3000/users -H "Content-Type: application/json" -d @samples/duplicate-user.json` | **409** | That email already belongs to Asha |
| 18 | `curl -i -X POST http://127.0.0.1:3000/users -H "Content-Type: text/plain" -d hello` | 415 | Wrong Content-Type |
| 19 | `curl -i -X DELETE http://127.0.0.1:3000/users/2` | **401** | No token |
| 20 | `curl -i -X DELETE http://127.0.0.1:3000/users/2 -H "Authorization: Bearer user-token"` | **403** | Logged in, but not an admin |
| 21 | `curl -i -X DELETE http://127.0.0.1:3000/users/2 -H "Authorization: Bearer fake"` | 401 | Token not recognised |
| 22 | `curl -i -H "Accept: application/xml" http://127.0.0.1:3000/users` | 406 | The API only speaks JSON |

Tip for 400 (broken JSON), run this one on Mac/Linux/Git Bash: `curl -i -X POST http://127.0.0.1:3000/users -H "Content-Type: application/json" -d '{"name": "Oops"'`

### Part C: server problems, limits and timeouts

| # | Command | Expect |
|---|---|---|
| 23 | `curl -i http://127.0.0.1:3000/status/500` | 500 |
| 24 | `curl -i http://127.0.0.1:3000/status/503` | 503 with `Retry-After` |
| 25 | `curl -i http://127.0.0.1:3000/simulate/crash` | 500 with a **generic** message. Look at the server terminal: the real error is printed there, but the client does not see it |
| 26 | Run `curl -i http://127.0.0.1:3000/limited` six times | 200 five times, then **429** with `Retry-After` |
| 27 | `curl -m 2 "http://127.0.0.1:3000/slow?ms=5000"` | curl gives up after 2 seconds (error 28). The server logs that the client disconnected |
| 28 | Easiest in Postman: send `GET /users/1`, copy the `ETag` response header, add a request header `If-None-Match` with that value, and send again | 200, then **304** with no body |

Want to reset everything to the starting data? `curl -X POST http://127.0.0.1:3000/reset`

## 3. Same thing in Postman (or Bruno / Hoppscotch)

- URL: `http://127.0.0.1:3000/users`
- For POST, PUT and PATCH: **Body** tab, choose **raw**, type **JSON**, and paste the content of a file from the `samples` folder.
- For DELETE or admin actions: **Authorization** tab, type **Bearer Token**, value `admin-token` (or `user-token`).
- Add a test in the **Scripts** tab (called **Tests** in older versions), for example:

```
pm.test("Status is 201", function () {
  pm.response.to.have.status(201);
});
```

## 4. Run the automatic tests

With the server running, open a second terminal in the same folder:

```
node api-tests.js
```

It runs 51 checks (positive and negative) and prints PASS or FAIL for each. While it runs, watch the server terminal fill with requests. Each test starts by resetting the data, so no test depends on another.

To prove the tests really work, **break the server on purpose**: for example, in `server.js` change `trim().length >= 2` to `trim().length >= 1`, restart the server, and run the tests again. A test should turn red. A test that cannot fail is not testing anything.

## 5. All endpoints

| Method and path | What it does | Possible status codes |
|---|---|---|
| `GET /` | Lists everything | 200 |
| `GET /health` | Is the server alive? | 200 |
| `POST /reset` | Put the data back to the 3 starting users | 200 |
| `GET /users` | List users. Optional `?role=admin` and `?limit=2` | 200, 400 |
| `POST /users` | Create a user (`name`, `email`, optional `role`) | 201, 400, 401, 403, 409, 413, 415, 422 |
| `GET /users/:id` | Read one user (supports `ETag`) | 200, 304, 400, 404 |
| `PUT /users/:id` | Replace name and email | 200, 400, 404, 409, 413, 415, 422 |
| `PATCH /users/:id` | Change only the fields you send | 200, 400, 404, 409, 413, 415, 422 |
| `DELETE /users/:id` | Remove a user (**admin token**) | 204, 400, 401, 403, 404 |
| `GET /admin/stats` | Numbers about the server (**admin token**) | 200, 401, 403 |
| `GET /status/:code` | Returns any status from 200 to 599 | the code you ask for, or 400 |
| `GET /redirect` | Redirects to `/users` | 302 |
| `GET /slow?ms=3000` | Answers after a delay (for timeout tests) | 200, 400 |
| `GET /limited` | Allows 5 calls per 30 seconds | 200, 429 |
| `GET /simulate/crash` | A deliberate server bug | 500 |

Any URL can also return: 404 (no such endpoint), 405 (wrong method), 406 (not JSON), 401 (bad token).

The rules for a user: `name` is text of 2 to 30 characters, `email` must look like an email and be unique, `role` is `user` or `admin` (only an admin may create or assign `admin`). Unknown fields are rejected.

Every error looks the same, so tests can check both the HTTP status and our own `code` word:

```
{
  "status": 404,
  "code": "USER_NOT_FOUND",
  "message": "User 999 does not exist"
}
```

## 6. Reading the server log

```
[10:34:34] POST    /users  ->  201 Created  (9 ms)
           body: { "name": "Kiran", "email": "kiran@example.com" }
           note: user #4 created (4 users stored)
[10:34:34] DELETE  /users/4  ->  401 Unauthorized  (0 ms)
           note: UNAUTHENTICATED: Send a token: Authorization: Bearer <token>
```

First line: time, method, path, status, how long it took. Then the body that was sent and a short note about what happened. After every change (POST, PUT, PATCH, DELETE) the whole user table is printed too, so you can see the data change. Status codes are coloured in a normal terminal: green 2xx, cyan 3xx, yellow 4xx, red 5xx.

## 7. Safety notes

- This server is for learning only. It has fake logins, no real security, and no database.
- It only listens on `127.0.0.1`, so it is not reachable from other computers. Do not change `HOST` to expose it.
- Do not put real personal data into it.
