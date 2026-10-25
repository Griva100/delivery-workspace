import pg from 'pg';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
export type Deps={pool:pg.Pool;cache:Redis|null;queue:Queue|null;reportMode:'queue'|'inline'};
export function redisOptions(url:string,worker=false){const u=new URL(url);return {host:u.hostname,port:Number(u.port||6379),username:u.username||undefined,password:u.password?decodeURIComponent(u.password):undefined,...(u.protocol==='rediss:'?{tls:{}}:{}),maxRetriesPerRequest:worker?null:1,enableOfflineQueue:worker,connectTimeout:5000};}
export function createDeps(config={database:process.env.DATABASE_URL,redis:process.env.REDIS_URL,mode:process.env.REPORT_MODE}):Deps{
 if(!config.database)throw new Error('DATABASE_URL is required.');
 const pool=new pg.Pool({connectionString:config.database,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
 const cache=config.redis?new Redis(config.redis,{maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:3000}):null;
 cache?.on('error',()=>{});
 const reportMode=config.mode==='queue'?'queue':'inline';
 if(reportMode==='queue'&&!config.redis)throw new Error('Queue mode requires REDIS_URL.');
 const queue=reportMode==='queue'?new Queue('delivery-report-export',{connection:redisOptions(config.redis!)}):null;
 queue?.on('error',()=>{});
 return {pool,cache,queue,reportMode};
}
export async function closeDeps(d:Deps){await d.queue?.close();if(d.cache)d.cache.disconnect();await d.pool.end();}
export async function transaction<T>(pool:pg.Pool,work:(client:pg.PoolClient)=>Promise<T>):Promise<T>{const client=await pool.connect();try{await client.query('BEGIN');const value=await work(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
export async function invalidate(d:Deps,userId:string){try{await d.cache?.del(`delivery:workspace:${userId}`);}catch{/* Database remains authoritative if cache is unavailable. */}}
