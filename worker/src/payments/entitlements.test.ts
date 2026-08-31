import { describe, it, expect } from 'vitest';
import { computeEntitlements } from './entitlements';

const NOW = 1_000_000;

function balance(overrides: Partial<{ free_games_remaining: number; free_ai_reviews_remaining: number; paid_games: number; paid_ai_reviews: number }> = {}) {
  return { free_games_remaining: 0, free_ai_reviews_remaining: 0, paid_games: 0, paid_ai_reviews: 0, ...overrides };
}

describe('computeEntitlements', () => {
  it('новый пользователь (2 бесплатные партии, 1 бесплатный разбор, без подписки) может и то и другое', () => {
    const result = computeEntitlements(balance({ free_games_remaining: 2, free_ai_reviews_remaining: 1 }), null, NOW);
    expect(result.canStartGame).toBe(true);
    expect(result.canStartAiReview).toBe(true);
    expect(result.subscription).toBeNull();
  });

  it('всё исчерпано и подписки нет — ничего нельзя', () => {
    const result = computeEntitlements(balance(), null, NOW);
    expect(result.canStartGame).toBe(false);
    expect(result.canStartAiReview).toBe(false);
  });

  it('только купленные партии (free исчерпаны) — всё ещё можно начать', () => {
    const result = computeEntitlements(balance({ paid_games: 3 }), null, NOW);
    expect(result.canStartGame).toBe(true);
  });

  it('только купленные разборы (free исчерпан) — всё ещё можно заказать разбор', () => {
    const result = computeEntitlements(balance({ paid_ai_reviews: 2 }), null, NOW);
    expect(result.canStartAiReview).toBe(true);
  });

  it('активная подписка (period_end в будущем) даёт canStartGame=true даже с нулевым балансом партий', () => {
    const result = computeEntitlements(balance(), { period_end: NOW + 1000, auto_renew: 1 }, NOW);
    expect(result.subscription).toEqual({ active: true, autoRenew: true, periodEnd: NOW + 1000 });
    expect(result.canStartGame).toBe(true);
  });

  it('истёкшая подписка (period_end в прошлом) — active=false, партии по подписке недоступны', () => {
    const result = computeEntitlements(balance(), { period_end: NOW - 1000, auto_renew: 1 }, NOW);
    expect(result.subscription?.active).toBe(false);
    expect(result.canStartGame).toBe(false);
  });

  it('подписка истекает РОВНО в now — граница НЕ считается активной (period_end > now, строго)', () => {
    const result = computeEntitlements(balance(), { period_end: NOW, auto_renew: 1 }, NOW);
    expect(result.subscription?.active).toBe(false);
  });

  it('§3.3 ТЗ: подписка НЕ покрывает ИИ-разборы, даже активная', () => {
    const result = computeEntitlements(balance({ free_ai_reviews_remaining: 0, paid_ai_reviews: 0 }), { period_end: NOW + 1000, auto_renew: 1 }, NOW);
    expect(result.subscription?.active).toBe(true);
    expect(result.canStartAiReview).toBe(false);
  });

  it('autoRenew=0 в строке подписки маппится в false, а не в truthy-любое-число', () => {
    const result = computeEntitlements(balance(), { period_end: NOW + 1000, auto_renew: 0 }, NOW);
    expect(result.subscription?.autoRenew).toBe(false);
  });

  it('пробрасывает сырые счётчики баланса как есть (для экрана "Ваш доступ", §24)', () => {
    const result = computeEntitlements(balance({ free_games_remaining: 1, paid_games: 4, free_ai_reviews_remaining: 0, paid_ai_reviews: 2 }), null, NOW);
    expect(result.freeGamesRemaining).toBe(1);
    expect(result.paidGames).toBe(4);
    expect(result.freeAiReviewsRemaining).toBe(0);
    expect(result.paidAiReviews).toBe(2);
  });
});
