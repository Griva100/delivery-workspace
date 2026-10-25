import React, { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Workspace, Task, Status, Report } from '../shared/types.ts';
import './style.css';
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error || 'Unable to complete this request.', response.status);
  return data;
}
const statuses: Status[] = ['todo', 'in_progress', 'done'];
const labels = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} aria-labelledby="dialog-title">
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [data, setData] = useState<Workspace | null>(null),
    [initial, setInitial] = useState(true),
    [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [projectId, setProjectId] = useState(''),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'project' | 'task' | null>(null),
    [editing, setEditing] = useState<Task | null>(null),
    [reports, setReports] = useState<Report[]>([]);
  async function load() {
    const next = await api<Workspace>('/api/workspace');
    setData(next);
    setProjectId((current) =>
      next.projects.some((p) => p.id === current) ? current : next.projects[0]?.id || '',
    );
  }
  useEffect(() => {
    load()
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setInitial(false));
  }, []);
  async function loadReports() {
    if (projectId && !data?.sample)
      setReports(await api<Report[]>(`/api/projects/${projectId}/reports`));
    else setReports([]);
  }
  useEffect(() => {
    let ignore = false;
    if (projectId && !data?.sample) {
      api<Report[]>(`/api/projects/${projectId}/reports`)
        .then((rows) => {
          if (!ignore) setReports(rows);
        })
        .catch(() => {});
    } else setReports([]);
    return () => {
      ignore = true;
    };
  }, [projectId, data?.sample]);
  useEffect(() => {
    if (!reports.some((r) => r.state === 'pending' || r.state === 'processing')) return;
    const timer = setTimeout(() => {
      loadReports().catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [reports, projectId]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed.');
      if (e instanceof ApiError && e.status === 409) await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function open(kind: 'project' | 'task', task: Task | null = null) {
    setEditing(task);
    setError('');
    setModal(kind);
  }
  function close() {
    if (!busy) {
      setModal(null);
      setError('');
    }
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act(async () => {
      const body = {
        email: form.get('email'),
        password: form.get('password'),
        ...(authMode === 'register' ? { name: form.get('name') } : {}),
      };
      await api(`/api/auth/${authMode}`, 'POST', body);
      await load();
      setNotice('Your workspace is ready.');
    });
  }
  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act(async () => {
      const result = await api<{ id: string }>('/api/projects', 'POST', {
        name: form.get('name'),
        description: form.get('description'),
      });
      await load();
      setProjectId(result.id);
      setModal(null);
      setNotice('Project created.');
    });
  }
  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act(async () => {
      const task = {
        title: form.get('title'),
        description: form.get('description'),
        priority: form.get('priority'),
        status: form.get('status'),
        dueDate: form.get('dueDate') || null,
      };
      if (editing)
        await api(`/api/tasks/${editing.id}`, 'PATCH', { ...task, version: editing.version });
      else await api(`/api/projects/${projectId}/tasks`, 'POST', { tasks: [task] });
      await load();
      setModal(null);
      setNotice(editing ? 'Task updated.' : 'Task added.');
    });
  }
  async function changeStatus(task: Task, status: Status) {
    await act(async () => {
      await api(`/api/tasks/${task.id}`, 'PATCH', { status, version: task.version });
      await load();
    });
  }
  async function showSample() {
    await act(async () => {
      const sample = await api<Workspace>('/api/demo');
      setData(sample);
      setProjectId(sample.projects[0]?.id || '');
      setReports([]);
    });
  }
  if (initial)
    return (
      <div className="auth-shell">
        <p>Opening your workspace…</p>
      </div>
    );
  if (!data)
    return (
      <div className="auth-shell">
        <section className="auth-intro">
          <a className="auth-brand" href="/">
            delivery<span>WORKSPACE</span>
          </a>
          <p className="eyebrow">PLAN CLEARLY. MOVE FORWARD.</p>
          <h1>
            Your next project,
            <br />
            in a better place.
          </h1>
          <p>
            Keep tasks, priorities and delivery reports together. A clear view of what matters, from
            first idea to finished work.
          </p>
          <div className="auth-features">
            <span>
              01 <b>Plan the work</b>
            </span>
            <span>
              02 <b>Track the details</b>
            </span>
            <span>
              03 <b>Share the progress</b>
            </span>
          </div>
          <button className="secondary" disabled={busy} onClick={showSample}>
            Explore a sample workspace ↗
          </button>
        </section>
        <section className="auth-card">
          <p className="eyebrow">YOUR SPACE TO DELIVER</p>
          <h2>{authMode === 'register' ? 'Create your workspace' : 'Welcome back'}</h2>
          <p>
            {authMode === 'register'
              ? 'Start organising your next project.'
              : 'Sign in to continue your work.'}
          </p>
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={authenticate}>
            {authMode === 'register' && (
              <label>
                Your name
                <input name="name" minLength={2} maxLength={60} autoComplete="name" required />
              </label>
            )}
            <label>
              Email address
              <input name="email" type="email" maxLength={254} autoComplete="email" required />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                required
              />
            </label>
            <small className="muted">Use at least 10 characters.</small>
            <button className="primary auth-submit" disabled={busy}>
              {busy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setAuthMode((v) => (v === 'register' ? 'login' : 'register'));
              setError('');
            }}
          >
            {authMode === 'register'
              ? 'Already have an account? Sign in'
              : 'New here? Create an account'}
          </button>
        </section>
      </div>
    );
  const current = data.projects.find((p) => p.id === projectId),
    projectTasks = data.tasks.filter((t) => t.projectId === projectId),
    tasks = projectTasks.filter((t) =>
      `${t.title} ${t.description}`.toLowerCase().includes(search.toLowerCase()),
    );
  const done = projectTasks.filter((t) => t.status === 'done').length,
    percent = projectTasks.length ? Math.round((done / projectTasks.length) * 100) : 0,
    readOnly = !!data.sample;
  const initials =
    data.user?.name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'DW';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">
            d<span>·</span>
          </span>
          <span>
            delivery<span className="brand-small">WORKSPACE</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="avatar">{initials}</span>
          <div>
            {data.user?.name || 'Sample workspace'}
            <small>{data.user ? 'Your delivery space' : 'Explore the workflow'}</small>
          </div>
        </div>
        <div className="nav-heading">
          YOUR PROJECTS
          <button disabled={readOnly} aria-label="Create project" onClick={() => open('project')}>
            +
          </button>
        </div>
        <nav aria-label="Projects">
          {data.projects.map((project) => (
            <button
              key={project.id}
              className={`project-link ${project.id === projectId ? 'active' : ''}`}
              onClick={() => {
                setProjectId(project.id);
                setSearch('');
              }}
            >
              <span className="project-dot" />
              {project.name}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">MADE FOR MOMENTUM</span>
          <p>
            One place for the work
            <br />
            that moves you forward.
          </p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> Project overview
          </span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                if (!readOnly) await api('/api/auth/logout', 'POST');
                setData(null);
                setProjectId('');
                setAuthMode('login');
                setReports([]);
              })
            }
          >
            {readOnly ? 'Sign in / Create account' : 'Sign out'}
          </button>
        </header>
        <div className="content">
          {readOnly && (
            <div className="message success">
              You are viewing sample data. Create an account to save your own projects and export
              reports.
            </div>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">A LITTLE CLARITY. A LOT OF PROGRESS.</p>
              <h1>{current?.name || 'Make room for your next idea.'}</h1>
              <p className="description">
                {current?.description ||
                  'Create a project, plan the work and track the details through to delivery.'}
              </p>
            </div>
            <button className="primary" disabled={busy || readOnly} onClick={() => open('project')}>
              + New project
            </button>
          </div>
          <div aria-live="polite">
            {error && !modal && (
              <div className="message error" role="alert">
                {error}
              </div>
            )}
            {notice && <div className="message success">{notice}</div>}
          </div>
          <section className="stats" aria-label="Project metrics">
            <div className="stat">
              <span>Total tasks</span>
              <strong>
                {projectTasks.length}
                <small>in this project</small>
              </strong>
            </div>
            <div className="stat">
              <span>In progress</span>
              <strong>
                {projectTasks.filter((t) => t.status === 'in_progress').length}
                <small>moving forward</small>
              </strong>
            </div>
            <div className="stat">
              <span>Open high priority</span>
              <strong>
                {projectTasks.filter((t) => t.priority === 'high' && t.status !== 'done').length}
                <small>needs your focus</small>
              </strong>
            </div>
            <div className="stat">
              <span>Completion</span>
              <strong>
                {percent}
                <em>%</em>
                <small>
                  {done} of {projectTasks.length} complete
                </small>
              </strong>
              <div className="progress">
                <div style={{ width: `${percent}%` }} />
              </div>
            </div>
          </section>
          <section className="planning-card">
            <div className="spark">↗</div>
            <div>
              <h2>Progress is easier to share when it is clear.</h2>
              <p>Export a project report with task status, priority and due dates.</p>
            </div>
            <button
              className="secondary"
              disabled={busy || !current || readOnly}
              onClick={() =>
                act(async () => {
                  await api(`/api/projects/${projectId}/reports`, 'POST');
                  await loadReports();
                  setNotice('Your report is being prepared.');
                })
              }
            >
              Export report ↗
            </button>
          </section>
          <section aria-labelledby="board-title">
            <div className="board-toolbar">
              <div>
                <h2 id="board-title">Delivery board</h2>
                <span className="muted">
                  {search ? `${tasks.length} matching tasks` : 'A clear view of what happens next.'}
                </span>
              </div>
              <div className="toolbar-actions">
                <input
                  className="search"
                  aria-label="Search tasks"
                  placeholder="Search tasks…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className="secondary"
                  disabled={busy || !current || readOnly}
                  onClick={() => open('task')}
                >
                  + Add task
                </button>
              </div>
            </div>
            <div className="board">
              {statuses.map((status) => (
                <div className={`column ${status}`} key={status}>
                  <div className="column-title">
                    <span>
                      <i />
                      {labels[status]}
                    </span>
                    <b>{tasks.filter((t) => t.status === status).length}</b>
                  </div>
                  <div className="cards">
                    {tasks
                      .filter((t) => t.status === status)
                      .map((task) => (
                        <article className="task" key={task.id}>
                          <div className="task-top">
                            <span className={`priority ${task.priority}`}>
                              {task.priority} priority
                            </span>
                            <button
                              className="remove"
                              aria-label={`Delete ${task.title}`}
                              disabled={busy || readOnly}
                              onClick={() =>
                                act(async () => {
                                  await api(`/api/tasks/${task.id}`, 'DELETE');
                                  await load();
                                  setNotice('Task removed.');
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                          <button
                            className="task-edit"
                            disabled={readOnly}
                            onClick={() => open('task', task)}
                            aria-label={`Edit ${task.title}`}
                          >
                            <h3>{task.title}</h3>
                          </button>
                          <p>{task.description}</p>
                          {task.dueDate && (
                            <span className="due-date">
                              Due{' '}
                              {new Date(task.dueDate + 'T12:00:00').toLocaleDateString(undefined, {
                                day: 'numeric',
                                month: 'short',
                              })}
                            </span>
                          )}
                          <div className="task-footer">
                            <span className="task-id">TASK-{task.id.slice(-4).toUpperCase()}</span>
                            <select
                              disabled={busy || readOnly}
                              aria-label={`Status for ${task.title}`}
                              value={task.status}
                              onChange={(e) => changeStatus(task, e.target.value as Status)}
                            >
                              {statuses.map((s) => (
                                <option key={s} value={s}>
                                  {labels[s]}
                                </option>
                              ))}
                            </select>
                          </div>
                        </article>
                      ))}
                    {!tasks.some((t) => t.status === status) && (
                      <div className="empty-column">
                        {search ? 'No matching tasks' : 'Room for your next step'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
          {reports.length > 0 && (
            <section className="activity reports">
              <h2>Delivery reports</h2>
              {reports.map((report) => (
                <div key={report.id}>
                  <span className="activity-dot" />
                  <p>
                    {new Date(report.createdAt).toLocaleString()}{' '}
                    <b className="report-state">
                      {report.state === 'pending'
                        ? 'Queued'
                        : report.state === 'completed'
                          ? 'Ready'
                          : report.state}
                    </b>
                    {report.error && <span> · {report.error}</span>}
                  </p>
                  {report.state === 'completed' && (
                    <a className="download-report" href={`/api/reports/${report.id}/download`}>
                      Download CSV ↓
                    </a>
                  )}
                </div>
              ))}
            </section>
          )}
          <section className="activity">
            <h2>Recent activity</h2>
            {data.activity.length ? (
              data.activity.map((a) => (
                <div key={a.id}>
                  <span className="activity-dot" />
                  <p>{a.message}</p>
                  <time dateTime={a.createdAt}>
                    {new Date(a.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              ))
            ) : (
              <p className="activity-empty">Your next step starts the story.</p>
            )}
          </section>
          <footer className="footer">
            Delivery Workspace <span>Plan with clarity. Deliver with confidence.</span>
          </footer>
        </div>
      </main>
      {modal && (
        <Modal
          title={modal === 'project' ? 'Create a project' : editing ? 'Edit task' : 'Add a task'}
          close={close}
        >
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          {modal === 'project' ? (
            <form onSubmit={saveProject}>
              <label>
                Project name
                <input name="name" minLength={3} maxLength={100} required autoFocus />
              </label>
              <label>
                Description
                <textarea name="description" maxLength={1000} rows={3} />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Create project'}
              </button>
            </form>
          ) : (
            <form onSubmit={saveTask}>
              <label>
                Task title
                <input
                  name="title"
                  defaultValue={editing?.title || ''}
                  minLength={3}
                  maxLength={160}
                  required
                  autoFocus
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={editing?.description || ''}
                  maxLength={2000}
                  rows={3}
                />
              </label>
              <div className="form-row">
                <label>
                  Priority
                  <select name="priority" defaultValue={editing?.priority || 'medium'}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={editing?.status || 'todo'}>
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {labels[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Due date (optional)
                <input name="dueDate" type="date" defaultValue={editing?.dueDate || ''} />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add task'}
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
