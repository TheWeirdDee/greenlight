import { isAddress } from "viem";
import { z } from "zod";
import { BASE_SEPOLIA_CHAIN_ID, FUNDING_TOKEN_ALLOWLIST } from "@/lib/chain/config";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date")
  .transform((s) => new Date(s));

export const workspaceInput = z.object({ name: text(80) });

export const launchInput = z.object({
  name: text(120),
  tagline: optionalText(280),
  targetAt: isoDate,
});

const address = z
  .string()
  .trim()
  .refine((a) => isAddress(a, { strict: false }), "Enter a valid 0x address");

const tokenAmount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Enter a positive decimal amount");

export const requirementInput = z
  .object({
    title: text(140),
    description: optionalText(1000),
    kind: z.enum(["commitment", "deliverable", "url_check", "funding"]),
    mandatory: z.boolean().default(true),
    deadlineAt: isoDate.nullable().default(null),
    dependsOn: z.array(z.string().uuid()).max(20).default([]),
    funding: z
      .object({
        chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
        token: address.refine(
          (t) => FUNDING_TOKEN_ALLOWLIST.some((a) => a.toLowerCase() === t.toLowerCase()),
          "This token is not on the Base Sepolia allowlist",
        ),
        recipient: address,
        amount: tokenAmount,
        minConfirmations: z.number().int().min(1).max(64).default(2),
      })
      .nullable()
      .default(null),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "funding" && !v.funding) {
      ctx.addIssue({ code: "custom", path: ["funding"], message: "Funding requirements need token, recipient and amount" });
    }
    if (v.kind !== "funding" && v.funding) {
      ctx.addIssue({ code: "custom", path: ["funding"], message: "Only funding requirements carry funding settings" });
    }
  });

export const inviteInput = z.object({
  label: text(120),
});

export const evidenceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), value: z.string().trim().url().max(2000) }),
  z.object({ kind: z.literal("note"), value: text(2000) }),
]);

export const txHashInput = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^0x[0-9a-f]{64}$/, "Enter a 66-character 0x transaction hash");

export const declineInput = z.object({ reason: z.string().trim().max(300).default("") });

export const decisionInput = z.object({
  decision: z.enum(["proceed", "hold"]),
  note: z.string().trim().max(500).default(""),
  /** Required to proceed while not READY; recorded verbatim in the brief. */
  overrideAcknowledged: z.boolean().default(false),
});
