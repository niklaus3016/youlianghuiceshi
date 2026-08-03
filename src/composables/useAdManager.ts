import { ref, onMounted, onUnmounted } from 'vue';
import GDTAd from '../plugins/GDTAdPlugin';
import { sendRedPacket, recordAdView, getPoolStatus, getUserTickets } from '../api/apiService';

declare global {
  interface Window {
    gdt?: any;
    _gdt?: any;
  }
}

interface AdConfig {
  appId: string;
  slotIds: string[];
}

const isLoaded = ref(false);
const isAdSdkReady = ref(false);
const isAdLoading = ref(false);
const isAdReady = ref(false);
const lastError = ref('');
const preloadAd = ref(false);

export function useAdManager(config: AdConfig) {
  let rewardListener: any = null;
  let errorListener: any = null;
  let videoCachedListener: any = null;
  let videoErrorListener: any = null;
  let adLoadListener: any = null;
  let adCloseListener: any = null;
  let timeoutId: any = null;
  let retryTimeoutId: any = null;
  let currentResolve: any = null;
  let currentReject: any = null;
  let currentSlotIndex = 0;
  let triedSlots = 0;
  let slotTimeoutId: any = null;
  let currentSessionId = 0;
  let isProcessing = false; // 是否正在处理广告，防止并发
  let hasShownAd = false; // 是否已经显示过广告（用于防止用户跳过后继续尝试其他广告位）
  
  // 预加载状态管理
  let preloadedAd: {
    slotId: string;
    isReady: boolean;
    loadedAt: number;
  } | null = null;
  let isPreloading = false; // 是否正在预加载
  let preloadingPromise: Promise<void> | null = null; // 预加载Promise，用于等待预加载完成
  
  // 广告位分组配置（优量汇）
  const AD_GROUPS = {
    group1: [
      '7305422026445753', // 保价1800
      '4315724057141227', // 保价1500
      '4315426007466896'  // 保价1000
    ],
    group2: [
      '6375922057285898', // 保价800
      '6395426018708831', // 保价600
      '7375928068632136'  // 保价400
    ],
    group3: [
      '8305923008444711', // 保价200
      '8305520048357523', // 保价100
      '3365028088862338'  // 保价50
    ],
    group4: [
      '7315025059414314'  // 竞价
    ]
  }; // 共10个广告位
  
  // 并行请求超时时间（毫秒）
  const PARALLEL_TIMEOUT = 2000;
  // 组间延迟时间（毫秒）
  const GROUP_DELAY = 500;
  // 广告位间隔时间（毫秒）
  const GROUP5_SLOT_DELAY = 200;
  
  const delay = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
  };
  
  // 获取或生成设备ID
  const getDeviceId = (): string => {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
  };
  
  // 从本地存储获取设备的激励池状态
  const getEcpmPool = (deviceId: string): number => {
    const key = `ecpm_pool_${deviceId}`;
    const stored = localStorage.getItem(key);
    return stored ? parseFloat(stored) : 0;
  };
  
  // 保存设备的激励池状态到本地存储
  const saveEcpmPool = (deviceId: string, pool: number): void => {
    const key = `ecpm_pool_${deviceId}`;
    localStorage.setItem(key, pool.toString());
  };
  
  // 计算实际传输的eCPM值（核心算法）
  const calculateActualEcpm = (simulatedEcpm: number): number => {
    try {
      // 参数校验
      if (simulatedEcpm < 0) {
        console.warn('⚠️ 模拟eCPM值为负数，设置为0');
        simulatedEcpm = 0;
      }
      
      const deviceId = getDeviceId();
      const previousPool = getEcpmPool(deviceId);
      
      // 配置参数
      const ECPM_THRESHOLD = 700;  // 分界线
      const HIGH_VALUE_RATIO = 0.7;   // 高值传输比例（70%传输，30%留存）
      const RELEASE_RATIO = 0.3;     // 激励池释放比例（30%）
      const ROLL_OVER_RATIO = 0.7;   // 激励池滚存比例（70%）
      
      // 计算基础传输值和留存额度
      let baseTransmitAmount: number;
      let currentRetainAmount: number;
      
      if (simulatedEcpm > ECPM_THRESHOLD) {
        // 高值eCPM (>700)：70%传输，30%留存
        baseTransmitAmount = simulatedEcpm * HIGH_VALUE_RATIO;
        currentRetainAmount = simulatedEcpm * (1 - HIGH_VALUE_RATIO);
      } else {
        // 低值eCPM (≤700)：100%传输，0留存
        baseTransmitAmount = simulatedEcpm;
        currentRetainAmount = 0;
      }
      
      // 计算当期激励释放额
      const currentReleaseAmount = previousPool * RELEASE_RATIO;
      
      // 计算实际传输值
      const actualEcpm = baseTransmitAmount + currentReleaseAmount;
      
      // 更新激励池总额
      let newPool = previousPool * ROLL_OVER_RATIO + currentRetainAmount;
      
      // 激励池下限控制
      const MIN_POOL = 0;      // 最小激励池
      newPool = Math.max(MIN_POOL, newPool);
      
      // 保存到本地存储
      saveEcpmPool(deviceId, newPool);
      
      // 日志输出
      console.log(`💰 eCPM算法计算:`);
      console.log(`   模拟eCPM: ${simulatedEcpm}`);
      console.log(`   类型: ${simulatedEcpm > ECPM_THRESHOLD ? '高值' : '低值'}`);
      console.log(`   基础传输值: ${baseTransmitAmount.toFixed(2)}`);
      console.log(`   当期留存额度: ${currentRetainAmount.toFixed(2)}`);
      console.log(`   上一期激励池: ${previousPool.toFixed(2)}`);
      console.log(`   当期激励释放额: ${currentReleaseAmount.toFixed(2)}`);
      console.log(`   实际传输值: ${actualEcpm.toFixed(2)}`);
      console.log(`   新激励池总额: ${newPool.toFixed(2)}`);
      
      return actualEcpm;
    } catch (error) {
      console.error('❌ eCPM算法计算失败:', error);
      // 异常情况下返回原始模拟值
      return simulatedEcpm;
    }
  };

  const generateSimulatedEcpm = (slotId: string): number => {
    const ecpmRanges: { [key: string]: [number, number] } = {
      // group1 - 保价1800, 1500, 1000
      '7305422026445753': [1620, 1800],   // 保价1800
      '4315724057141227': [1350, 1500],   // 保价1500
      '4315426007466896': [900, 1000],    // 保价1000
      // group2 - 保价800, 600, 400
      '6375922057285898': [720, 800],     // 保价800
      '6395426018708831': [540, 600],     // 保价600
      '7375928068632136': [360, 400],     // 保价400
      // group3 - 保价200, 100, 50
      '8305923008444711': [180, 200],     // 保价200
      '8305520048357523': [90, 100],      // 保价100
      '3365028088862338': [45, 50],       // 保价50
      // group4 - 竞价
      '7315025059414314': [20, 30]        // 竞价
    };

    const range = ecpmRanges[slotId];
    if (!range) return 0;
    return Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
  };

  // 并行请求广告组
  const tryParallelAdGroup = async (slotIds: string[]): Promise<{ ecpm: number; slotId: string } | null> => {
    console.log(`========== 开始并行请求广告组: ${slotIds.join(', ')} ==========`);
    
    const sessionId = currentSessionId;
    const checkSession = () => sessionId === currentSessionId;
    
    const adPromises = slotIds.map(slotId => {
      return new Promise<{ ecpm: number; slotId: string } | null>((resolve) => {
        let isResolved = false;
        let slotTimeoutId: any = null;
        let currentAdSuccess = false;
        
        const resolveOnce = (result: { ecpm: number; slotId: string } | null) => {
          if (!isResolved && checkSession()) {
            isResolved = true;
            cleanupSlotListeners();
            if (slotTimeoutId) clearTimeout(slotTimeoutId);
            resolve(result);
          }
        };
        
        const onReward = (result: any) => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          
          console.log(`========== 广告奖励回调 (${slotId}) ==========`);
          console.log('结果:', result);
          
          currentAdSuccess = true;
          if (slotTimeoutId) clearTimeout(slotTimeoutId);
          
          // 所有广告位都使用模拟 ECPM 值
          console.log('使用模拟 ECPM 值');
          const simulatedEcpm = generateSimulatedEcpm(slotId);
          const ecpm = calculateActualEcpm(simulatedEcpm);
          
          console.log(`✅ 广告成功 (${slotId})，返回 ECPM:`, ecpm);
          
          resolveOnce({ ecpm, slotId });
        };
        
        const onError = (error: any) => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          console.warn(`⚠️ 广告加载失败 (${slotId}):`, error?.error || error);
          resolveOnce(null);
        };
        
        const onVideoCached = async () => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          
          console.log(`✅ 视频下载成功 (${slotId})，准备显示广告`);
          
          // 立即设置广告显示标志，防止用户跳过后继续尝试其他广告位
          hasShownAd = true;
          
          try {
            if (slotTimeoutId) clearTimeout(slotTimeoutId);
            
            // 检查广告是否就绪
            console.log(`🔍 检查广告就绪状态 (${slotId})...`);
            try {
              const readyStatus = await GDTAd.isReady();
              console.log(`📊 广告就绪状态 (${slotId}):`, readyStatus);
              
              if (!readyStatus.ready) {
                console.warn(`⚠️ 广告未就绪 (${slotId})，尝试强制显示...`);
              }
            } catch (error) {
              console.warn(`⚠️ 检查广告就绪状态失败 (${slotId}):`, error);
            }
            
            console.log(`✅ 广告位加载成功且已就绪 (${slotId})，准备播放`);
            
            // 显示广告
            GDTAd.showRewardVideoAd();
            console.log(`✅ 广告显示命令已发送 (${slotId})`);
          } catch (error) {
            console.error(`❌ 显示广告失败 (${slotId}):`, error);
            resolveOnce(null);
          }
        };
        
        const onVideoError = () => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          console.warn(`⚠️ 视频下载失败 (${slotId})`);
          resolveOnce(null);
        };
        
        const onADClose = () => {
          if (!checkSession()) return;
          console.log(`✅ 广告关闭回调 (${slotId})`);
          // 如果已经显示过广告（用户跳过），停止尝试其他广告位
          if (hasShownAd) {
            console.log(`🛑 已显示过广告，停止尝试其他广告位 (${slotId})`);
            resolveOnce(null);
            return;
          }
          if (!currentAdSuccess) {
            console.log(`广告关闭但未获得奖励 (${slotId})，标记为失败`);
            resolveOnce(null);
          }
        };
        
        // 注册监听器
        GDTAd.addListener('onReward', onReward);
        GDTAd.addListener('onError', onError);
        GDTAd.addListener('onVideoCached', onVideoCached);
        GDTAd.addListener('onError', onError);
        GDTAd.addListener('onADClose', onADClose);
        
        // 清理监听器的函数
        const cleanupSlotListeners = () => {
          try {
            GDTAd.removeListener('onReward', onReward);
            GDTAd.removeListener('onError', onError);
            GDTAd.removeListener('onVideoCached', onVideoCached);
            GDTAd.removeListener('onError', onError);
            GDTAd.removeListener('onADClose', onADClose);
          } catch (e) {
            console.warn(`清理监听器失败 (${slotId}):`, e);
          }
        };
        
        // 加载广告
        GDTAd.loadRewardVideoAd({ adId: slotId })
          .then(() => console.log(`✅ 广告加载请求已发送 (${slotId})`))
          .catch((err: any) => {
            console.error(`❌ 加载广告请求失败 (${slotId}):`, err);
            resolveOnce(null);
          });
        
        // 广告位超时
        slotTimeoutId = setTimeout(() => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          console.warn(`⏱️ 广告加载超时 (${slotId})`);
          resolveOnce(null);
        }, PARALLEL_TIMEOUT);
      });
    });
    
    // 等待所有并行请求完成，返回第一个成功的结果
    const results = await Promise.all(adPromises);
    for (const result of results) {
      if (result && checkSession()) {
        console.log(`🎉 并行请求成功，使用广告位: ${result.slotId}，ECPM: ${result.ecpm}`);
        return result;
      }
    }
    
    console.log('❌ 并行请求组所有广告位均失败');
    return null;
  };
  
  const getNextSlotId = (): string => {
    if (!config.slotIds?.length) throw new Error('广告位配置为空');
    const slotId = config.slotIds[currentSlotIndex];
    const currentRound = Math.floor(triedSlots / config.slotIds.length) + 1;
    const positionInRound = (triedSlots % config.slotIds.length) + 1;
    console.log(`当前轮询广告位: ${slotId} (第${currentRound}轮 ${positionInRound}/${config.slotIds.length})`);
    currentSlotIndex = (currentSlotIndex + 1) % config.slotIds.length;
    triedSlots++;
    return slotId;
  };
  
  // 触发预加载（延迟1秒）
  const triggerPreloadAfterDelay = () => {
    setTimeout(() => {
      preloadNextAd();
    }, 1000);
  };
  
  // 智能预加载触发函数（方案C：避免重复触发）
  const smartPreload = () => {
    // 条件1：已有预加载广告，跳过
    if (preloadedAd) {
      console.log('📋 已有预加载广告，跳过预加载');
      return;
    }
    
    // 条件2：正在预加载中，跳过
    if (isPreloading && preloadingPromise) {
      console.log('⏳ 预加载进行中，跳过重复触发');
      return;
    }
    
    // 条件3：没有预加载，也未在预加载，开始新的预加载
    console.log('🚀 开始新的预加载任务');
    preloadNextAd();
  };
  
  // 预加载一组并行广告位（第一个成功就返回）
  const preloadParallelGroup = (slotIds: string[]): Promise<{ success: boolean; slotId: string | null }> => {
    return new Promise((resolve) => {
      let resolved = false;
      const listeners: { slotId: string; cleanup: () => void }[] = [];
      
      // 为每个广告位创建监听器
      slotIds.forEach(slotId => {
        let isSlotResolved = false;
        
        const onVideoCached = () => {
          if (isSlotResolved || resolved) return;
          isSlotResolved = true;
          
          console.log(`✅ 并行预加载成功: ${slotId}`);
          cleanupAllListeners();
          
          if (!resolved) {
            resolved = true;
            resolve({ success: true, slotId });
          }
        };
        
        const onVideoError = () => {
          if (isSlotResolved || resolved) return;
          isSlotResolved = true;
          console.log(`❌ 并行预加载失败: ${slotId} (视频下载失败)`);
          cleanupSlotListeners(slotId);
        };
        
        const onError = (error: any) => {
          if (isSlotResolved || resolved) return;
          isSlotResolved = true;
          console.log(`❌ 并行预加载失败: ${slotId} (广告加载失败)`, error);
          cleanupSlotListeners(slotId);
        };
        
        const cleanupSlot = () => {
          try {
            GDTAd.removeListener('onVideoCached', onVideoCached);
            GDTAd.removeListener('onError', onVideoError);
            GDTAd.removeListener('onError', onError);
          } catch (e) {
            // 忽略清理错误
          }
        };
        
        listeners.push({ slotId, cleanup: cleanupSlot });
        
        // 注册监听器
        GDTAd.addListener('onVideoCached', onVideoCached);
        GDTAd.addListener('onError', onVideoError);
        GDTAd.addListener('onError', onError);
        
        // 设置超时（2秒）
        setTimeout(() => {
          if (!isSlotResolved && !resolved) {
            isSlotResolved = true;
            console.log(`⏱️ 并行预加载超时: ${slotId}`);
            cleanupSlotListeners(slotId);
          }
        }, 2000);
        
        // 发起请求
        GDTAd.loadRewardVideoAd({ adId: slotId }).catch((error) => {
          if (!isSlotResolved && !resolved) {
            isSlotResolved = true;
            console.log(`❌ 并行预加载请求失败: ${slotId}`, error);
            cleanupSlotListeners(slotId);
          }
        });
      });
      
      // 清理单个广告位的监听器
      const cleanupSlotListeners = (slotId: string) => {
        const listener = listeners.find(l => l.slotId === slotId);
        if (listener) {
          listener.cleanup();
        }
      };
      
      // 清理所有监听器
      const cleanupAllListeners = () => {
        listeners.forEach(l => l.cleanup());
      };
      
      // 如果所有广告位都失败，返回失败
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanupAllListeners();
          resolve({ success: false, slotId: null });
        }
      }, 3100);
    });
  };

  // 预加载单个广告位（串行用）
  const preloadSingleSlot = (slotId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      let isResolved = false;
      
      const onVideoCached = () => {
        if (!isResolved) {
          isResolved = true;
          console.log(`✅ 串行预加载成功: ${slotId}`);
          cleanupListeners();
          resolve(true);
        }
      };
      
      const onVideoError = () => {
        if (!isResolved) {
          isResolved = true;
          console.log(`❌ 串行预加载失败: ${slotId} (视频下载失败)`);
          cleanupListeners();
          resolve(false);
        }
      };
      
      const onError = (error: any) => {
        if (!isResolved) {
          isResolved = true;
          console.log(`❌ 串行预加载失败: ${slotId} (广告加载失败)`, error);
          cleanupListeners();
          resolve(false);
        }
      };
      
      const cleanupListeners = () => {
        try {
          GDTAd.removeListener('onVideoCached', onVideoCached);
          GDTAd.removeListener('onError', onVideoError);
          GDTAd.removeListener('onError', onError);
        } catch (e) {
          // 忽略清理错误
        }
      };
      
      // 注册监听器
      GDTAd.addListener('onVideoCached', onVideoCached);
      GDTAd.addListener('onError', onVideoError);
      GDTAd.addListener('onError', onError);
      
      // 设置超时（2秒）
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.log(`⏱️ 串行预加载超时: ${slotId}`);
          cleanupListeners();
          resolve(false);
        }
      }, 2000);
      
      // 调用loadRewardVideoAd()加载广告
      GDTAd.loadRewardVideoAd({ adId: slotId }).catch((error) => {
        if (!isResolved) {
          isResolved = true;
          console.log(`❌ 串行预加载请求失败: ${slotId}`, error);
          cleanupListeners();
          resolve(false);
        }
      });
    });
  };

  // 预加载下一个广告（策略：一轮轮询所有17个广告位）
  const preloadNextAd = async (): Promise<void> => {
    // 如果已经在预加载，返回现有的Promise
    if (isPreloading && preloadingPromise) {
      return preloadingPromise;
    }
    
    // 如果已经有预加载的广告，直接返回
    if (preloadedAd) {
      console.log('📋 已有预加载广告，跳过预加载');
      return;
    }
    
    isPreloading = true;
    console.log('🚀 开始预加载任务（策略：一轮轮询所有17个广告位）');
    
    // 创建新的预加载Promise
    preloadingPromise = (async () => {
      const totalStartTime = Date.now();
      let foundAd = false;
      
      // 获取所有广告位列表
      const allSlots = Object.values(AD_GROUPS).flat();
      console.log(`📊 广告位总数：${allSlots.length}个`);
      
      // ========== 一轮轮询所有广告位 ==========
      console.log(`\n🔄 预加载尝试 1/1`);
      const startTime = Date.now();
      const TOTAL_TIMEOUT = 15000; // 总超时15秒
      
      for (let i = 0; i < allSlots.length; i++) {
        // 检查总超时
        if (Date.now() - startTime > TOTAL_TIMEOUT) {
          console.log('⏱️ 预加载总超时（16秒），终止任务');
          break;
        }
        
        const slotId = allSlots[i];
        console.log(`🔄 串行 [${i + 1}/${allSlots.length}]: ${slotId}`);
        
        const isReady = await preloadSingleSlot(slotId);
        
        if (isReady) {
          preloadedAd = {
            slotId: slotId,
            isReady: true,
            loadedAt: Date.now()
          };
          console.log(`🎉 串行预加载成功: ${slotId}`);
          foundAd = true;
          break;
        }
        
        // 广告位之间延迟500ms
        if (i < allSlots.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      isPreloading = false;
      preloadingPromise = null;
      const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(1);
      console.log(`📋 预加载任务全部结束，${foundAd ? '成功' : '未找到广告'}，总耗时${totalTime}秒`);
    })();
    
    return preloadingPromise;
  };
  
  // 串行请求广告组
  const trySerialAdGroup = async (slotIds: string[], slotDelay: number = 0): Promise<{ ecpm: number; slotId: string } | null> => {
    console.log(`========== 开始串行请求广告组（共${slotIds.length}个广告位） ==========`);
    
    const sessionId = currentSessionId;
    const checkSession = () => sessionId === currentSessionId;
    
    for (let i = 0; i < slotIds.length; i++) {
      const slotId = slotIds[i];
      const slotIndex = i + 1; // 序号从1开始
      const totalSlots = slotIds.length;
      
      // 检查是否已经显示过广告（用户跳过后停止尝试其他广告位）
      if (hasShownAd) {
        console.log('🛑 已显示过广告，停止尝试其他广告位');
        return null;
      }
      
      if (!checkSession()) {
        console.log('会话已过期，停止加载');
        return null;
      }
      
      // 广告位间延迟（除了第一个）
      if (i > 0 && slotDelay > 0) {
        console.log(`等待 ${slotDelay}ms 后尝试下一个广告位...`);
        await delay(slotDelay);
      }
      
      console.log(`尝试加载广告位 [${slotIndex}/${totalSlots}]: ${slotId}`);
      
      const result = await new Promise<{ ecpm: number; slotId: string } | null>((resolve) => {
        let isResolved = false;
        let slotTimeoutId: any = null;
        let currentAdSuccess = false;
        
        const resolveOnce = (result: { ecpm: number; slotId: string } | null) => {
          if (!isResolved && checkSession()) {
            isResolved = true;
            cleanupSlotListeners();
            if (slotTimeoutId) clearTimeout(slotTimeoutId);
            resolve(result);
          }
        };
        
        const onReward = (result: any) => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          
          console.log(`========== 广告奖励回调 (${slotId}) ==========`);
          console.log('结果:', result);
          
          currentAdSuccess = true;
          if (slotTimeoutId) clearTimeout(slotTimeoutId);
          
          // 清理监听器，防止 onADClose 的延迟回调误判
          cleanupSlotListeners();
          
          // 所有广告位都使用模拟 ECPM 值
          console.log('使用模拟 ECPM 值');
          const simulatedEcpm = generateSimulatedEcpm(slotId);
          const ecpm = calculateActualEcpm(simulatedEcpm);
          
          console.log(`✅ 广告成功 (${slotId})，返回 ECPM:`, ecpm);
          
          resolveOnce({ ecpm, slotId });
        };
        
        const onError = (error: any) => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          console.warn(`⚠️ 广告加载失败 (${slotId}):`, error?.error || error);
          resolveOnce(null);
        };
        
        const onVideoCached = async () => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          
          console.log(`✅ 视频下载成功 (${slotId})，准备显示广告`);
          try {
            if (slotTimeoutId) clearTimeout(slotTimeoutId);
            
            // 检查广告是否就绪
            console.log(`🔍 检查广告就绪状态 (${slotId})...`);
            try {
              const readyStatus = await GDTAd.isReady();
              console.log(`📊 广告就绪状态 (${slotId}):`, readyStatus);
              
              if (!readyStatus.ready) {
                console.warn(`⚠️ 广告未就绪 (${slotId})，尝试强制显示...`);
              }
            } catch (error) {
              console.warn(`⚠️ 检查广告就绪状态失败 (${slotId}):`, error);
            }
            
            console.log(`✅ 广告位加载成功且已就绪 (${slotId})，准备播放`);
            await GDTAd.showRewardVideoAd();
            console.log(`✅ 广告显示命令已发送 (${slotId})`);
          } catch (error) {
            console.error(`❌ 显示广告失败 (${slotId}):`, error);
            resolveOnce(null);
          }
        };
        
        const onVideoError = () => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          console.warn(`⚠️ 视频下载失败 (${slotId})`);
          resolveOnce(null);
        };
        
        const onADClose = () => {
          if (!checkSession()) return;
          console.log(`✅ 广告关闭回调 (${slotId})`);
          
          // 延迟 500ms 判定，确保 onReward 有机会先到达
          setTimeout(() => {
            if (!checkSession() || isResolved) return;
            if (!currentAdSuccess) {
              console.log(`广告关闭但未获得奖励 (${slotId})，标记为失败`);
              cleanupSlotListeners();
              resolveOnce(null);
            } else {
              // 成功获得奖励，清理监听器
              cleanupSlotListeners();
            }
          }, 500);
        };
        
        // 注册监听器
        GDTAd.addListener('onReward', onReward);
        GDTAd.addListener('onError', onError);
        GDTAd.addListener('onVideoCached', onVideoCached);
        GDTAd.addListener('onError', onError);
        GDTAd.addListener('onADClose', onADClose);
        
        // 清理监听器的函数
        const cleanupSlotListeners = () => {
          try {
            GDTAd.removeListener('onReward', onReward);
            GDTAd.removeListener('onError', onError);
            GDTAd.removeListener('onVideoCached', onVideoCached);
            GDTAd.removeListener('onError', onError);
            GDTAd.removeListener('onADClose', onADClose);
          } catch (e) {
            console.warn(`清理监听器失败 (${slotId}):`, e);
          }
        };
        
        // 加载广告
        GDTAd.loadRewardVideoAd({ adId: slotId })
          .then(() => console.log(`✅ 广告加载请求已发送 (${slotId})`))
          .catch((err: any) => {
            console.error(`❌ 加载广告请求失败 (${slotId}):`, err);
            resolveOnce(null);
          });
        
        // 广告位超时
        slotTimeoutId = setTimeout(() => {
          if (!checkSession() || currentAdSuccess || isResolved) return;
          console.warn(`⏱️ 广告加载超时 (${slotId})`);
          resolveOnce(null);
        }, PARALLEL_TIMEOUT);
      });
      
      // 如果当前广告位成功，立即返回
      if (result) {
        console.log(`🎉 串行请求成功，使用广告位: ${result.slotId}，ECPM: ${result.ecpm}`);
        return result;
      }
      
      // 检查是否已经显示过广告（用户跳过后停止尝试其他广告位）
      if (hasShownAd) {
        console.log('🛑 已显示过广告，停止尝试其他广告位');
        return null;
      }
      
      console.log(`广告位 ${slotId} 失败，尝试下一个...`);
    }
    
    console.log('❌ 串行请求组所有广告位均失败');
    return null;
  };
  
  const resetAdState = () => {
    console.log(`[DEBUG] resetAdState 调用 - 当前状态: currentSessionId=${currentSessionId}, triedSlots=${triedSlots}`);
    currentSlotIndex = 0;
    triedSlots = 0;
    isAdLoading.value = false;
    isAdReady.value = false;
    hasShownAd = false; // 重置广告显示标志
    currentSessionId++;
    console.log(`[DEBUG] 🆕 新会话开始，会话ID: ${currentSessionId}`);
    console.log(`[DEBUG] resetAdState 完成 - 所有状态已重置`);
  };

  onMounted(() => initializeAdSdk());
  onUnmounted(() => cleanupListeners());

  const cleanupListeners = () => {
    console.log('[DEBUG] 🔄 清理广告监听器...');
    console.log('[DEBUG] cleanupListeners - rewardListener:', !!rewardListener, 'errorListener:', !!errorListener, 'videoCachedListener:', !!videoCachedListener, 'adCloseListener:', !!adCloseListener);
    
    const listeners = [
      { name: 'onReward', handler: rewardListener },
      { name: 'onError', handler: errorListener },
      { name: 'onVideoCached', handler: videoCachedListener },
      { name: 'onError', handler: videoErrorListener },
      { name: 'onADLoad', handler: adLoadListener },
      { name: 'onADClose', handler: adCloseListener }
    ];
    
    listeners.forEach(({ name, handler }) => {
      if (handler) {
        try {
          GDTAd.removeListener(name, handler);
          console.log(`[DEBUG] cleanupListeners - 已移除 ${name} 监听器`);
        } catch (e) {
          console.warn(`[DEBUG] 移除 ${name} 监听器失败:`, e);
        }
      } else {
        console.log(`[DEBUG] cleanupListeners - ${name} 监听器为 null，跳过`);
      }
    });
    
    rewardListener = null;
    errorListener = null;
    videoCachedListener = null;
    videoErrorListener = null;
    adLoadListener = null;
    adCloseListener = null;
    
    [timeoutId, retryTimeoutId, slotTimeoutId].forEach((id, index) => {
      if (id) {
        clearTimeout(id);
        console.log(`[DEBUG] cleanupListeners - 已清除定时器 [${index}]`);
        id = null;
      }
    });
    
    console.log('[DEBUG] ✅ 监听器清理完成');
  };

  const isNativeApp = () => {
    return typeof window !== 'undefined' && 
           (window as any).Capacitor?.getPlatform() === 'android';
  };

  const initializeAdSdk = async () => {
    console.log('[DEBUG] ======== initializeAdSdk 开始 ========');
    console.log('[DEBUG] initializeAdSdk - typeof window:', typeof window);
    
    if (typeof window === 'undefined') {
      console.log('[DEBUG] initializeAdSdk - window 未定义，跳过初始化');
      return;
    }

    try {
      const isNative = isNativeApp();
      console.log('[DEBUG] initializeAdSdk - isNativeApp:', isNative);
      console.log('[DEBUG] initializeAdSdk - Capacitor platform:', (window as any).Capacitor?.getPlatform());
      
      if (isNative) {
        console.log('原生 Android 环境，使用优量汇(GDT)原生 SDK');
        isAdSdkReady.value = true;
        isLoaded.value = true;
        preloadAd.value = true;
        console.log('[DEBUG] initializeAdSdk - 设置 isAdSdkReady=true, isLoaded=true, preloadAd=true');
        console.log('[DEBUG] initializeAdSdk - 初始化完成，准备使用简单加载流程');
        
        // 注释掉预加载代码，使用简单加载流程
        // // SDK 加载成功后 500ms 触发预加载
        // setTimeout(() => {
        //   console.log('📱 原生环境 SDK 就绪，开始预加载广告');
        //   preloadNextAd();
        // }, 500);
        
        return;
      }

      console.log('Web 环境不支持优量汇原生广告，请使用 Android 原生环境');
      isLoaded.value = true;
      isAdSdkReady.value = false;
      preloadAd.value = true;
      console.log('[DEBUG] initializeAdSdk - Web 环境，设置 isAdSdkReady=false');
    } catch (error) {
      console.error('[DEBUG] 初始化广告 SDK 失败:', error);
      console.error('[DEBUG] 错误详情 - message:', error?.message, 'stack:', error?.stack);
      isLoaded.value = true;
      isAdSdkReady.value = false;
      preloadAd.value = true;
    }
    console.log('[DEBUG] ======== initializeAdSdk 结束 ========');
  };
  
  // 显示预加载的广告
  const showPreloadedAd = async (resolve: (value: { ecpm: number; slotId: string }) => void, reject: (reason?: any) => void) => {
    if (!preloadedAd || !preloadedAd.isReady) {
      console.log('预加载广告未就绪，开始正常加载');
      reject(new Error('预加载广告未就绪'));
      return;
    }
    
    const slotId = preloadedAd.slotId;
    console.log(`🚀 使用预加载的广告位: ${slotId}`);
    
    // 清除预加载状态
    preloadedAd = null;
    
    // 设置广告显示标志
    hasShownAd = true;
    
    // 注册监听器
    let isResolved = false;
    let currentAdSuccess = false;
    
    const resolveOnce = (result: { ecpm: number; slotId: string } | null) => {
      if (!isResolved) {
        isResolved = true;
        cleanupSlotListeners();
        if (result) {
          resolve(result);
        } else {
          reject(new Error('广告显示失败'));
        }
      }
    };
    
    const onReward = (result: any) => {
      if (currentAdSuccess || isResolved) return;
      
      console.log(`========== 预加载广告奖励回调 (${slotId}) ==========`);
      console.log('结果:', result);
      
      currentAdSuccess = true;
      
      // 清理监听器，防止 onADClose 触发时误判
      cleanupSlotListeners();
      
      // 所有广告位都使用模拟 ECPM 值
      console.log('使用模拟 ECPM 值');
      const simulatedEcpm = generateSimulatedEcpm(slotId);
      const ecpm = calculateActualEcpm(simulatedEcpm);
      
      console.log(`✅ 预加载广告成功 (${slotId})，返回 ECPM:`, ecpm);
      
      resolveOnce({ ecpm, slotId });
    };
    
    const onADShow = () => {
      console.log(`📺 预加载广告页面已打开 (${slotId})，智能触发预加载`);
      smartPreload();
    };
    
    const onADClose = () => {
      console.log(`✅ 预加载广告关闭回调 (${slotId})`);
      
      // 延迟 500ms 判定，确保 onReward 有机会先到达
      setTimeout(() => {
        if (!currentAdSuccess && !isResolved) {
          console.log(`预加载广告关闭但未获得奖励 (${slotId})，标记为失败`);
          cleanupSlotListeners();
          resolveOnce(null);
        } else {
          // 成功获得奖励，清理监听器
          cleanupSlotListeners();
        }
      }, 500);
    };
    
    const cleanupSlotListeners = () => {
      try {
        GDTAd.removeListener('onReward', onReward);
        GDTAd.removeListener('onADClose', onADClose);
        GDTAd.removeListener('onADShow', onADShow);
      } catch (e) {
        console.warn(`清理预加载广告监听器失败 (${slotId}):`, e);
      }
    };
    
    // 注册监听器
    GDTAd.addListener('onReward', onReward);
    GDTAd.addListener('onADClose', onADClose);
    GDTAd.addListener('onADShow', onADShow);
    
    try {
      // 显示广告
      await GDTAd.showRewardVideoAd();
      console.log(`✅ 预加载广告显示命令已发送 (${slotId})`);
    } catch (error) {
      console.error(`❌ 显示预加载广告失败 (${slotId}):`, error);
      cleanupSlotListeners();
      resolveOnce(null);
    }
  };

  // 获取用户ID
  const getUserId = (): string | null => {
    return localStorage.getItem('userId') || null;
  };

  // 获取员工ID
  const getEmployeeId = (): string | null => {
    return localStorage.getItem('empId') || null;
  };

  // 红包触发逻辑已移至后端处理

  const showAd = async (): Promise<{ ecpm: number; slotId: string }> => {
    const startTime = Date.now();
    console.log(`[DEBUG] ======== showAd 开始 ========`);
    console.log(`[DEBUG] showAd - isProcessing=${isProcessing}, isAdLoading=${isAdLoading.value}, isAdReady=${isAdReady.value}`);
    console.log(`[DEBUG] showAd - config.slotIds=${JSON.stringify(config.slotIds)}`);
    
    return new Promise(async (resolve, reject) => {
      // 防止并发请求
      if (isProcessing) {
        console.log('[DEBUG] showAd - 被拒绝: 已有广告正在处理');
        console.log('⚠️ 已有广告正在处理，请等待');
        reject(new Error('已有广告正在处理'));
        return;
      }
      
      isProcessing = true;
      console.log(`[DEBUG] showAd - 设置 isProcessing=true, 调用 resetAdState()`);
      resetAdState();
      currentResolve = resolve;
      currentReject = reject;
      console.log(`[DEBUG] showAd - currentResolve/currentReject 已设置`);
      
      console.log('========== 开始加载激励视频广告（简单模式） ==========');
      console.log('所有广告位:', config.slotIds);
      
      // 简化：直接使用 tryLoadAd 加载，不使用预加载
      try {
        console.log(`[DEBUG] showAd - 调用 tryLoadAd()`);
        const loadStartTime = Date.now();
        const result = await tryLoadAd();
        const loadDuration = Date.now() - loadStartTime;
        console.log(`[DEBUG] showAd - tryLoadAd 返回: result=${result}, 耗时=${loadDuration}ms`);
        
        if (result === 'success') {
          console.log(`[DEBUG] showAd - 广告加载并显示成功 (耗时: ${Date.now() - startTime}ms)`);
          console.log('✅ 广告加载并显示成功');
          // currentResolve 已在 onReward 中被调用
        } else if (result === 'session_expired') {
          console.log('[DEBUG] showAd - 会话已过期');
          console.log('❌ 会话已过期');
          isProcessing = false;
          reject(new Error('会话已过期'));
        } else {
          console.log('[DEBUG] showAd - 广告加载失败');
          console.log('❌ 广告加载失败');
          isProcessing = false;
          reject(new Error('暂无广告'));
        }
      } catch (error) {
        console.log(`[DEBUG] showAd - 捕获异常:`, error);
        console.log('❌ 广告加载异常:', error);
        isProcessing = false;
        reject(new Error('广告加载异常'));
      }
    });
  };

  // 串行加载单个广告位
  const tryLoadAd = async (): Promise<'success' | 'failed' | 'session_expired'> => {
    const sessionId = currentSessionId;
    let currentAdSuccess = false; // 当前广告是否成功
    const loadStartTime = Date.now();
    
    console.log(`[DEBUG] ========== tryLoadAd 开始 ==========`);
    console.log(`[DEBUG] tryLoadAd - sessionId=${sessionId}, triedSlots=${triedSlots}, currentSlotIndex=${currentSlotIndex}`);
    console.log(`[DEBUG] tryLoadAd - isAdLoading=${isAdLoading.value}, isAdReady=${isAdReady.value}`);
    console.log(`[DEBUG] config.slotIds=${JSON.stringify(config.slotIds)}`);
    
    const checkSession = () => sessionId === currentSessionId;
    
    if (!checkSession()) {
      console.log('[DEBUG] 会话已过期，停止加载');
      return 'session_expired';
    }
    
    // 检查是否已尝试所有轮次
    const maxSlots = config.slotIds.length;
    if (triedSlots >= maxSlots) {
      console.log('[DEBUG] 所有广告位都已尝试, maxSlots=' + maxSlots);
      return 'failed';
    }
    
    // 清理之前的监听器
    cleanupListeners();
    console.log('[DEBUG] 已清理之前的监听器');
    
    const selectedSlotId = getNextSlotId();
    console.log(`[DEBUG] 尝试加载广告位: ${selectedSlotId}, triedSlots=${triedSlots}`);
    
    return new Promise((resolveLoad) => {
      let isResolved = false; // 标记当前加载是否已解决
      const slotStartTime = Date.now();
      
      const resolveOnce = (result: 'success' | 'failed') => {
        console.log(`[DEBUG] resolveOnce 被调用 - result=${result}, isResolved=${isResolved}, 耗时=${Date.now() - loadStartTime}ms`);
        if (!isResolved) {
          isResolved = true;
          resolveLoad(result);
          console.log(`[DEBUG] resolveLoad(${result}) 已执行`);
        } else {
          console.log(`[DEBUG] resolveOnce 被忽略 - 已经 resolved 过了`);
        }
      };
      
      const onADLoad = () => {
        const loadTime = Date.now() - slotStartTime;
        console.log(`[DEBUG] onADLoad 触发 - 广告加载成功回调 (距离加载开始: ${loadTime}ms)`);
        console.log('[DEBUG] onADLoad - checkSession:', checkSession(), 'currentAdSuccess:', currentAdSuccess);
        if (!checkSession()) {
          console.log('[DEBUG] onADLoad - 会话已过期，忽略');
          return;
        }
        console.log('[DEBUG] onADLoad - 会话有效，广告已加载成功');
      };

      const onReward = (result: any) => {
        const rewardTime = Date.now() - slotStartTime;
        console.log(`[DEBUG] onReward 触发 - 收到奖励回调 (距离加载开始: ${rewardTime}ms)`);
        console.log('[DEBUG] onReward result 完整内容:', JSON.stringify(result));
        console.log('[DEBUG] onReward - result 类型:', typeof result);
        console.log('[DEBUG] onReward - result 键:', result ? Object.keys(result) : 'null/undefined');
        console.log('[DEBUG] onReward checkSession:', checkSession(), 'currentAdSuccess:', currentAdSuccess, 'isResolved:', isResolved);
        
        if (!checkSession() || currentAdSuccess) {
          console.log('[DEBUG] onReward - 被忽略: checkSession=' + checkSession() + ', currentAdSuccess=' + currentAdSuccess);
          return;
        }
        
        console.log('========== 广告奖励回调 ==========');
        console.log('结果:', result);
        
        currentAdSuccess = true;
        console.log('[DEBUG] onReward - currentAdSuccess 设为 true');
        
        if (slotTimeoutId) {
          clearTimeout(slotTimeoutId);
          console.log('[DEBUG] onReward - 已清除 slotTimeoutId');
        }
        
        // 清理监听器，防止 onADClose 的延迟回调误判
        cleanupListeners();
        console.log('[DEBUG] onReward - 已清理监听器');
        
        // 获取当前广告位ID（这里用 selectedSlotId，因为这是我们加载的广告位）
        const currentSlotId = selectedSlotId;
        console.log(`[DEBUG] onReward - currentSlotId=${currentSlotId}`);

        // 所有广告位（保价 + 竞价）统一使用模拟 ECPM，不使用 SDK 返回的真实 eCPM
        const simulatedEcpm = generateSimulatedEcpm(currentSlotId);
        const ecpm = calculateActualEcpm(simulatedEcpm);
        console.log(`[DEBUG] onReward - 使用模拟 ECPM: ${simulatedEcpm} → 实际传输: ${ecpm}`);
        console.log(`[DEBUG] onReward - SDK返回的ecpm: ${result.ecpm || 0}`);

        isAdLoading.value = false;
        isAdReady.value = false;
        
        console.log('✅ 广告成功，返回 ECPM:', ecpm, '广告位ID:', currentSlotId);
        
        if (currentResolve) {
          console.log('[DEBUG] onReward - 调用 currentResolve，传递 { ecpm, slotId }');
          currentResolve({ ecpm, slotId: currentSlotId });
          console.log('[DEBUG] onReward - currentResolve 调用完成');
        } else {
          console.warn('[DEBUG] onReward - currentResolve 为 null! Promise 可能已被拒绝');
        }
        
        currentResolve = null;
        currentReject = null;
        isProcessing = false;
        console.log(`[DEBUG] onReward - isProcessing 设为 false, 准备 resolveOnce('success')`);
        resolveOnce('success');
      };
      
      const onError = (error: any) => {
        const errorTime = Date.now() - slotStartTime;
        console.log(`[DEBUG] onError 触发 (距离加载开始: ${errorTime}ms)`);
        console.log('[DEBUG] onError - 错误详情:', JSON.stringify(error));
        console.log('[DEBUG] onError - 错误类型:', typeof error);
        console.log('[DEBUG] onError - checkSession:', checkSession(), 'currentAdSuccess:', currentAdSuccess, 'isResolved:', isResolved);
        
        if (!checkSession() || currentAdSuccess || isResolved) {
          console.log('[DEBUG] onError - 被忽略 (会话过期或已处理)');
          return;
        }
        
        console.warn('⚠️ 广告加载失败:', error?.error || error);
        lastError.value = '广告加载失败: ' + (error?.error || error || '未知错误');
        
        if (slotTimeoutId) {
          clearTimeout(slotTimeoutId);
          console.log('[DEBUG] onError - 已清除超时定时器');
        }
        cleanupListeners();
        resolveOnce('failed');
      };

      const onVideoCached = async () => {
        const cacheTime = Date.now() - slotStartTime;
        console.log(`[DEBUG] onVideoCached 触发 - 视频下载成功 (距离加载开始: ${cacheTime}ms)`);
        console.log('[DEBUG] onVideoCached - checkSession:', checkSession(), 'currentAdSuccess:', currentAdSuccess, 'isResolved:', isResolved);
        
        if (!checkSession() || currentAdSuccess || isResolved) {
          console.log('[DEBUG] onVideoCached - 被忽略 (可能是会话过期或已处理)');
          return;
        }
        
        console.log('✅ 视频下载成功，准备显示广告');
        try {
          if (slotTimeoutId) {
            clearTimeout(slotTimeoutId);
            console.log('[DEBUG] onVideoCached - 已清除超时定时器');
          }
          
          isAdReady.value = true;
          isAdLoading.value = false;
          console.log('[DEBUG] onVideoCached - isAdReady=true, isAdLoading=false');
          
          // 检查广告是否就绪（未过期且缓存成功）
          console.log('[DEBUG] onVideoCached - 检查广告就绪状态...');
          try {
            const readyStartTime = Date.now();
            const readyStatus = await GDTAd.isReady();
            console.log(`[DEBUG] onVideoCached - isReady返回 (耗时${Date.now() - readyStartTime}ms):`, JSON.stringify(readyStatus));
            
            if (!readyStatus.ready) {
              console.warn('[DEBUG] onVideoCached - 广告未就绪，但仍尝试显示');
            }
          } catch (error) {
            console.warn('[DEBUG] onVideoCached - isReady检查失败:', error);
          }
          
          console.log('[DEBUG] onVideoCached - 调用 showRewardVideoAd...');
          const showStartTime = Date.now();
          await GDTAd.showRewardVideoAd();
          console.log(`[DEBUG] onVideoCached - showRewardVideoAd 调用成功 (耗时${Date.now() - showStartTime}ms)`);
          console.log('✅ 广告显示命令已发送');
        } catch (error) {
          console.error('[DEBUG] onVideoCached - 显示广告失败:', error);
          console.error('[DEBUG] onVideoCached - 错误类型:', typeof error, 'message:', error?.message);
          console.error('❌ 显示广告失败:', error);
          lastError.value = '显示广告失败: ' + (error?.message || error);
          cleanupListeners();
          resolveOnce('failed');
        }
      };

      const onVideoError = () => {
        const errorTime = Date.now() - slotStartTime;
        console.log(`[DEBUG] onVideoError 触发 - 视频下载失败 (距离加载开始: ${errorTime}ms)`);
        console.log('[DEBUG] onVideoError - checkSession:', checkSession(), 'currentAdSuccess:', currentAdSuccess, 'isResolved:', isResolved);
        if (!checkSession() || currentAdSuccess || isResolved) {
          console.log('[DEBUG] onVideoError - 被忽略 (会话过期或已处理)');
          return;
        }
        
        console.warn('⚠️ 视频下载失败');
        lastError.value = '视频下载失败，可能是广告填充不足';
        
        if (slotTimeoutId) {
          clearTimeout(slotTimeoutId);
          console.log('[DEBUG] onVideoError - 已清除超时定时器');
        }
        cleanupListeners();
        resolveOnce('failed');
      };
      
      const onADClose = () => {
        const closeTime = Date.now() - slotStartTime;
        console.log(`[DEBUG] onADClose 触发 - 广告关闭回调 (距离加载开始: ${closeTime}ms)`);
        console.log('[DEBUG] onADClose - checkSession:', checkSession(), 'currentAdSuccess:', currentAdSuccess, 'isResolved:', isResolved);
        console.log('[DEBUG] onADClose - isAdReady:', isAdReady.value, 'isAdLoading:', isAdLoading.value);
        
        if (!checkSession()) {
          console.log('[DEBUG] onADClose - 会话已过期，忽略');
          return;
        }
        
        console.log('✅ 广告关闭回调');
        if (slotTimeoutId) {
          clearTimeout(slotTimeoutId);
          console.log('[DEBUG] onADClose - 已清除 slotTimeoutId');
        }
        isAdReady.value = false;
        isAdLoading.value = false;
        console.log('[DEBUG] onADClose - 已重置 isAdReady/isAdLoading');
        
        // 延迟 500ms 判定，确保 onReward 有机会先到达
        console.log('[DEBUG] onADClose - 延迟500ms后检查奖励状态...');
        const delayStart = Date.now();
        setTimeout(() => {
          const elapsed = Date.now() - delayStart;
          console.log(`[DEBUG] onADClose setTimeout - ${elapsed}ms 后触发, currentAdSuccess=${currentAdSuccess}, isResolved=${isResolved}`);
          if (!currentAdSuccess && !isResolved) {
            console.log('[DEBUG] onADClose setTimeout - 广告关闭但未获得奖励，标记为失败');
            console.log('[DEBUG] onADClose setTimeout - 可能原因: onReward 回调未触发或被忽略');
            cleanupListeners();
            resolveOnce('failed');
          } else {
            console.log('[DEBUG] onADClose setTimeout - 成功获得奖励或已 resolve，清理监听器');
            // 成功获得奖励或已 resolve，清理监听器
            cleanupListeners();
          }
        }, 500);
      };
      
      console.log('[DEBUG] 注册监听器...');
      adLoadListener = onADLoad;
      rewardListener = onReward;
      errorListener = onError;
      videoCachedListener = onVideoCached;
      videoErrorListener = onVideoError;
      adCloseListener = onADClose;
      
      GDTAd.addListener('onADLoad', onADLoad);
      GDTAd.addListener('onReward', onReward);
      GDTAd.addListener('onError', onError);
      GDTAd.addListener('onVideoCached', onVideoCached);
      GDTAd.addListener('onVideoError', onVideoError);
      GDTAd.addListener('onADClose', onADClose);
      console.log('[DEBUG] 监听器注册完成 (onADLoad, onReward, onError, onVideoCached, onVideoError, onADClose)');
      
      console.log(`[DEBUG] 调用 GDTAd.loadRewardVideoAd({ adId: ${selectedSlotId} })`);
      const loadPromise = GDTAd.loadRewardVideoAd({ adId: selectedSlotId });
      console.log(`[DEBUG] loadRewardVideoAd 返回:`, loadPromise);
      loadPromise
        .then(() => {
          console.log('[DEBUG] 广告加载请求已发送（Promise resolve）');
          console.log('✅ 广告加载请求已发送');
          isAdLoading.value = true;
          console.log('[DEBUG] isAdLoading 设为 true');
        })
        .catch((err: any) => {
          console.error('[DEBUG] 加载广告请求失败:', JSON.stringify(err));
          console.error('[DEBUG] 错误详情 - message:', err?.message, 'code:', err?.code);
          console.error('❌ 加载广告请求失败:', err);
          if (!isResolved) {
            cleanupListeners();
            resolveOnce('failed');
          }
        });
      
      // 单层超时
      const SLOT_TIMEOUT = 3000;
      console.log(`[DEBUG] 设置 ${SLOT_TIMEOUT}ms 超时定时器`);
      slotTimeoutId = setTimeout(() => {
        console.log(`[DEBUG] 超时触发 - checkSession=${checkSession()}, currentAdSuccess=${currentAdSuccess}, isResolved=${isResolved}`);
        if (!checkSession() || currentAdSuccess || isResolved) {
          console.log('[DEBUG] 超时被忽略 - 状态已变更');
          return;
        }
        
        console.warn(`⏱️ 单层广告加载超时（${SLOT_TIMEOUT}ms）`);
        console.log(`[DEBUG] 超时 - 广告位 ${selectedSlotId} 未能在规定时间内完成加载`);
        cleanupListeners();
        resolveOnce('failed');
      }, SLOT_TIMEOUT);
    });
  };
  
  const showNativeAd = async (resolve: (value: { ecpm: number; slotId: string }) => void, reject: (reason?: any) => void) => {
    const sessionId = currentSessionId;
    const checkSession = () => sessionId === currentSessionId;
    
    // 前4组并行请求已注释，改为全部串行
    // // 1. 第一组并行请求
    // let result = await tryParallelAdGroup(AD_GROUPS.group1);
    // if (result && checkSession()) {
    //   isAdLoading.value = false;
    //   isAdReady.value = false;
    //   isProcessing = false;
    //   resolve(result);
    //   return;
    // }
    
    // // 组间延迟
    // if (checkSession()) {
    //   console.log(`等待 ${GROUP_DELAY}ms 后尝试下一组...`);
    //   await delay(GROUP_DELAY);
    // }
    
    // // 2. 第二组并行请求
    // result = await tryParallelAdGroup(AD_GROUPS.group2);
    // if (result && checkSession()) {
    //   isAdLoading.value = false;
    //   isAdReady.value = false;
    //   isProcessing = false;
    //   resolve(result);
    //   return;
    // }
    
    // // 组间延迟
    // if (checkSession()) {
    //   console.log(`等待 ${GROUP_DELAY}ms 后尝试下一组...`);
    //   await delay(GROUP_DELAY);
    // }
    
    // // 3. 第三组并行请求
    // result = await tryParallelAdGroup(AD_GROUPS.group3);
    // if (result && checkSession()) {
    //   isAdLoading.value = false;
    //   isAdReady.value = false;
    //   isProcessing = false;
    //   resolve(result);
    //   return;
    // }
    
    // // 组间延迟
    // if (checkSession()) {
    //   console.log(`等待 ${GROUP_DELAY}ms 后尝试下一组...`);
    //   await delay(GROUP_DELAY);
    // }
    
    // // 4. 第四组并行请求
    // result = await tryParallelAdGroup(AD_GROUPS.group4);
    // if (result && checkSession()) {
    //   isAdLoading.value = false;
    //   isAdReady.value = false;
    //   isProcessing = false;
    //   resolve(result);
    //   return;
    // }
    
    // // 组间延迟
    // if (checkSession()) {
    //   console.log(`等待 ${GROUP_DELAY}ms 后尝试下一组...`);
    //   await delay(GROUP_DELAY);
    // }
    
    // 全部串行请求
    let result = await trySerialAdGroup(Object.values(AD_GROUPS).flat(), GROUP5_SLOT_DELAY);
    if (result && checkSession()) {
      isAdLoading.value = false;
      isAdReady.value = false;
      isProcessing = false;
      resolve(result);
      return;
    }
    
    // 所有广告位尝试失败
    isAdLoading.value = false;
    isAdReady.value = false;
    isProcessing = false;
    showNoAdAvailable(reject);
  };

  const showH5Ad = (resolve: (value: { ecpm: number; slotId: string }) => void, reject: (reason?: any) => void) => {
    isAdLoading.value = false;
    isProcessing = false;
    console.log('Web 环境不支持优量汇原生广告');
    reject(new Error('Web环境不支持广告，请使用Android原生环境'));
  };

  // _oldShowH5Ad 已移除（百度H5 SDK不再使用）

  const showNoAdAvailable = (reject: (reason?: any) => void) => {
    console.log('⚠️ 所有广告位都已尝试，暂无合适广告');
    lastError.value = '暂无合适广告匹配，请稍后重试';
    isAdLoading.value = false;
    isAdReady.value = false;
    isProcessing = false;
    currentResolve = null;
    currentReject = null;
    cleanupListeners();
    reject(new Error('暂无合适广告匹配'));
  };

  return {
    isLoaded,
    isAdSdkReady,
    isAdLoading,
    isAdReady,
    lastError,
    preloadAd,
    showRewardVideo: showAd,
    initializeAdSdk,
    preloadNextAd,
    triggerPreloadAfterDelay
  };
}
