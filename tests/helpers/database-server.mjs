// A local integration-test bridge, never deployed. It executes the real SQL migration.
// It does not implement Supabase GoTrue or WebSocket Realtime.
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createHarness} from '../../scripts/database-harness.mjs';
const {db,run}=await createHarness();
const tokens=new Map();
const server=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5174');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,content-profile,accept-profile,prefer');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Content-Type','application/json');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 if(req.url==='/health'){res.end('{"ready":true}');return;}
 try {
  let text='';for await(const chunk of req){text+=chunk;if(text.length>1e6)throw Error('Body too large');}const body=text?JSON.parse(text):{};
  if(req.url?.startsWith('/auth/v1/signup')){
   const uid=randomUUID();await db.query('insert into auth.users values($1)',[uid]);
   const user={id:uid,aud:'authenticated',role:'authenticated',is_anonymous:true,app_metadata:{provider:'anonymous'},user_metadata:{},created_at:new Date().toISOString()};
   const token=`${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.test-signature`;tokens.set(token,uid);
   res.end(JSON.stringify({access_token:token,refresh_token:randomUUID(),token_type:'bearer',expires_in:3600,user}));return;
  }
  const uid=tokens.get((req.headers.authorization??'').replace(/^Bearer /,''));if(!uid){res.writeHead(401);res.end('{"message":"Authentication required"}');return;}
  if(req.url?.startsWith('/rest/v1/rpc/')){
   const name=req.url.split('/').at(-1);if(!/^[a-z_]+$/.test(name))throw Error('Invalid function');
   const args=Object.entries(body);if(args.some(([k])=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid argument');
   const result=await run(uid,async()=>db.query(`select public.${name}(${args.map(([k],i)=>`${k} => $${i+1}`).join(',')}) as result`,args.map(([,v])=>v)));
   res.end(JSON.stringify(result.rows[0].result));return;
  }
  res.writeHead(404);res.end('{"message":"Unsupported test endpoint"}');
 }catch(e){res.writeHead(400);res.end(JSON.stringify({message:e.message,code:e.code??'TEST_ERROR'}));}
});
server.listen(54321,'127.0.0.1',()=>console.log('PostgreSQL test bridge ready on 54321'));
process.on('SIGTERM',()=>server.close(()=>void db.close().then(()=>process.exit())));
