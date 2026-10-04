import fs from 'node:fs';
import path from 'node:path';

// Check the generated installer instructions as well as the executable's imports.
// A DLL present in the developer's target folder is insufficient: NSIS must ship it.
const output = path.resolve(process.argv[2] ?? 'src-tauri/target/x86_64-pc-windows-gnu/release');
const exe = fs.readFileSync(path.join(output, 'xmission.exe'));
const pe = exe.readUInt32LE(0x3c);
if (exe.toString('ascii', pe, pe + 4) !== 'PE\0\0' || exe.readUInt16LE(pe + 4) !== 0x8664) {
  throw new Error('Expected a valid Windows x64 executable');
}
const optional = pe + 24;
if (exe.readUInt16LE(optional) !== 0x20b) throw new Error('Expected PE32+');
const sectionCount = exe.readUInt16LE(pe + 6);
const sectionTable = optional + exe.readUInt16LE(pe + 20);
function offset(rva) {
  for (let i = 0; i < sectionCount; i++) {
    const section = sectionTable + i * 40;
    const address = exe.readUInt32LE(section + 12);
    const size = Math.max(exe.readUInt32LE(section + 8), exe.readUInt32LE(section + 16));
    if (rva >= address && rva < address + size) return exe.readUInt32LE(section + 20) + rva - address;
  }
  throw new Error(`Invalid import RVA: ${rva}`);
}
const imports = [];
const importRva = exe.readUInt32LE(optional + 120);
if (importRva) {
  for (let entry = offset(importRva); exe.readUInt32LE(entry + 12); entry += 20) {
    const name = offset(exe.readUInt32LE(entry + 12));
    imports.push(exe.toString('ascii', name, exe.indexOf(0, name)));
  }
}
const installerScript = fs.readFileSync(path.join(output, 'nsis/x64/installer.nsi'), 'utf8');
if (imports.some((name) => name.toLowerCase() === 'webview2loader.dll')) {
  const loader = fs.readFileSync(path.join(output, 'WebView2Loader.dll'));
  const loaderPe = loader.readUInt32LE(0x3c);
  if (loader.toString('ascii', loaderPe, loaderPe + 4) !== 'PE\0\0' || loader.readUInt16LE(loaderPe + 4) !== 0x8664) {
    throw new Error('WebView2Loader.dll must match Windows x64');
  }
  if (!/^\s*File\s+.*["/]oname=WebView2Loader\.dll"/im.test(installerScript)) {
    throw new Error('NSIS omitted required WebView2Loader.dll; build with an explicit Windows GNU target');
  }
}
const installers = fs.readdirSync(path.join(output, 'bundle/nsis')).filter((name) => name.endsWith('-setup.exe'));
if (!installers.length) throw new Error('NSIS installer missing');
console.log(`PASS: Windows x64 executable, required WebView2 loader included by NSIS, ${installers.join(', ')}`);
