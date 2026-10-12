import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const directory='.release-tools/panda-csp-check';await mkdir(directory,{recursive:true});
// Bundle the real production renderer, then forbid string code generation as the WebView CSP does.
await build({stdin:{contents:`
import {pandaRenderer} from './src/companions/rig/renderer.ts';
import {AbstractRenderer} from './node_modules/pixi.js/lib/rendering/renderers/shared/system/AbstractRenderer.mjs';
import {GlShaderSystem} from './node_modules/pixi.js/lib/rendering/renderers/gl/shader/GlShaderSystem.mjs';
if(typeof pandaRenderer!=='function')throw Error('Production renderer absent');
AbstractRenderer.prototype._unsafeEvalCheck();
const sync=GlShaderSystem.prototype._generateShaderSync.call({},{groups:{}});
sync({gl:{},shader:{_getProgramData:()=>({uniformData:{}})}},{groups:{},glProgram:{}},{blockIndex:0,textureCount:0});
console.log('PASS production panda renderer: CSP prohibits eval; initialization and real shader sync remain usable');
`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',outfile:directory+'/probe.mjs',logLevel:'silent'});
const result=spawnSync(process.execPath,['--disallow-code-generation-from-strings',directory+'/probe.mjs'],{encoding:'utf8'});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0,'Production panda renderer must initialize without unsafe-eval');
