import React from 'react';
import { ProviderManager } from '../components/ai/ProviderManager';

// AI 供应商页：页面头 + 网关设置条 + 供应商网格（ProviderManager）
export const ProvidersPage: React.FC = () => {
  return (
    <div>
      <ProviderManager />
    </div>
  );
};
