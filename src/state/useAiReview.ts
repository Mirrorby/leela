import { useEffect, useRef, useState } from 'react';
import { type ReviewKind, getAiReviewFromServer, startAiReviewOnServer } from '../api/workerClient';
import { createAiReviewController, type AiReviewSnapshot } from './aiReviewController';

const INITIAL: AiReviewSnapshot = { state: 'checking', content: null, error: null, kind: 'short', shortContent: null };

export function useAiReview(gameId: string | undefined) {
  const controllerRef = useRef<ReturnType<typeof createAiReviewController> | null>(null);
  const [snapshot, setSnapshot] = useState({ gameId, ...INITIAL });

  useEffect(() => {
    if (!gameId) return;
    const controller = createAiReviewController({
      get: () => getAiReviewFromServer(gameId),
      start: (kind) => startAiReviewOnServer(gameId, kind),
    }, (next) => setSnapshot({ gameId, ...next }));
    controllerRef.current = controller;
    void controller.check();
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [gameId]);

  return {
    ...(snapshot.gameId === gameId ? snapshot : INITIAL),
    start: (kind: ReviewKind) => controllerRef.current?.start(kind),
  };
}
