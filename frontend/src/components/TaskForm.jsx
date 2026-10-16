import { useState } from 'react';

const today = () => new Date().toISOString().slice(0, 10);
const empty = () => ({ title: '', description: '', date: today(), deadline: '' });

export default function TaskForm({ onCreate }) {
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    await onCreate({
      title: form.title,
      description: form.description,
      date: form.date || undefined,
      // Empty -> backend default (now + 5 minutes)
      deadline: form.deadline ? new Date(form.deadline).toISOString() : undefined,
    });
    setForm(empty());
    setSubmitting(false);
  };

  return (
    <form className="task-form card" onSubmit={submit}>
      <h2>New task</h2>
      <input placeholder="Title" value={form.title} onChange={set('title')} required maxLength={200} />
      <textarea placeholder="Description" value={form.description} onChange={set('description')} rows={2} />
      <div className="row">
        <label>
          Date
          <input type="date" value={form.date} onChange={set('date')} />
        </label>
        <label>
          Deadline <span className="muted">(default: 5 min from now)</span>
          <input type="datetime-local" value={form.deadline} onChange={set('deadline')} />
        </label>
      </div>
      <button className="btn" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add task'}
      </button>
    </form>
  );
}
