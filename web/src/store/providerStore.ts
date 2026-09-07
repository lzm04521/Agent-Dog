import { create } from 'zustand';
import { AIProvider, GatewayStatus, ProviderTestResult } from '../types/ai';
import { apiClient } from '../utils/api';

interface ProviderState {
  // Data
  providers: AIProvider[];
  gatewayStatus: GatewayStatus | null;

  // UI State
  loading: boolean;
  error: string | null;
  testingId: string | null;
  showProviderModal: boolean;
  editingProvider: AIProvider | null; // null = 新增
  modelsPanelProviderId: string | null;

  // Actions（一期状态刷新用"操作后重新拉取"，不接 socket.io）
  loadAll: () => Promise<void>;
  addProvider: (provider: Partial<AIProvider>) => Promise<void>;
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  toggleProvider: (id: string, enabled: boolean) => Promise<void>;
  testProvider: (id: string, apiKey?: string) => Promise<ProviderTestResult>;
  fetchModels: (id: string, apiKey?: string) => Promise<string[]>;
  updateGateway: (data: { enabled?: boolean; port?: number; resetApiKey?: boolean }) => Promise<void>;

  // UI Actions
  setShowProviderModal: (show: boolean, editing?: AIProvider | null) => void;
  setModelsPanelProvider: (id: string | null) => void;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  gatewayStatus: null,
  loading: false,
  error: null,
  testingId: null,
  showProviderModal: false,
  editingProvider: null,
  modelsPanelProviderId: null,

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [providers, gatewayStatus] = await Promise.all([
        apiClient.getAIProviders(),
        apiClient.getGatewayStatus(),
      ]);
      set({ providers, gatewayStatus, loading: false });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  addProvider: async (provider) => {
    await apiClient.addAIProvider(provider);
    await get().loadAll();
  },

  updateProvider: async (id, updates) => {
    await apiClient.updateAIProvider(id, updates);
    await get().loadAll();
  },

  removeProvider: async (id) => {
    await apiClient.deleteAIProvider(id);
    await get().loadAll();
  },

  toggleProvider: async (id, enabled) => {
    await apiClient.updateAIProvider(id, { enabled });
    await get().loadAll();
  },

  testProvider: async (id, apiKey) => {
    set({ testingId: id });
    try {
      return await apiClient.testAIProvider(id, apiKey);
    } finally {
      set({ testingId: null });
    }
  },

  fetchModels: async (id, apiKey) => {
    const result = await apiClient.fetchProviderModels(id, apiKey);
    return result.models as string[];
  },

  updateGateway: async (data) => {
    await apiClient.updateGatewaySettings(data);
    await get().loadAll();
  },

  setShowProviderModal: (show, editing = null) => {
    set({ showProviderModal: show, editingProvider: editing });
  },

  setModelsPanelProvider: (id) => {
    set({ modelsPanelProviderId: id });
  },
}));
