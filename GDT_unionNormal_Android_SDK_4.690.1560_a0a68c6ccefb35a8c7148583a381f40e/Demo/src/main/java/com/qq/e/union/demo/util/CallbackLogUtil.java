package com.qq.e.union.demo.util;

import android.util.Log;

/**
 * 打印所有回调处日志
 */
public class CallbackLogUtil {
  private static final String LOG_AD_LOADED = "onADLoaded";  // 广告加载成功
  private static final String LOG_AD_PRESENT = "onADPresent";  // 广告展示成功
  private static final String LOG_NO_AD = "onNoAd";  // 广告展示失败
  private static final String LOG_AD_EXPOSE = "onADExpose";  // 广告曝光
  private static final String LOG_AD_CLICK = "onADClick";  // 广告曝光
  private static final String LOG_AD_CLOSE = "onADClose";  // 关闭
  private static final String LOG_ERROR = "onError";
  private static final String LOG_RENDER_SUCCESS = "onRenderSuccess"; // 渲染成功
  private static final String LOG_RENDER_FAIL = "onRenderFail"; // 渲染失败
  private static final String LOG_AD_STAT_CHANGED = "onADStatusChanged"; // apk数据更新
  private static final String LOG_LEFT_APP = "onADLeftApplication"; // 离开当前app
  private static final String LOG_AD_TICK = "onADTick";  // 开屏倒计时
  private static final String LOG_AD_REWARD = "onADReward"; // 激励视频获奖
  private static final String LOG_VIDEO_COMPLETE = "onVideoComplete"; // 激励视频播放完毕
  private static final String LOG_VIDEO_CACHED = "onVideoCached"; // 视频加载成功

  /**
   * 公共回调
   */
  public static void logAdLoaded(String tag) {
    Log.i(tag, LOG_AD_LOADED);
  }

  public static void logAdPresent(String tag) {
    Log.i(tag, LOG_AD_PRESENT);
  }

  public static void logNoAd(String tag) {
    Log.i(tag, LOG_NO_AD);
  }

  public static void logAdExpose(String tag) {
    Log.i(tag, LOG_AD_EXPOSE);
  }

  public static void logAdClick(String tag) {
    Log.i(tag, LOG_AD_CLICK);
  }

  public static void logAdClose(String tag) {
    Log.i(tag, LOG_AD_CLOSE);
  }

  public static void logError(String tag) {
    Log.i(tag, LOG_ERROR);
  }

  public static void logRenderSuccess(String tag) {
    Log.i(tag, LOG_RENDER_SUCCESS);
  }

  public static void logRenderFail(String tag) {
    Log.i(tag, LOG_RENDER_FAIL);
  }

  public static void logADLeftApplication(String tag) {
    Log.i(tag, LOG_LEFT_APP);
  }

  public static void logADStatusChanged(String tag) {
    Log.i(tag, LOG_AD_STAT_CHANGED);
  }


  /**
   * 其他
   */
  public static void logAdTick(String tag) {
    Log.i(tag, LOG_AD_TICK);
  }

  public static void logAdReward(String tag) {
    Log.i(tag, LOG_AD_REWARD);
  }

  public static void logVideoComplete(String tag) {
    Log.i(tag, LOG_VIDEO_COMPLETE);
  }

  public static void logVideoCached(String tag) {
    Log.i(tag, LOG_VIDEO_CACHED);
  }
}
