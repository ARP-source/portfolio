import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const source = z.string().min(1); // every number names where it came from

const projects = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    oneLiner: z.string(),
    role: z.string(),
    dates: z.string(),
    status: z.enum(['shipped', 'in-progress', 'prototype']),
    stack: z.array(z.string()),
    links: z.object({
      repo: z.url().optional(),
      demo: z.url().optional(),
      video: z.url().optional(),
      extra: z.array(z.object({ label: z.string(), href: z.url() })).optional(),
    }),
    // Omit keyMetric rather than invent one.
    keyMetric: z
      .object({ label: z.string(), value: z.string(), unit: z.string().optional(), source })
      .optional(),
    // Only real series. Omit when there is none; the card then shows keyMetric in mono.
    sparkline: z
      .object({
        label: z.string(),
        unit: z.string(),
        x: z.array(z.number()),
        y: z.array(z.number()),
        source,
      })
      .refine((s) => s.x.length === s.y.length && s.y.length >= 3, 'x and y must match, 3+ points')
      .optional(),
    // Short "currently investigating" checklist (edge-decoder-drift).
    investigating: z.array(z.object({ item: z.string(), done: z.boolean() })).optional(),
    audience: z.array(z.enum(['neuro', 'swe'])),
  }),
});

const changelog = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/changelog' }),
  schema: z.object({ date: z.coerce.date(), version: z.string(), title: z.string() }),
});

export const collections = { projects, changelog };
