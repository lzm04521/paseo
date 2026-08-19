import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

function daemonStartedAtQueryKey(serverId: string) {
  return ["daemon-started-at", serverId] as const;
}

/**
 * Daemon 本次启动时间（来自 daemon.get_status 的 startedAt，由 pid-lock 写入）。
 * 查询失败时静默降级为 null —— 这是辅助展示信息，不值得打断设置页。
 */
export function useDaemonStartedAt(serverId: string, enabled: boolean): Date | null {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();

  const query = useFetchQuery<Date | null, Error>({
    queryKey: daemonStartedAtQueryKey(serverId),
    enabled: enabled && Boolean(client) && isConnected,
    dataShape: "value",
    staleTimeMs: 60_000,
    retry: false,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host runtime client unavailable");
      }
      const status = await client.getDaemonStatus();
      return status.startedAt ? new Date(status.startedAt) : null;
    },
  });

  // daemon 重启（idle auto-restart 触发）会断开再重连；重连后强制重新拉取，
  // 否则 staleTime 窗口内会继续显示上一进程的启动时间。
  useEffect(() => {
    if (isConnected) {
      void queryClient.invalidateQueries({ queryKey: daemonStartedAtQueryKey(serverId) });
    }
  }, [isConnected, serverId, queryClient]);

  return query.data ?? null;
}
