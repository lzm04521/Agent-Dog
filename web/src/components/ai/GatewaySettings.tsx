import React, { useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { useProviderStore } from '../../store/providerStore';

// AI API 网关设置（紧凑横条）：开关 / 运行徽章 / 监听地址 / 对外 apiKey 管理
export const GatewaySettings: React.FC = () => {
  const { gatewayStatus, updateGateway } = useProviderStore();
  const [resetting, setResetting] = useState(false);

  if (!gatewayStatus) {
    return null;
  }

  const endpoint = `http://${gatewayStatus.host}:${gatewayStatus.port}`;

  const toggleEnabled = async () => {
    await updateGateway({ enabled: !gatewayStatus.enabled });
  };

  const resetApiKey = async () => {
    if (!window.confirm('重置后旧 apiKey 立即失效，已接入的客户端需要更新配置。继续？')) {
      return;
    }
    setResetting(true);
    try {
      await updateGateway({ resetApiKey: true });
    } finally {
      setResetting(false);
    }
  };

  const copyKey = async () => {
    await navigator.clipboard.writeText(gatewayStatus.apiKey);
  };

  return (
    <div className="card bg-base-100 border border-base-300 shadow-sm">
      <div className="card-body p-4 flex flex-wrap items-center gap-x-6 gap-y-3 justify-between">
        <div className="min-w-0" title="Anthropic Messages 兼容端点，统一接入任意上游供应商">
          <h2 className="card-title text-base">AI API 网关</h2>
          <p className="text-xs text-base-content/50 mt-0.5">Anthropic Messages 兼容端点，模型按 slug:modelId 寻址</p>
        </div>

        {gatewayStatus.enabled && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="form-control">
              <label className="label py-1"><span className="label-text text-xs">监听地址</span></label>
              <input className="input input-bordered input-sm font-mono w-52" value={endpoint} readOnly />
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text text-xs">对外 API Key</span></label>
              <div className="join">
                <input className="input input-bordered input-sm join-item w-52 font-mono" value={gatewayStatus.apiKey} readOnly />
                <button className="btn btn-ghost btn-sm join-item" onClick={copyKey} title="复制 apiKey">
                  <Copy className="w-4 h-4" />
                </button>
                <button className="btn btn-ghost btn-sm join-item text-warning" onClick={resetApiKey} disabled={resetting} title="重置 apiKey">
                  {resetting ? <span className="loading loading-spinner loading-xs"></span> : <RefreshCw className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          {gatewayStatus.enabled && (
            <span className={`badge ${gatewayStatus.running ? 'badge-success' : 'badge-warning'} badge-sm`}>
              {gatewayStatus.running ? '运行中' : '已启用（未运行）'}
            </span>
          )}
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={gatewayStatus.enabled}
            onChange={toggleEnabled}
          />
        </div>
      </div>
    </div>
  );
};
