import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const delimiter = args.indexOf('--');
const cliArgs = delimiter < 0 ? args : args.slice(0, delimiter);
const hasTarget = cliArgs.some((arg) => arg === '--target' || arg === '-t' || arg.startsWith('--target='));
// The distributed Node CLI is compiled with MSVC; the user's Rust toolchain may
// be GNU. Passing the Rust target prevents the bundler from omitting its loader.
if (process.platform === 'win32' && ['build', 'bundle'].includes(args[0]) && !hasTarget) {
  const rust = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  const target = process.env.CARGO_BUILD_TARGET || rust.stdout?.match(/^host: (\S+)$/m)?.[1];
  if (rust.error || rust.status !== 0 || !target?.match(/-windows-(gnu|msvc)$/)) {
    throw new Error('Cannot identify Windows Rust target; supply --target explicitly');
  }
  args.splice(1, 0, '--target', target);
  console.log(`Windows Rust target: ${target}`);
}
const cli = path.join(path.dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js');
const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
