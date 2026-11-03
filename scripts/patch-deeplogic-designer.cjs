const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const coreDir = path.join(root, 'packages', 'core');
const corePackage = require(path.join(coreDir, 'package.json'));

function readTargetArg() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--target');
  if (index >= 0) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith('--target='));
  if (inline) return inline.slice('--target='.length);
  return process.env.DEEPLOGIC_DESIGNER_DIR;
}

function run(command, args, cwd) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  execFileSync(executable, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function copyBuildOutput(source, target) {
  for (const folder of ['dist', 'lib']) {
    const sourceFolder = path.join(source, folder);
    const targetFolder = path.join(target, folder);
    if (!fs.existsSync(sourceFolder)) {
      throw new Error(`Missing ${sourceFolder}; build @craftjs/core first`);
    }
    fs.rmSync(targetFolder, { recursive: true, force: true });
    fs.cpSync(sourceFolder, targetFolder, { recursive: true });
  }
}

function main() {
  const target = readTargetArg();
  if (!target) {
    throw new Error(
      'Usage: yarn patch:deeplogic-designer --target <deeplogic.designer path> (or set DEEPLOGIC_DESIGNER_DIR)'
    );
  }

  const targetRoot = path.resolve(target);
  const targetPackagePath = path.join(targetRoot, 'package.json');
  if (!fs.existsSync(targetPackagePath)) {
    throw new Error(`Target package.json was not found: ${targetRoot}`);
  }

  const targetPackage = JSON.parse(fs.readFileSync(targetPackagePath, 'utf8'));
  const patchedDependencies = targetPackage.pnpm?.patchedDependencies || {};
  const patchKey = `@craftjs/core@${corePackage.version}`;
  const targetPatchPath = patchedDependencies[patchKey];
  if (!targetPatchPath) {
    const available = Object.keys(patchedDependencies)
      .filter((key) => key.startsWith('@craftjs/core@'))
      .join(', ');
    throw new Error(
      `Craft.js version mismatch: current packages/core is ${corePackage.version}, ` +
        `but the target has ${available || 'no @craftjs/core patched dependency'}. ` +
        'Use a Craft.js branch matching the target base version before generating this patch.'
    );
  }

  console.log(`Building @craftjs/core@${corePackage.version}...`);
  run('yarn', ['workspace', '@craftjs/core', 'build'], root);

  const editDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftjs-patch-'));
  try {
    console.log(`Extracting unpatched @craftjs/core@${corePackage.version}...`);
    run(
      'pnpm',
      [
        'patch',
        `@craftjs/core@${corePackage.version}`,
        '--ignore-existing',
        '--edit-dir',
        editDir,
      ],
      targetRoot
    );
    copyBuildOutput(coreDir, editDir);

    console.log(`Writing ${targetPatchPath}...`);
    run(
      'pnpm',
      ['patch-commit', editDir, '--patches-dir', path.dirname(targetPatchPath)],
      targetRoot
    );
  } finally {
    fs.rmSync(editDir, { recursive: true, force: true });
  }

  console.log(
    `Generated ${path.join(targetRoot, targetPatchPath)} for @craftjs/core@${corePackage.version}`
  );
}

try {
  main();
} catch (error) {
  console.error(`Craft.js designer patch failed: ${error.message}`);
  process.exitCode = 1;
}
