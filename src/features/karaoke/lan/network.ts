export type KaraokeSocketEvent = {
  type: 'open' | 'message' | 'closed' | 'error';
  id: string;
  address: string;
  data?: string;
  code?: string;
};

export interface KaraokeRoomNetwork {
  invoke<T>(args: Record<string, unknown>): Promise<T>;
  observe(callback: (event: KaraokeSocketEvent) => void): Promise<() => void>;
}

export function createKaraokeRoomNetwork(mobile: boolean): KaraokeRoomNetwork {
  if (mobile) {
    return {
      invoke: async args => {
        const { command, isAndroid } = await import('../../../mobile/native');
        if (!isAndroid) throw Error('局域网 K 歌当前支持 PC 与 Android 客户端');
        return command('karaokeNetwork', args);
      },
      observe: async callback => {
        const { isAndroid, observeKaraokeNetwork } = await import('../../../mobile/native');
        if (!isAndroid) throw Error('局域网 K 歌当前支持 PC 与 Android 客户端');
        const listener = await observeKaraokeNetwork(value => callback(value as KaraokeSocketEvent));
        return () => { void listener.remove(); };
      },
    };
  }
  const bridge = window.yzqxy as typeof window.yzqxy & {
    karaokeNetwork?: {
      invoke: KaraokeRoomNetwork['invoke'];
      observe(callback: (event: KaraokeSocketEvent) => void): () => void;
    };
  };
  return {
    invoke: args => {
      if (!bridge?.karaokeNetwork) return Promise.reject(Error('请使用支持局域网 K 歌的 Zenix 桌面客户端'));
      return bridge.karaokeNetwork.invoke(args);
    },
    observe: async callback => {
      if (!bridge?.karaokeNetwork) throw Error('请使用支持局域网 K 歌的 Zenix 桌面客户端');
      return bridge.karaokeNetwork.observe(callback);
    },
  };
}
