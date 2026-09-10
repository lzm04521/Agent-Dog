import React, { useState } from 'react';
import { Info, Zap } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';
import { GatewayInfoModal } from './GatewayInfoModal';

// AI API 网关设置（紧凑内联行，无卡片壳）：开关紧跟标题，配置信息（地址/apiKey）收纳进弹窗
export const GatewaySettings: React.FC = () => {
  const { gatewayStatus, updateGateway } = useProviderStore();
  const [showInfo, setShowInfo] = useState(false);

  if (!gatewayStatus) {
    return null;
  }

  const toggleEnabled = async () => {
    await updateGateway({ enabled: !gatewayStatus.enabled });
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2.5 text-sm"
      title="Anthropic Messages 兼容端点（/anthropic 前缀路由），统一接入任意上游供应商"
    >
      <div className="flex items-center gap-2 shrink-0">
        <Zap className={`w-4 h-4 ${gatewayStatus.enabled ? 'text-accent' : 'text-base-content/40'}`} />
        <span className="font-semibold">AI API 网关</span>
        {gatewayStatus.enabled && (
          <span className={`badge ${gatewayStatus.running ? 'badge-success' : 'badge-warning'} badge-sm`}>
            {gatewayStatus.running ? '运行中' : '已启用（未运行）'}
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
        <span className="text-xs text-base-content/60">网关{gatewayStatus.enabled ? '开' : '关'}</span>
        <input
          type="checkbox"
          className="toggle toggle-primary toggle-sm"
          checked={gatewayStatus.enabled}
          onChange={toggleEnabled}
        />
      </label>

      {gatewayStatus.enabled && (
        <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setShowInfo(true)}>
          <Info className="w-3.5 h-3.5" />
          配置信息
        </button>
      )}

      {showInfo && <GatewayInfoModal onClose={() => setShowInfo(false)} />}
    </div>
  );
};
