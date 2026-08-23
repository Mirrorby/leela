import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Путь к фоновой мандале зависит от base (см. vite.config.ts: base: './'),
// поэтому не может быть зашит в CSS как абсолютный '/bg/mandala.svg' —
// на GitHub Pages в подпапке (mirrorby.github.io/leela/) это привело бы к
// 404. Тот же приём уже используется для картинки доски (getBoardImageSrc).
//
// ВАЖНО (найденный баг): просто относительный url('./bg/mandala.svg') в
// custom property здесь не работает надёжно — когда этот токен
// подставляется в background-image: var(--bg-mandala-url) внутри
// СОБРАННОГО css-файла (dist/assets/index-*.css), браузер резолвит
// относительный путь ОТНОСИТЕЛЬНО ЭТОГО css-файла (т.е. .../assets/...),
// а не относительно страницы — картинка тихо не находится (404), просто
// показывается только сплошной CSS-градиент под ней, без узора. Поэтому
// собираем гарантированно абсолютный URL через `new URL(...)`.
document.documentElement.style.setProperty(
  '--bg-mandala-url',
  `url('${new URL(`${import.meta.env.BASE_URL}bg/mandala.svg`, window.location.href).href}')`
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
