import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default("http://localhost:3000"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY_OLD: z.string().optional(),
  OAUTH_CLIENT_ID: z.string().min(1),
  OAUTH_CLIENT_SECRET: z.string().min(1),
  OAUTH_SCOPES: z.string().default("crm.objects.contacts.read"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(60),
});

export const config = schema.parse(process.env);
