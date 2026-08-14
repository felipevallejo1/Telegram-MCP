import { AgentRunStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import type { NotionStatus, Run, RunPatch, RunStatus, RunStore } from "./core";

type AgentRunClient = Pick<PrismaClient, "agentRun">;

const status = (value: RunStatus): AgentRunStatus => value as AgentRunStatus;
const mapRun = (item: {
  id: string;
  telegramUpdateId: string;
  requestedByChatIdHash: string;
  promptSummary: string;
  status: AgentRunStatus;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  verificationSummary: string | null;
  notionUrl: string | null;
  notionStatus: NotionStatus;
}): Run => ({
  id: item.id,
  updateId: item.telegramUpdateId,
  chatHash: item.requestedByChatIdHash,
  prompt: item.promptSummary,
  status: item.status as RunStatus,
  createdAt: item.createdAt,
  ...(item.startedAt ? { startedAt: item.startedAt } : {}),
  ...(item.finishedAt ? { finishedAt: item.finishedAt } : {}),
  ...(item.verificationSummary ? { verificationSummary: item.verificationSummary } : {}),
  ...(item.notionUrl ? { notionUrl: item.notionUrl } : {}),
  notionStatus: item.notionStatus,
});

const patchData = (patch?: Partial<RunPatch>): Prisma.AgentRunUpdateManyMutationInput => ({
  ...(patch?.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
  ...(patch?.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
  ...(patch?.verificationSummary !== undefined ? { verificationSummary: patch.verificationSummary } : {}),
});

export const createPrismaRunStore = (client: AgentRunClient): RunStore => ({
  async create(run) {
    try {
      await client.agentRun.create({
        data: {
          id: run.id,
          telegramUpdateId: run.updateId,
          requestedByChatIdHash: run.chatHash,
          promptSummary: run.prompt,
          status: status(run.status),
          createdAt: run.createdAt,
          ...(run.startedAt ? { startedAt: run.startedAt } : {}),
          ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
          ...(run.verificationSummary ? { verificationSummary: run.verificationSummary } : {}),
        },
      });
      return "created";
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
      throw error;
    }
  },

  async get(id) {
    const item = await client.agentRun.findUnique({ where: { id } });
    return item ? mapRun(item) : null;
  },

  async transition(id, from, to, patch) {
    const result = await client.agentRun.updateMany({
      where: { id, status: status(from) },
      data: { status: status(to), ...patchData(patch) },
    });
    return result.count === 1;
  },

  async findLatestForChat(chatHash, statuses) {
    const item = await client.agentRun.findFirst({
      where: { requestedByChatIdHash: chatHash, status: { in: statuses.map(status) } },
      orderBy: { createdAt: "desc" },
    });
    return item ? mapRun(item) : null;
  },

  async findByStatuses(statuses) {
    const items = await client.agentRun.findMany({ where: { status: { in: statuses.map(status) } }, orderBy: { createdAt: "asc" } });
    return items.map(mapRun);
  },

  async updateNotion(id, notionStatus, notionUrl) {
    const result = await client.agentRun.updateMany({
      where: { id },
      data: { notionStatus, notionUrl: notionUrl ?? null },
    });
    return result.count === 1;
  },
});

export const prismaRunStore = createPrismaRunStore(prisma);
