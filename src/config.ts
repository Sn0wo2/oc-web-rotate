import { uniq } from "es-toolkit"
import type { FetchProviderConfig, SearchProviderConfig } from "web-rotate-core"
import { LRUCache, RotateConfigError } from "web-rotate-core"
import { z } from "zod"

const KEY_SEPARATOR_PATTERN = /[\s,;]+/

const numeric = (schema: z.ZodType<number>) =>
  z.preprocess((value) => (typeof value === "string" ? Number(value) : value), schema)

const optionsSchema = z.looseObject({
  maxOperationMs: numeric(z.number().int().min(1000).max(2_147_483_647).default(100_000)),
  maxUrlsPerRequest: numeric(z.number().int().min(1).default(20)),
  cache: z
    .union([z.literal(false), z.object({ enabled: z.boolean(), cap: numeric(z.number().int().min(0)) }).partial()])
    .optional()
    .transform((value) => {
      const cap = value && value.cap !== undefined ? value.cap : 256
      if (value === false || (value && value.enabled === false) || cap === 0) return undefined
      return new LRUCache<string, NonNullable<unknown>>({ max: cap })
    }),
})

export const parseOptions = (options: unknown) => {
  const parsed = optionsSchema.safeParse(options ?? {})
  if (!parsed.success)
    throw new RotateConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    )
  return parsed.data
}

export const mergeProviders = <T extends object>(
  defaults: T,
  overrides: unknown,
  cache: LRUCache<string, NonNullable<unknown>> | undefined,
): T => {
  const { providers, ...rest } = (overrides ?? {}) as { providers?: Record<string, { enabled?: boolean | undefined }> }
  return {
    ...defaults,
    ...rest,
    providers: Object.fromEntries(
      Object.entries(providers ?? {}).flatMap(([id, { enabled, ...entry }]) =>
        enabled === false ? [] : [[id, entry]],
      ),
    ),
    ...(cache ? { cache } : {}),
  } as T
}

export const collectSecrets = (configs: (FetchProviderConfig | SearchProviderConfig)[]) =>
  uniq(
    configs.flatMap((config) =>
      Object.values(config.providers ?? {}).flatMap((entry) =>
        (Array.isArray(entry?.keys) ? entry.keys : [entry?.keys]).flatMap((item) =>
          typeof item === "string"
            ? item
                .split(KEY_SEPARATOR_PATTERN)
                .map((token) => (token.includes("::") ? token.slice(token.indexOf("::") + 2) : token))
            : item && typeof item.key === "string"
              ? [item.key.trim()]
              : [],
        ),
      ),
    ),
  )
    .filter((key) => key && key !== "keyless")
    .sort((a, b) => b.length - a.length)
