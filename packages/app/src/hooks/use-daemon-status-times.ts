import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export interface DaemonStatusTimes {
  /** daemon 本次启动时间（pid-lock 的 startedAt） */
  startedAt: Date | null;
  /** 连续空闲起点（idle-restart watchdog 同源）；忙碌或配置禁用时为 null */
  idleSince: Date | null;
}

function daemonStatusTimesQueryKey(serverId: string) {
  return ["daemon-status-times", serverId] as const;
}

/**
 * Daemon 启动时间与连续空闲起点（daemon.get_status）。
 * 查询失败时静默降级为 null —— 这是辅助展示信息，不值得打断设置页。
 */
export function useDaemonStatusTimes(serverId: string, enabled: boolean): DaemonStatusTimes {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();

  const query = useFetchQuery<DaemonStatusTimes, Error>({
    queryKey: daemonStatusTimesQueryKey(serverId),
    enabled: enabled && Boolean(client) && isConnected,
    dataShape: "value",
    staleTimeMs: 60_000,
    retry: false,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host runtime client unavailable");
      }
      const status = await client.getDaemonStatus();
      return {
        startedAt: status.startedAt ? new Date(status.startedAt) : null,
        idleSince: status.idleSince ? new Date(status.idleSince) : null,
      };
    },
  });

  // daemon 重启（idle auto-restart 触发）会断开再重连；重连后强制重新拉取，
  // 否则 staleTime 窗口内会继续显示上一进程的启动时间。
  useEffect(() => {
    if (isConnected) {
      void queryClient.invalidateQueries({ queryKey: daemonStatusTimesQueryKey(serverId) });
    }
  }, [isConnected, serverId, queryClient]);

  return query.data ?? { startedAt: null, idleSince: null };
}
