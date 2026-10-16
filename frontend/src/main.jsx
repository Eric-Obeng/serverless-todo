import React from 'react';
import ReactDOM from 'react-dom/client';
import '@aws-amplify/ui-react/styles.css';
import './styles.css';
import { configureAmplify } from './amplifyConfig';
import App from './App';

configureAmplify();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
