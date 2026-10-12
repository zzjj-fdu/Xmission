// Local deterministic acceptance provider, never included in the application.
import http from 'node:http';
let requests=0;
const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/v1/models'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'inn-fixture-model',object:'model'}]}));return;}
  let body='';for await(const c of req)body+=c;
  const input=JSON.parse(body||'{}');requests++;
  const latest=input.messages?.filter(m=>m.role==='tool').at(-1);const text=typeof latest?.content==='string'?latest.content:JSON.stringify(latest?.content??'');
  const found=text.match(/"(?:id|name)"\s*:\s*"([^"]*xmission_list_tasks[^"]*)"/);
  const toolResult=text.includes('"mcpTool": "xmission_list_tasks"');
  const plain=!input.tools?.length;
  let message;
  if(plain){const parse=input.messages?.some(m=>typeof m.content==='string'&&m.content.includes('importance'));message={role:'assistant',content:parse?JSON.stringify({title:'验收：归还图书',details:null,importance:3,urgency:3,deadline:null,estimatedMin:15,icon:'read',recurrence:'none',recurDays:null}):'通路正常'};}
  else if(toolResult)message={role:'assistant',content:'已从 Xmission 账簿查询到实际任务。'};
  else message={role:'assistant',content:null,tool_calls:[{id:'inn-fixture-call-'+requests,type:'function',function:{name:found?'tool_call':'tool_search',arguments:JSON.stringify(found?{id:found[1],args:{}}:{query:'xmission_list_tasks'})}}]};
  if(input.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const delta={...message};if(delta.tool_calls)delta.tool_calls=delta.tool_calls.map((c,index)=>({...c,index}));res.write('data: '+JSON.stringify({id:'inn-fixture',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:input.model,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'inn-fixture',object:'chat.completion.chunk',model:input.model,choices:[{index:0,delta:{},finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})+'\n\ndata: [DONE]\n\n');res.end();}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'inn-fixture',object:'chat.completion',model:input.model,choices:[{index:0,message,finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}
});server.listen(44975,'127.0.0.1',()=>console.log('Isolated provider ready on 127.0.0.1:44975'));
