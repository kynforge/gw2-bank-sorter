// "What is this for?": the crafting recipes an item is an ingredient in, by output name.
// The API has no Mystic Forge recipes, so an empty answer means "no crafting recipe", not "useless".
import { getJSON, getMany } from "./api.js";

const SAMPLE = 20;          // outputs named per item; common materials are in hundreds of recipes
const cache = new Map();    // item id -> output names, for this session
const totals = new Map();   // item id -> how many recipes use it

// How many recipes use an item, once recipeUses has looked it up.
export const recipeCount = id => totals.get(id) ?? null;

export async function recipeUses(itemIds, { concurrency = 4 } = {}) {
  const todo = [...new Set(itemIds)].filter(id => !cache.has(id));
  const recipeIdsByItem = new Map();
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      recipeIdsByItem.set(id, (await getJSON("/recipes/search", { input: id }).catch(() => [])) || []);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

  const recipeIds = [...new Set([...recipeIdsByItem.values()].flatMap(r => r.slice(0, SAMPLE)))];
  const recipes = recipeIds.length ? await getMany("/recipes", recipeIds) : [];
  const outputOf = new Map(recipes.map(r => [r.id, r.output_item_id]));
  const outputIds = [...new Set(recipes.map(r => r.output_item_id))];
  const outputs = outputIds.length ? await getMany("/items", outputIds) : [];
  const nameOf = new Map(outputs.map(i => [i.id, i.name]));

  for (const [id, rids] of recipeIdsByItem) {
    totals.set(id, rids.length);
    cache.set(id, [...new Set(rids.slice(0, SAMPLE).map(r => nameOf.get(outputOf.get(r))).filter(Boolean))]);
  }
  return new Map([...new Set(itemIds)].map(id => [id, cache.get(id) || []]));
}
