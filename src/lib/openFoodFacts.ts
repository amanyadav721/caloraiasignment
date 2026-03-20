export type OpenFoodFactsQuantityMode = "grams" | "servings";

export type OpenFoodFactsProduct = {
  code: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  caloriesPer100g: number | null;
  caloriesPerServing: number | null;
  servingQuantityGrams: number | null;
  servingSizeLabel: string | null;
  packageQuantityLabel: string | null;
};

export type OpenFoodFactsCalculation = {
  calories: number;
  quantityLabel: string;
};

const OPEN_FOOD_FACTS_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const OPEN_FOOD_FACTS_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";

const SEARCH_FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "generic_name",
  "brands",
  "image_front_small_url",
].join(",");

const PRODUCT_FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "generic_name",
  "brands",
  "image_front_small_url",
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "serving_size",
  "serving_quantity",
  "nutriments",
].join(",");

const searchCache = new Map<string, OpenFoodFactsProduct[]>();
const productCache = new Map<string, OpenFoodFactsProduct>();

export async function searchOpenFoodFactsProducts(query: string) {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    return [] as OpenFoodFactsProduct[];
  }

  const cacheKey = trimmedQuery.toLowerCase();
  const cachedResults = searchCache.get(cacheKey);

  if (cachedResults) {
    return cachedResults;
  }

  const searchUrl =
    `${OPEN_FOOD_FACTS_SEARCH_URL}?` +
    `search_terms=${encodeURIComponent(trimmedQuery)}` +
    "&search_simple=1" +
    "&action=process" +
    "&json=1" +
    "&page_size=8" +
    `&fields=${encodeURIComponent(SEARCH_FIELDS)}`;

  const payload = await fetchOpenFoodFactsJson(searchUrl, "search Open Food Facts");

  if (!isRecord(payload) || !Array.isArray(payload.products)) {
    return [] as OpenFoodFactsProduct[];
  }

  const products = payload.products
    .map((item) => parseOpenFoodFactsProduct(item))
    .filter((item): item is OpenFoodFactsProduct => item !== null);

  searchCache.set(cacheKey, products);
  return products;
}

export function getCachedOpenFoodFactsMatches(query: string) {
  const normalizedQuery = normalizeQuery(query);

  if (normalizedQuery.length < 2) {
    return [] as OpenFoodFactsProduct[];
  }

  const exactMatch = searchCache.get(normalizedQuery);

  if (exactMatch) {
    return exactMatch;
  }

  const mergedMatches = new Map<string, OpenFoodFactsProduct>();

  for (const [cachedQuery, cachedProducts] of searchCache.entries()) {
    if (!normalizedQuery.startsWith(cachedQuery) && !cachedQuery.startsWith(normalizedQuery)) {
      continue;
    }

    for (const product of cachedProducts) {
      const haystack = normalizeQuery([product.name, product.brand ?? ""].join(" "));

      if (!haystack.includes(normalizedQuery)) {
        continue;
      }

      mergedMatches.set(product.code, product);
    }
  }

  return Array.from(mergedMatches.values()).slice(0, 8);
}

export async function fetchOpenFoodFactsProduct(code: string) {
  const trimmedCode = code.trim();

  if (!trimmedCode) {
    throw new Error("Missing Open Food Facts product code.");
  }

  const cachedProduct = productCache.get(trimmedCode);

  if (cachedProduct) {
    return cachedProduct;
  }

  const productUrl =
    `${OPEN_FOOD_FACTS_PRODUCT_URL}/${encodeURIComponent(trimmedCode)}` +
    `?fields=${encodeURIComponent(PRODUCT_FIELDS)}`;

  const payload = await fetchOpenFoodFactsJson(productUrl, "load product nutrition");

  if (!isRecord(payload) || !isRecord(payload.product)) {
    throw new Error("Open Food Facts returned an invalid product response.");
  }

  const product = parseOpenFoodFactsProduct(payload.product);

  if (!product || (product.caloriesPer100g === null && product.caloriesPerServing === null)) {
    throw new Error("That product does not include enough calorie data yet.");
  }

  productCache.set(trimmedCode, product);
  return product;
}

export function getDefaultOpenFoodFactsQuantity(product: OpenFoodFactsProduct) {
  if (supportsServingMode(product)) {
    return {
      mode: "servings" as const,
      value: "1",
    };
  }

  return {
    mode: "grams" as const,
    value: "100",
  };
}

