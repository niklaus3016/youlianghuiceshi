import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface GDTAdPlugin {
  loadRewardVideoAd(options: { adId: string }): Promise<void>;
  showRewardVideoAd(): Promise<void>;
  isReady(): Promise<{ ready: boolean }>;
  addListener(eventName: string, listenerFunc: (data: any) => void): Promise<PluginListenerHandle>;
  removeListener(eventName: string, listenerFunc: (data: any) => void): Promise<void>;
}

const GDTAd = registerPlugin<GDTAdPlugin>('GDTAd', {
  web: () => import('./GDTAdPluginWeb').then(m => new m.GDTAdPluginWeb() as any),
});

export default GDTAd;
