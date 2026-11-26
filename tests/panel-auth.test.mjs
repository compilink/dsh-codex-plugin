import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.mjs';

test('the settings bootstrap on a stock host requires an authenticated browser or desktop credential', async () => {
  const desktopPeer = { principal: { kind: 'owner' } }, webPeer = { principal: { kind: 'owner' } };
  const apiPeer = { principal: { kind: 'owner' } };
  const name = 'dsh-auth-' + 'a'.repeat(43);
  const browserCookie = name + '=v1.fixture.' + 'b'.repeat(43);
  const desktopCookie = 'dsh-desktop-session=' + 'c'.repeat(43);
  const apiCookie = name + '=v2.fixture.' + 'd'.repeat(43);
  const authenticate = ({ headers }) => {
    const cookies = (headers.cookie ?? '').split(';').map(cookie => cookie.trim());
    if (cookies.includes(desktopCookie)) return { peer: desktopPeer };
    if (cookies.includes(browserCookie)) return { peer: webPeer };
    if (cookies.includes(apiCookie) || headers.authorization) return { peer: apiPeer };
    return { rejection: 401 };
  };
  const authentication = { authenticate };
  let route;
  const ctx = {
    get: name => name === 'connection.authentication' ? authentication : undefined,
    inject: (_, mount) => mount(ctx), effect: f => f(),
    webServer: { register(r) { route = r; return () => {}; } },
    connection: { admit: authenticate }, authorization: {}, credentials: {},
  };
  apply(ctx);
  for (const [headers, expected] of [
    [{ cookie: browserCookie }, 200], [{ cookie: desktopCookie }, 200], [{}, 401],
    [{ cookie: apiCookie }, 403], [{ authorization: 'synthetic' }, 403],
    [{ cookie: 'dsh-desktop-session='+'z'.repeat(43)+'; '+apiCookie }, 403],
  ]) {
    let status, payload;
    await route.handler({ method: 'GET', url: '/local/chatgpt/panel-session', headers: { host: 'localhost', ...headers } },
      { writeHead: code => { status = code; }, end: value => { payload = JSON.parse(value); } });
    assert.equal(status, expected);
    assert.equal(typeof payload.csrf === 'string', expected === 200);
  }
});
