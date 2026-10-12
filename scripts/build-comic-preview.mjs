import {build} from 'esbuild';
await build({entryPoints:['scripts/comic-preview-entry.ts'],bundle:true,format:'esm',target:'es2022',minify:true,outfile:'public/onboarding/journey-comic/player.js'});
console.log('Standalone preview shares the actual app player, music clock and subtitles.');
