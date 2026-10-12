// Prevent retired experiments from reappearing through any production window.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const retired = new Set([
  'SimpleCapture.tsx', 'GoalWorkbench.tsx', 'FirstSteps.tsx',
  'FocusEnvironment.tsx', 'PreparationPanel.tsx', 'PreparationPreferences.tsx',
  'BackupRestore.tsx', 'ReminderInbox.tsx', 'JourneyPanel.tsx', 'PetQuickTasks.tsx',
  'preparation.css', 'first-steps.css', 'goal-workbench.css',
]);
const seen = new Set();
function visit(file, chain = []) {
  file = path.resolve(file);
  assert.equal(retired.has(path.basename(file)), false, `Retired UI is reachable: ${[...chain, file].join(' -> ')}`);
  if (seen.has(file)) return;
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  for (const entry of ts.preProcessFile(source, true, true).importedFiles) {
    if (!entry.fileName.startsWith('.')) continue;
    const base = path.resolve(path.dirname(file), entry.fileName);
    const resolved = [base, ...['.tsx', '.ts', '.js', '/index.tsx', '/index.ts'].map(ext => base + ext)].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    assert.ok(resolved, `Resolve production import ${entry.fileName} from ${file}`);
    if (/\.(tsx?|js|css)$/.test(resolved)) visit(resolved, [...chain, file]);
  }
}
for (const html of ['index.html', 'widget.html', 'bubble.html', 'pet.html']) {
  const source = fs.readFileSync(html, 'utf8');
  const entry = source.match(/<script[^>]+src="([^"]+)"/)[1];
  visit(entry.replace(/^\//, ''));
}
const flags = fs.readFileSync('src-tauri/src/features.rs', 'utf8');
for (const flag of ['PREPARATION_AUTOMATION', 'GOAL_EXPERIENCE']) {
  assert.match(flags, new RegExp(`pub const ${flag}: bool = false;`));
}
console.log(`PASS: ${seen.size} production dependencies exclude retired UI; experiment defaults are off`);