export function supportsServingMode(product: OpenFoodFactsProduct) {
  return Boolean(product.caloriesPerServing || product.servingQuantityGrams);
}

export function calculateOpenFoodFactsCalories(
  product: OpenFoodFactsProduct,
  quantityInput: string,
  quantityMode: OpenFoodFactsQuantityMode,
) {
  const quantity = Number.parseFloat(quantityInput);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  if (quantityMode === "servings") {
    const caloriesPerServing =
      product.caloriesPerServing ??
      (product.caloriesPer100g !== null && product.servingQuantityGrams !== null
        ? (product.caloriesPer100g * product.servingQuantityGrams) / 100
        : null);

    if (caloriesPerServing === null) {
      return null;
    }

    return {
      calories: Math.round(caloriesPerServing * quantity),
      quantityLabel:
        quantity === 1
          ? product.servingSizeLabel ?? "1 serving"
          : product.servingSizeLabel
            ? `${formatQuantity(quantity)} x ${product.servingSizeLabel}`
            : `${formatQuantity(quantity)} servings`,
    } satisfies OpenFoodFactsCalculation;
  }

  if (product.caloriesPer100g === null) {
    return null;
  }

  return {
    calories: Math.round((product.caloriesPer100g * quantity) / 100),
    quantityLabel: `${formatQuantity(quantity)} g`,
  } satisfies OpenFoodFactsCalculation;
}

export function getOpenFoodFactsMeta(product: OpenFoodFactsProduct) {
  const calorieMeta =
    product.caloriesPer100g !== null ? `${Math.round(product.caloriesPer100g)} kcal / 100 g` : null;

  const servingMeta =
    product.caloriesPerServing !== null
      ? `${Math.round(product.caloriesPerServing)} kcal / serving`
      : product.servingSizeLabel;

  return [product.brand, calorieMeta, servingMeta, product.packageQuantityLabel]
    .filter(Boolean)
    .join(" • ");
}

async function fetchOpenFoodFactsJson(url: string, actionLabel: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Open Food Facts could not ${actionLabel}.`);
    }

    return (await response.json()) as unknown;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Open Food Facts took too long to respond. Please try again.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseOpenFoodFactsProduct(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const name =
    toTrimmedString(value.product_name) ??
    toTrimmedString(value.product_name_en) ??
    toTrimmedString(value.generic_name);

  const code = toTrimmedString(value.code);

  if (!name || !code) {
    return null;
  }

  const nutriments = isRecord(value.nutriments) ? value.nutriments : null;
  const servingSizeLabel = toTrimmedString(value.serving_size);
  const servingQuantityGrams =
    toNumberOrNull(value.serving_quantity) ?? extractLeadingNumber(servingSizeLabel);
  const caloriesPer100g = extractCalories(nutriments, "100g");
  const caloriesPerServing = extractCalories(nutriments, "serving");
  const productQuantity = toNumberOrNull(value.product_quantity);
  const productQuantityUnit = toTrimmedString(value.product_quantity_unit);
  const quantity = toTrimmedString(value.quantity);

  return {
    code,
    name,
    brand: toTrimmedString(value.brands),
    imageUrl: toTrimmedString(value.image_front_small_url),
    caloriesPer100g,
    caloriesPerServing,
    servingQuantityGrams,
    servingSizeLabel,
    packageQuantityLabel:
      productQuantity !== null && productQuantityUnit
        ? `${formatQuantity(productQuantity)} ${productQuantityUnit}`
        : quantity,
  } satisfies OpenFoodFactsProduct;
}

function extractCalories(
  nutriments: Record<string, unknown> | null,
  scope: "100g" | "serving",
) {
  if (!nutriments) {
    return null;
  }

  const kcalKey = scope === "100g" ? "energy-kcal_100g" : "energy-kcal_serving";
  const kjKey = scope === "100g" ? "energy_100g" : "energy_serving";
  const calories = toNumberOrNull(nutriments[kcalKey]);

  if (calories !== null) {
    return calories;
  }

  const kilojoules = toNumberOrNull(nutriments[kjKey]);

  if (kilojoules === null) {
    return null;
  }

  return kilojoules / 4.184;
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace(/\.0$/, "");
}

function extractLeadingNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d+(?:\.\d+)?)/);

  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toTrimmedString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
