const assert = require('node:assert/strict');
const { test } = require('node:test');
const { confirmRelease } = require('./confirm-logic-release.cjs');

const version = '0.2.19';
const success = {
  status: 200,
  json: async () => ({ name: '@deepctrls/craftjs', version }),
};
const quiet = { log: () => {} };

test('a visible version succeeds immediately without waiting', async () => {
  await confirmRelease(version, {
    ...quiet,
    fetchVersion: async (url) => {
      assert.equal(
        url,
        'https://registry.npmjs.org/%40deepctrls%2Fcraftjs/0.2.19'
      );
      return success;
    },
    wait: () => assert.fail('must not wait'),
  });
});

test('temporary 404s are retried until the exact version becomes visible', async () => {
  let calls = 0;
  let waits = 0;
  await confirmRelease(version, {
    ...quiet,
    fetchVersion: async () => (++calls < 3 ? { status: 404 } : success),
    wait: async (ms) => {
      assert.equal(ms, 10000);
      waits++;
    },
  });
  assert.equal(calls, 3);
  assert.equal(waits, 2);
});

test('persistent 404 fails after the bounded retry budget', async () => {
  let calls = 0;
  let waits = 0;
  await assert.rejects(
    confirmRelease(version, {
      ...quiet,
      fetchVersion: async () => {
        calls++;
        return { status: 404 };
      },
      wait: async () => {
        waits++;
      },
    }),
    /still not visible.*do not republish/
  );
  assert.equal(calls, 13);
  assert.equal(waits, 12);
});

test('auth, registry, network and identity failures are not accepted or retried', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      confirmRelease(version, {
        ...quiet,
        fetchVersion: async () => ({ status }),
        wait: () => assert.fail('must not retry'),
      }),
      new RegExp(`HTTP ${status}`)
    );
  }
  await assert.rejects(
    confirmRelease(version, {
      ...quiet,
      fetchVersion: async () => {
        throw new Error('offline');
      },
    }),
    /offline/
  );
  for (const identity of [
    { name: '@craftjs/core', version },
    { name: '@deepctrls/craftjs', version: '0.2.18' },
  ]) {
    await assert.rejects(
      confirmRelease(version, {
        ...quiet,
        fetchVersion: async () => ({ status: 200, json: async () => identity }),
      }),
      /unexpected package identity/
    );
  }
});

test('invalid versions fail before querying the registry', async () => {
  for (const invalid of [undefined, '', 'latest', '0.2.19-rc.1']) {
    await assert.rejects(
      confirmRelease(invalid, {
        fetchVersion: () => assert.fail('must not query'),
      }),
      /stable RELEASE_VERSION/
    );
  }
});
