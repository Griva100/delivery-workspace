export type Status = 'todo' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export type User = { id: string; name: string; email: string };
export type Project = { id: string; name: string; description: string };
export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  version: number;
};
export type Report = {
  id: string;
  state: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  error?: string;
};
export type Workspace = {
  user: User | null;
  projects: Project[];
  tasks: Task[];
  activity: Array<{ id: string; message: string; createdAt: string }>;
  sample?: boolean;
};
