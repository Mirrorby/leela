import type { Ruleset, ContentPack } from '../types/game';
import classicV1 from '../data/rulesets/classic-v1.json';
import classicV1ContentRu from '../data/content/ru/cells.json';

// Реестр доступных ruleset'ов. При добавлении новой версии — просто
// добавляем новый файл в /data/rulesets и регистрируем его здесь,
// не трогая старые версии (партии со старым rulesetVersion продолжают
// использовать свои правила).
const RULESETS: Record<string, Ruleset> = {
  'classic-v1': classicV1 as Ruleset,
};

const CONTENT_PACKS: Record<string, ContentPack> = {
  'classic-v1-ru': classicV1ContentRu as ContentPack,
};

export function getRuleset(rulesetId: string): Ruleset {
  const ruleset = RULESETS[rulesetId];
  if (!ruleset) {
    throw new Error(`Ruleset not found: ${rulesetId}`);
  }
  return ruleset;
}

export function getContentPack(rulesetId: string, language: string): ContentPack {
  const key = `${rulesetId}-${language}`;
  const pack = CONTENT_PACKS[key];
  if (!pack) {
    throw new Error(`Content pack not found: ${key}`);
  }
  return pack;
}
