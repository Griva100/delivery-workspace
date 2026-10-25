import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Deps,transaction,invalidate } from './deps.js';
import { currentUser,hashPassword,verifyPassword,issueSession,sessionToken,sha256,allowAuthAttempt } from './auth.js';
import { processReport } from './reports.js';
import type { User } from '../shared/types.js';
const uuid=z.string().uuid();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Invalid date');
const taskFields={title:z.string().trim().min(3).max(160),description:z.string().trim().max(2000),status:z.enum(['todo','in_progress','done']),priority:z.enum(['low','medium','high']),dueDate:date.nullable()};
const taskCreate=z.object({...taskFields,description:taskFields.description.default(''),status:taskFields.status.default('todo'),priority:taskFields.priority.default('medium'),dueDate:taskFields.dueDate.default(null)}).strict();
const taskUpdate=z.object({...taskFields,version:z.number().int().positive()}).partial().required({version:true}).strict().refine(v=>Object.keys(v).length>1,'Provide a field to update');
const projectInput=z.object({name:z.string().trim().min(3).max(100),description:z.string().trim().max(1000).default('')}).strict();
const authInput=z.object({email:z.string().trim().toLowerCase().email().max(254),password:z.string().min(10).max(128)});
const selectTask="SELECT t.id,t.project_id AS \"projectId\",t.title,t.description,t.status,t.priority,to_char(t.due_date,'YYYY-MM-DD') AS \"dueDate\",t.version FROM tasks t JOIN projects p ON p.id=t.project_id";

