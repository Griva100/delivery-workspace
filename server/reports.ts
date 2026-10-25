import type pg from 'pg';
import { Worker } from 'bullmq';
import { redisOptions } from './deps.js';
export function csvCell(value:unknown){let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
export async function processReport(pool:pg.Pool,reportId:string,userId:string){
 const claimed=await pool.query("UPDATE reports SET state='processing',error=null,updated_at=now() WHERE id=$1 AND user_id=$2 AND state<>'completed' RETURNING project_id",[reportId,userId]);
 if(!claimed.rowCount)return;
 try{
  const tasks=await pool.query("SELECT t.title,t.description,t.status,t.priority,to_char(t.due_date,'YYYY-MM-DD') AS due FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.project_id=$1 AND p.owner_id=$2 ORDER BY t.created_at,t.id",[claimed.rows[0].project_id,userId]);
  const rows=[['Title','Description','Status','Priority','Due date'],...tasks.rows.map(t=>[t.title,t.description,t.status,t.priority,t.due])];
  const content=rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
  await pool.query("UPDATE reports SET state='completed',content=$1,error=null,updated_at=now() WHERE id=$2 AND user_id=$3",[content,reportId,userId]);
 }catch(error){await pool.query("UPDATE reports SET state='failed',error='Unable to build report',updated_at=now() WHERE id=$1 AND user_id=$2",[reportId,userId]);throw error;}
}
export function startReportWorker(pool:pg.Pool,redisUrl:string){const worker=new Worker('delivery-report-export',async job=>{const {reportId,userId}=job.data as {reportId:string;userId:string};await processReport(pool,reportId,userId);},{connection:redisOptions(redisUrl,true),concurrency:2});worker.on('error',()=>{});return worker;}
