// Minecraft /give commands of the Commands tab; not the Issue comment commands of scripts/lib/commands.mjs.
// Pure functions shared by the site and the cross validation (X25): no DOM and no browser globals.
// Data files store only the item, the enchantments (SNBT map text) and the count; the custom name and
// the target selector are built here.

/** Item id without namespace; schemas/v1/commands.schema.json uses the same pattern. */
export const ITEM_RE = /^[a-z][a-z0-9_]{1,63}$/;
/** SNBT map of the enchantments component, e.g. {unbreaking:3,mending:1}; same pattern as the schema. */
export const ENCHANTMENTS_RE = /^\{[a-z][a-z0-9_]{0,63}:[1-9][0-9]{0,2}(?:,[a-z][a-z0-9_]{0,63}:[1-9][0-9]{0,2})*\}$/;
export const MAX_ENCHANTMENTS_LENGTH = 1000;
export const MAX_ENCHANTMENT_LEVEL = 255;
export const MAX_COUNT = 64;

/**
 * Splits enchantments text into [{ id, level }] in written order.
 * @returns {Array<{ id: string, level: number }> | null} null when the text does not match ENCHANTMENTS_RE
 */
export function parseEnchantments(text) {
  if (typeof text !== "string" || text.length > MAX_ENCHANTMENTS_LENGTH || !ENCHANTMENTS_RE.test(text)) return null;
  return text
    .slice(1, -1)
    .split(",")
    .map((pair) => {
      const [id, level] = pair.split(":");
      return { id, level: Number(level) };
    });
}
