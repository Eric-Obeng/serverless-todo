import { useEffect, useState } from 'react';

// ISO -> value for <input type="datetime-local"> in the browser's timezone
const toLocalInput = (iso) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function useCountdown(deadline, active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return 'deadline passed - expiring…';
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s left`;
}

export default function TaskItem({ task, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const isPending = task.status === 'Pending';
  const countdown = useCountdown(task.deadline, isPending);

  const startEdit = () => {
    setDraft({ title: task.title, description: task.description, date: task.date, deadline: toLocalInput(task.deadline) });
    setEditing(true);
  };

  const save = async () => {
    const changes = { title: draft.title, description: draft.description, date: draft.date };
    const newDeadline = new Date(draft.deadline).toISOString();
    if (task.status !== 'Expired' && newDeadline !== new Date(task.deadline).toISOString()) {
      changes.deadline = newDeadline;
    }
    await onUpdate(changes);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="task card">
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} />
        <div className="row">
          <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          {task.status !== 'Expired' && (
            <input
              type="datetime-local"
              value={draft.deadline}
              onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
            />
          )}
        </div>
        <div className="actions">
          <button className="btn" onClick={save}>Save</button>
          <button className="btn secondary" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className={`task card status-${task.status.toLowerCase()}`}>
      <div className="task-head">
        <h3>{task.title}</h3>
        <span className={`badge ${task.status.toLowerCase()}`}>{task.status}</span>
      </div>
      {task.description && <p>{task.description}</p>}
      <p className="meta">
        Date: {task.date} · Deadline: {new Date(task.deadline).toLocaleString()}
        {isPending && <> · <strong>{countdown}</strong></>}
      </p>
      <div className="actions">
        {isPending && <button className="btn" onClick={() => onUpdate({ status: 'Completed' })}>Complete</button>}
        {task.status === 'Completed' && (
          <button className="btn secondary" onClick={() => onUpdate({ status: 'Pending', deadline: new Date(Date.now() + 5 * 60_000).toISOString() })}>
            Reopen (+5 min)
          </button>
        )}
        <button className="btn secondary" onClick={startEdit}>Edit</button>
        <button className="btn danger" onClick={() => window.confirm('Delete this task?') && onDelete()}>Delete</button>
      </div>
    </li>
  );
}
