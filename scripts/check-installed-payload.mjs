import fs from 'node:fs';
import assert from 'node:assert/strict';
const stage = process.argv[2] === '--stage';
const [source, target] = process.argv.slice(stage ? 3 : 2);
const original = fs.readFileSync(source);
const prefix = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_');
const unknown = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
const offset = original.indexOf(unknown);
// Tauri stamps NSS while packaging and restores UNK in the standalone build.
// This documented three-byte marker is the only allowed difference.
if (offset >= 0) {
  assert.equal(original.indexOf(unknown, offset + 1), -1, 'Mutable Tauri unknown marker is unique');
  original.write('NSS', offset + prefix.length, 3, 'ascii');
} else {
  const nsis = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS');
  const first = original.indexOf(nsis);
  assert.ok(first >= 0 && original.indexOf(nsis, first + 1) >= 0, 'Expected both NSIS matcher and stamped bundle marker');
}
if (stage) {
  fs.writeFileSync(target, original);
  console.log('Staged immutable NSIS payload');
} else {
  const installed = fs.readFileSync(target);
  assert.ok(original.equals(installed), 'Installed payload differs beyond the Tauri NSIS marker');
  console.log('PASS: installed native payload matches source with the expected Tauri NSIS marker');
}
