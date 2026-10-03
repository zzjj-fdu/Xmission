import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
// Compile the actual UI sanitizer. Resolve its dependency outside the data URL.
const { default: DOMPurify } = await import('dompurify');
globalThis.__notesPurifier = DOMPurify;
const source = fs.readFileSync(new URL('../src/utils/safeNotes.ts', import.meta.url), 'utf8')
  .replace("import DOMPurify from 'dompurify';", 'const DOMPurify = globalThis.__notesPurifier;');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { safeNotesHtml } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

for (const malicious of [
  '<img src=x onerror="alert(1)"><p onclick="alert(1)">Note</p>',
  '<svg onload="alert(1)"><a href="javascript:alert(1)">x</a></svg>',
  '<script>alert(1)</script><iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
  '<span style="position:fixed;inset:0;background:url(https://evil.example)">Note</span>',
  '<span style="font-size:24px;background:red" onmouseover="alert(1)">Note</span>',
  '<a href="javascript:alert(1)" data-command="delete">Note</a>',
]) {
  const clean = safeNotesHtml(malicious);
  const fragment = JSDOM.fragment(clean);
  assert.equal(fragment.querySelector('script,style,img,svg,math,iframe,object,form,a'), null, clean);
  for (const node of fragment.querySelectorAll('*')) {
    for (const attr of node.attributes) {
      assert.equal(attr.name, 'style', clean);
      assert.match(attr.value, /^font-size: (12|14|16|20|24)px$/, clean);
    }
  }
}
const richText = '<p><strong>粗体</strong><em>斜体</em><s>删除线</s><span style="font-size: 20px">大字</span></p><ul><li>步骤一</li></ul>';
assert.equal(safeNotesHtml(richText), richText);
assert.equal(safeNotesHtml(null), '');
assert.equal(safeNotesHtml('文字 style="position:fixed" 仍需保留'), '文字 style="position:fixed" 仍需保留');
assert.equal(safeNotesHtml(safeNotesHtml(richText)), richText);
console.log('PASS: stored-note script/event/URL/style injection removed; editor formatting retained');
dom.window.close();
