import { del, get, post, put } from 'aws-amplify/api';
import { API_NAME } from '../amplifyConfig';

async function json(operation) {
  try {
    const { body } = await operation.response;
    return await body.json();
  } catch (err) {
    // Surface the API's { message } when available
    const raw = err?.response?.body;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        throw new Error(parsed.message ?? 'Request failed');
      } catch (e) {
        if (e instanceof SyntaxError) throw new Error(raw);
        throw e;
      }
    }
    throw err;
  }
}

export const listTasks = (status) =>
  json(get({ apiName: API_NAME, path: '/tasks', options: status ? { queryParams: { status } } : {} }));

export const createTask = (task) => json(post({ apiName: API_NAME, path: '/tasks', options: { body: task } }));

export const updateTask = (taskId, changes) =>
  json(put({ apiName: API_NAME, path: `/tasks/${taskId}`, options: { body: changes } }));

export const deleteTask = async (taskId) => {
  await del({ apiName: API_NAME, path: `/tasks/${taskId}` }).response;
};
