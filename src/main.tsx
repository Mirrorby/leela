import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Путь к фоновому золотому мотиву мандалы зависит от base (см.
// vite.config.ts: base: './'), поэтому не может быть зашит в CSS как
// абсолютный '/bg/mandala-motif.webp' — на GitHub Pages в подпапке
// (mirrorby.github.io/leela/) это привело бы к 404. Тот же приём уже
// используется для картинки доски (getBoardImageSrc).
//
// ВАЖНО (найденный баг): просто относительный url('./bg/...') в custom
// property здесь не работает надёжно — когда этот токен подставляется в
// background-image: var(--bg-mandala-url) внутри СОБРАННОГО css-файла
// (dist/assets/index-*.css), браузер резолвит относительный путь
// ОТНОСИТЕЛЬНО ЭТОГО css-файла (т.е. .../assets/...), а не относительно
// страницы — картинка тихо не находится (404), просто показывается только
// сплошной CSS-градиент под ней, без узора. Поэтому собираем гарантированно
// абсолютный URL через `new URL(...)`.
//
// Правка после ревью #2: вместо обрезанного фрагмента арки — цельная
// золотая мандала-обои (загружена пользователем, полноэкранная
// композиция под портретный вьюпорт телефона), покрывает весь фон целиком
// через background-size: cover, а не один мотив у верхнего края.
document.documentElement.style.setProperty(
  '--bg-mandala-url',
  `url('${new URL(`${import.meta.env.BASE_URL}bg/mandala-fullpage.webp`, window.location.href).href}')`
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
