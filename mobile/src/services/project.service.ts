import api from './api';
import { ApiResponse, ProjectRef } from '../types';
import { storage } from '../utils/storage';

interface MyProjectsResponse {
  projects: ProjectRef[];
  defaultProject: ProjectRef | null;
}

interface CachedProjectsPayload {
  value: MyProjectsResponse;
  updatedAt: number;
}

const PROJECT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let inMemoryCache: CachedProjectsPayload | null = null;
let inFlightRequest: Promise<MyProjectsResponse> | null = null;

export const projectService = {
  async getMyProjects(): Promise<MyProjectsResponse> {
    const res = await api.get<ApiResponse<MyProjectsResponse>>('/projects');
    return res.data.data;
  },

  async getCachedProjects(): Promise<MyProjectsResponse | null> {
    if (inMemoryCache) {
      return inMemoryCache.value;
    }

    const persisted = await storage.getProjectCache();
    if (!persisted) {
      return null;
    }

    inMemoryCache = persisted;
    return persisted.value;
  },

  async isCacheFresh(): Promise<boolean> {
    const cached = inMemoryCache ?? (await storage.getProjectCache());
    if (!cached) return false;
    return Date.now() - cached.updatedAt <= PROJECT_CACHE_TTL_MS;
  },

  async preloadProjects(options?: { force?: boolean }): Promise<MyProjectsResponse> {
    const force = options?.force === true;

    // Prefer stable cached reference data to keep forms instant.
    if (!force) {
      const persisted = inMemoryCache ?? (await storage.getProjectCache());
      if (persisted && Date.now() - persisted.updatedAt <= PROJECT_CACHE_TTL_MS) {
        inMemoryCache = persisted;
        return persisted.value;
      }
    }

    if (inFlightRequest) {
      return inFlightRequest;
    }

    inFlightRequest = this.getMyProjects()
      .then(async (value) => {
        const payload: CachedProjectsPayload = {
          value,
          updatedAt: Date.now(),
        };

        // Keep both in-memory and persisted cache in sync for fast startup.
        inMemoryCache = payload;
        await storage.setProjectCache(payload);
        return value;
      })
      .finally(() => {
        inFlightRequest = null;
      });

    return inFlightRequest;
  },

  async clearCache(): Promise<void> {
    inMemoryCache = null;
    await storage.clearProjectCache();
  },
};
