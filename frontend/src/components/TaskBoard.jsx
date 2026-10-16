import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api/tasks';
import TaskForm from './TaskForm';
import TaskItem from './TaskItem';

const TABS = ['Pending', 'Completed', 'Expired', 'All'];
const REFRESH_MS = 15_000; // pick up server-side expiries without a manual refresh

export default function TaskBoard() {
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState('Pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const { items } = await api.listTasks();
      setTasks(items);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (fn) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t, t === 'All' ? tasks.length : tasks.filter((x) => x.status === t).length])),
    [tasks],
  );
  const visible = tab === 'All' ? tasks : tasks.filter((t) => t.status === tab);

  return (
    <div className="board">
      <TaskForm onCreate={(task) => run(() => api.createTask(task))} />

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${t === tab ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t} <span className="count">{counts[t]}</span>
          </button>
        ))}
        <button className="btn secondary refresh" onClick={refresh}>
          Refresh
        </button>
      </nav>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No {tab === 'All' ? '' : tab.toLowerCase()} tasks.</p>
      ) : (
        <ul className="task-list">
          {visible.map((task) => (
            <TaskItem
              key={task.taskId}
              task={task}
              onUpdate={(changes) => run(() => api.updateTask(task.taskId, changes))}
              onDelete={() => run(() => api.deleteTask(task.taskId))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
