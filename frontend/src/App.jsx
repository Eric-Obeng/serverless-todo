import { Authenticator } from '@aws-amplify/ui-react';
import TaskBoard from './components/TaskBoard';

export default function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="app">
          <header className="app-header">
            <h1>Serverless To-Do</h1>
            <div className="user">
              <span>{user?.signInDetails?.loginId}</span>
              <button className="btn secondary" onClick={signOut}>
                Sign out
              </button>
            </div>
          </header>
          <main>
            <TaskBoard />
          </main>
        </div>
      )}
    </Authenticator>
  );
}
