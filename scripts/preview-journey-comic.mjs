// Read-only local artwork preview. No Tauri, credentials or user database.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../public/onboarding/journey-comic/',import.meta.url));
const port=Number(process.env.XMISSION_COMIC_PREVIEW_PORT??45189);
const server=http.createServer(async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const name=new URL(req.url,'http://127.0.0.1').pathname.slice(1)||'preview.html';
  const allowedImage=/^\d{2}-[a-z-]+\.png$/.test(name)||/^nine\/\d{2}-[a-z-]+-[123]\.png$/.test(name);
  if(!allowedImage&&!['preview.html','player.js','score/devils-love-09.mp3'].includes(name)){res.writeHead(404);res.end();return;}
  try{const data=await readFile(path.join(root,name));const type=name.endsWith('.png')?'image/png':name.endsWith('.mp3')?'audio/mpeg':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8';res.writeHead(200,{'Content-Type':type,'Content-Length':data.length,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log(`Comic preview: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
