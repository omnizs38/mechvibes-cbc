import { createRoot } from 'react-dom/client';
import '../styles/base.css';
import './debug.css';
import { applyStoredTheme } from '../shared/theme';
import { DebugApp } from './DebugApp';

applyStoredTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer root element is missing.');
}

createRoot(container).render(<DebugApp />);
