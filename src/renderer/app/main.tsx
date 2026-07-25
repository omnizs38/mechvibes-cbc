import { createRoot } from 'react-dom/client';
import '../styles/base.css';
import './app.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer root element is missing.');
}

// StrictMode is intentionally omitted: the audio engine and the soundpack
// manager are single-instance side effects that must not be mounted twice.
createRoot(container).render(<App />);
