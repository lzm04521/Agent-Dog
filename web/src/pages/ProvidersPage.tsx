import React from 'react';
import { ProviderManager } from '../components/ai/ProviderManager';

// AI 供应商页：上状态（网关设置）+ 左供应商列表 + 右详情（ProviderManager）
export const ProvidersPage: React.FC = () => {
  return (
    // 内容自适应高度：不强制撑满视口，避免内容少时下半屏大片空白
    <div className="min-h-[480px] flex flex-col">
      <ProviderManager />
    </div>
  );
};
