import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Путь к фоновой мандале зависит от base (см. vite.config.ts: base: './'),
// поэтому не может быть зашит в CSS как абсолютный '/bg/mandala.svg' —
// на GitHub Pages в подпапке (mirrorby.github.io/leela/) это привело бы к
// 404. Тот же приём уже используется для картинки доски (getBoardImageSrc).
document.documentElement.style.setProperty(
  '--bg-mandala-url',
  `url('${import.meta.env.BASE_URL}bg/mandala.svg')`
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
