import { WebPlugin } from '@capacitor/core';
import type { GDTAdPlugin } from './GDTAdPlugin';

export class GDTAdPluginWeb extends WebPlugin {
  async loadRewardVideoAd(options: { adId: string }): Promise<void> {
    console.log('Web 环境不支持优量汇原生广告，请使用 H5 SDK');
    return Promise.resolve();
  }

  async showRewardVideoAd(): Promise<void> {
    console.log('Web 环境不支持优量汇原生广告，请使用 H5 SDK');
    return Promise.resolve();
  }

  async isReady(): Promise<{ ready: boolean }> {
    return { ready: false };
  }

  async addListener(eventName: string, listenerFunc: (data: any) => void): Promise<any> {
    console.log('Web 环境不支持优量汇原生广告，请使用 H5 SDK');
    return Promise.resolve();
  }
}