export function createApp(d:Deps){
 const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
 app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');const origin=req.headers.origin;if(origin&&origin!==`${req.protocol}://${req.get('host')}`&&origin!==process.env.APP_URL){res.status(403).json({error:'Cross-origin request rejected'});return;}next();});
 app.use(express.json({limit:'24kb'}));
 app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 app.get('/api/health',async(_req,res)=>{await d.pool.query('SELECT 1');res.json({status:'ok',reports:d.reportMode});});
 app.post('/api/auth/register',async(req,res)=>{
  const input=authInput.extend({name:z.string().trim().min(2).max(60)}).strict().parse(req.body);
  if(!await allowAuthAttempt(d,req,input.email)){res.status(429).json({error:'Too many attempts. Try again later.'});return;}
  const password=await hashPassword(input.password);const id=randomUUID();
  await transaction(d.pool,async client=>{await client.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[id,input.email,input.name,password]);await client.query('INSERT INTO activity(user_id,message) VALUES($1,$2)',[id,'Created your workspace']);});
  await issueSession(d,req,res,id);res.status(201).json({id,name:input.name,email:input.email});
 });
 app.post('/api/auth/login',async(req,res)=>{
  const input=authInput.strict().parse(req.body);
  if(!await allowAuthAttempt(d,req,input.email)){res.status(429).json({error:'Too many attempts. Try again later.'});return;}
  const result=await d.pool.query('SELECT * FROM users WHERE email=$1',[input.email]);const row=result.rows[0];
  if(!row||!await verifyPassword(input.password,row.password_hash)){res.status(401).json({error:'Email or password is incorrect.'});return;}
  await issueSession(d,req,res,row.id);res.json({id:row.id,name:row.name,email:row.email});
 });
 app.post('/api/auth/logout',async(req,res)=>{const token=sessionToken(req);if(token)await d.pool.query('DELETE FROM sessions WHERE token_hash=$1',[sha256(token)]);res.clearCookie('delivery_session',{path:'/'});res.status(204).end();});
 app.get('/api/demo',(_req,res)=>res.json({user:null,sample:true,projects:[{id:'sample-project',name:'Customer onboarding',description:'Sample workspace: help customers reach their first useful outcome.'}],tasks:[{id:'sample-1',projectId:'sample-project',title:'Build onboarding checklist',description:'Show clear steps, loading states and useful errors.',status:'in_progress',priority:'high',dueDate:null,version:1},{id:'sample-2',projectId:'sample-project',title:'Validate project APIs',description:'Validate requests and check access before reading or changing project data.',status:'done',priority:'high',dueDate:null,version:1},{id:'sample-3',projectId:'sample-project',title:'Review the welcome experience',description:'Check keyboard navigation and the mobile layout.',status:'todo',priority:'medium',dueDate:null,version:1}],activity:[]}));
 app.use('/api',async(req,res,next)=>{const user=await currentUser(d,req);if(!user){res.status(401).json({error:'Sign in to open your workspace.'});return;}res.locals.user=user;next();});
 const user=(res:express.Response)=>res.locals.user as User;
 const owns=async(projectId:string,ownerId:string)=>!!(await d.pool.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2',[projectId,ownerId])).rowCount;
 app.get('/api/workspace',async(_req,res)=>{
  const u=user(res),key=`delivery:workspace:${u.id}`;
  try{const cached=await d.cache?.get(key);if(cached){res.json({...JSON.parse(cached),user:u});return;}}catch{}
  const [projects,tasks,activity]=await Promise.all([d.pool.query('SELECT id,name,description FROM projects WHERE owner_id=$1 ORDER BY created_at,id',[u.id]),d.pool.query(selectTask+' WHERE p.owner_id=$1 ORDER BY t.created_at,t.id LIMIT 500',[u.id]),d.pool.query('SELECT id::text,message,created_at AS "createdAt" FROM activity WHERE user_id=$1 ORDER BY id DESC LIMIT 8',[u.id])]);
  const data={projects:projects.rows,tasks:tasks.rows,activity:activity.rows};try{await d.cache?.set(key,JSON.stringify(data),'EX',30);}catch{}res.json({...data,user:u});
 });
 app.post('/api/projects',async(req,res)=>{const input=projectInput.parse(req.body),u=user(res),id=randomUUID();await transaction(d.pool,async c=>{await c.query('INSERT INTO projects(id,owner_id,name,description) VALUES($1,$2,$3,$4)',[id,u.id,input.name,input.description]);await c.query('INSERT INTO activity(user_id,message) VALUES($1,$2)',[u.id,`Created project: ${input.name}`]);});await invalidate(d,u.id);res.status(201).json({id,...input});});
 app.post('/api/projects/:id/tasks',async(req,res)=>{
  const projectId=uuid.parse(req.params.id),u=user(res);if(!await owns(projectId,u.id)){res.status(404).json({error:'Project not found'});return;}
  const input=z.object({tasks:z.array(taskCreate).min(1).max(20)}).strict().parse(req.body);
  const result=await transaction(d.pool,async c=>{const rows=[];for(const task of input.tasks){const id=randomUUID();await c.query('INSERT INTO tasks(id,project_id,title,description,status,priority,due_date) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,projectId,task.title,task.description,task.status,task.priority,task.dueDate]);rows.push({id,projectId,...task,version:1});}await c.query('INSERT INTO activity(user_id,message) VALUES($1,$2)',[u.id,`Added ${rows.length} task${rows.length===1?'':'s'}`]);return rows;});await invalidate(d,u.id);res.status(201).json(result);
 });
 app.patch('/api/tasks/:id',async(req,res)=>{
  const id=uuid.parse(req.params.id),input=taskUpdate.parse(req.body),u=user(res);
  const found=await d.pool.query(selectTask+' WHERE t.id=$1 AND p.owner_id=$2',[id,u.id]);if(!found.rowCount){res.status(404).json({error:'Task not found'});return;}
  const task={...found.rows[0],...input};const result=await d.pool.query('UPDATE tasks SET title=$1,description=$2,status=$3,priority=$4,due_date=$5,version=version+1,updated_at=now() WHERE id=$6 AND version=$7 RETURNING version',[task.title,task.description,task.status,task.priority,task.dueDate,id,input.version]);
  if(!result.rowCount){res.status(409).json({error:'This task changed in another session. Refresh and try again.'});return;}
  await d.pool.query('INSERT INTO activity(user_id,message) VALUES($1,$2)',[u.id,`Updated task: ${task.title}`]);await invalidate(d,u.id);res.json({...task,version:result.rows[0].version});
 });
 app.delete('/api/tasks/:id',async(req,res)=>{const id=uuid.parse(req.params.id),u=user(res);const result=await d.pool.query('DELETE FROM tasks t USING projects p WHERE t.project_id=p.id AND t.id=$1 AND p.owner_id=$2 RETURNING t.title',[id,u.id]);if(!result.rowCount){res.status(404).json({error:'Task not found'});return;}await invalidate(d,u.id);res.status(204).end();});
 app.post('/api/projects/:id/reports',async(req,res)=>{
  const projectId=uuid.parse(req.params.id),u=user(res);if(!await owns(projectId,u.id)){res.status(404).json({error:'Project not found'});return;}
  const id=randomUUID();await d.pool.query('INSERT INTO reports(id,user_id,project_id) VALUES($1,$2,$3)',[id,u.id,projectId]);
  try{if(d.reportMode==='queue'){await d.queue!.add('csv-export',{reportId:id,userId:u.id},{jobId:id,attempts:3,backoff:{type:'exponential',delay:1000},removeOnComplete:{count:100},removeOnFail:{count:100}});}else{await processReport(d.pool,id,u.id);}res.status(202).json({id});}
  catch{await d.pool.query("UPDATE reports SET state='failed',error='Report service is unavailable' WHERE id=$1",[id]);res.status(503).json({error:'Report service is unavailable. Please try again later.'});}
 });
 app.get('/api/projects/:id/reports',async(req,res)=>{const id=uuid.parse(req.params.id),u=user(res);if(!await owns(id,u.id)){res.status(404).json({error:'Project not found'});return;}const result=await d.pool.query('SELECT id,state,error,created_at AS "createdAt" FROM reports WHERE project_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 5',[id,u.id]);res.json(result.rows);});
 app.get('/api/reports/:id/download',async(req,res)=>{const id=uuid.parse(req.params.id);const result=await d.pool.query('SELECT content,state FROM reports WHERE id=$1 AND user_id=$2',[id,user(res).id]);if(!result.rowCount){res.status(404).json({error:'Report not found'});return;}if(result.rows[0].state!=='completed'){res.status(409).json({error:'Report is not ready yet'});return;}res.type('text/csv').setHeader('Content-Disposition','attachment; filename="delivery-report.csv"');res.send(result.rows[0].content);});
 app.use('/api',(_req,res)=>res.status(404).json({error:'API route not found'}));
 const errorHandler:express.ErrorRequestHandler=(error,_req,res,_next)=>{if(error instanceof z.ZodError){res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});return;}if(error?.code==='23505'){res.status(409).json({error:'An account with this email already exists.'});return;}if(error?.type==='entity.too.large'){res.status(413).json({error:'Request is too large'});return;}if(error instanceof SyntaxError){res.status(400).json({error:'Invalid JSON request'});return;}console.error('API request failed',error?.code??'unexpected');res.status(500).json({error:'The request could not be completed. Please try again.'});};app.use(errorHandler);
 return app;
}
