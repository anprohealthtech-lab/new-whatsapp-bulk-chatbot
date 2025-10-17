import React from 'react';
import ReactDOM from 'react-dom';
import App from './components/App'; // Adjust the import based on your main component's location

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    rootElement
  );
} else {
  console.error('Root element not found');
}