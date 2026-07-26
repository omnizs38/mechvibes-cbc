import { createRoot } from 'react-dom/client';
import '../styles/base.css';
import './editor.css';
import { applyStoredTheme } from '../shared/theme';
import { EditorApp } from './EditorApp';

applyStoredTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer root element is missing.');
}

createRoot(container).render(<EditorApp />);
