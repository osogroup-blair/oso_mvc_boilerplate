import { prisma } from "../lib/prisma.js";
import { SiteSetting } from "@prisma/client";

export const settingModel = {
  async getByKey(key: string): Promise<SiteSetting | null> {
    return prisma.siteSetting.findUnique({
      where: { key },
    });
  },

  async set(key: string, value: string): Promise<SiteSetting> {
    return prisma.siteSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  },

  async getAll(): Promise<SiteSetting[]> {
    return prisma.siteSetting.findMany({
      orderBy: { key: "asc" },
    });
  },
};
