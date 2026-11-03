const { setTimeout: sleep } = require('node:timers/promises');

async function confirmRelease(
  version,
  { fetchVersion = fetch, wait = sleep, log = console.log } = {}
) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
    throw new Error('Expected a stable RELEASE_VERSION (x.y.z).');
  }

  const name = '@deepctrls/craftjs';
  const url = `https://registry.npmjs.org/${encodeURIComponent(
    name
  )}/${version}`;
  const attempts = 13;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetchVersion(url, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (response.status === 200) {
      const published = await response.json();
      if (published.name !== name || published.version !== version) {
        throw new Error(
          `Registry returned unexpected package identity for ${name}@${version}.`
        );
      }
      log(`Confirmed ${name}@${version} in npm.`);
      return;
    }
    // A successful publish may take time to appear on registry read endpoints.
    // Other failures must not be treated as propagation delays or success.
    if (response.status !== 404) {
      throw new Error(
        `Cannot confirm published version: HTTP ${response.status}`
      );
    }
    if (attempt < attempts) {
      log(
        `${name}@${version} is not visible yet (${attempt}/${attempts}); retrying in 10 seconds.`
      );
      await wait(10000);
    }
  }
  throw new Error(
    `${name}@${version} is still not visible after ${attempts} checks. ` +
      'Verify npm, then rerun failed jobs in this same workflow run; do not republish.'
  );
}

module.exports = { confirmRelease };

if (require.main === module) {
  confirmRelease(process.env.RELEASE_VERSION).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
