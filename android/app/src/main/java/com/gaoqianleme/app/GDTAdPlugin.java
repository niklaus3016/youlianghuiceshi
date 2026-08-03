package com.qingxujifen.app;

import android.app.Activity;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.qq.e.ads.rewardvideo.RewardVideoAD;
import com.qq.e.ads.rewardvideo.RewardVideoADListener;
import com.qq.e.ads.rewardvideo.ServerSideVerificationOptions;
import com.qq.e.comm.util.AdError;

import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "GDTAd")
public class GDTAdPlugin extends Plugin {

    private static final String TAG = "GDTAdPlugin";
    private RewardVideoAD mRewardVideoAD;
    private PluginCall pendingShowCall;
    private boolean isRewardGiven = false;  // 标记是否已发放奖励
    private android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

    @PluginMethod
    public void loadRewardVideoAd(PluginCall call) {
        String posId = call.getString("adId");
        if (posId == null || posId.isEmpty()) {
            call.reject("广告位ID不能为空");
            return;
        }

        Log.d(TAG, "加载广告位: " + posId);

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity 为空");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                // 重置状态
                isRewardGiven = false;
                // 创建 RewardVideoAD，有声播放
                mRewardVideoAD = new RewardVideoAD(activity, posId, new RewardVideoADListener() {
                    @Override
                    public void onADLoad() {
                        Log.d(TAG, "广告加载成功 onADLoad");
                        notifyListeners("onADLoad", new JSObject());
                    }

                    @Override
                    public void onVideoCached() {
                        Log.d(TAG, "视频缓存成功 onVideoCached");
                        // 视频缓存成功即可展示，对应百度的 onVideoDownloadSuccess
                        notifyListeners("onVideoCached", new JSObject());
                    }

                    @Override
                    public void onADShow() {
                        Log.d(TAG, "广告展示 onADShow");
                        notifyListeners("onADShow", new JSObject());
                    }

                    @Override
                    public void onADExpose() {
                        Log.d(TAG, "广告曝光 onADExpose");
                        notifyListeners("onADExpose", new JSObject());
                    }

                    @Override
                    public void onReward(Map<String, Object> map) {
                        Log.d(TAG, "获得奖励 onReward: " + map);
                        isRewardGiven = true;  // 标记奖励已发放

                        JSObject result = new JSObject();
                        result.put("rewardVerify", true);

                        // 从 map 中提取 TRANS_ID 和其他信息
                        if (map != null) {
                            for (String key : map.keySet()) {
                                Object value = map.get(key);
                                if (value != null) {
                                    result.put(key, value);
                                }
                            }
                        }

                        // 获取 eCPM
                        double ecpmValue = 0;
                        if (mRewardVideoAD != null) {
                            try {
                                ecpmValue = mRewardVideoAD.getECPM();
                                Log.d(TAG, "eCPM: " + ecpmValue + ", eCPMLevel: " + mRewardVideoAD.getECPMLevel());
                            } catch (Exception e) {
                                Log.w(TAG, "获取eCPM失败: " + e.getMessage());
                            }
                        }
                        result.put("ecpm", ecpmValue);
                        Log.d(TAG, "最终返回的ECPM: " + ecpmValue);

                        // 先通知前端监听器
                        notifyListeners("onReward", result);
                        Log.d(TAG, "已通知前端 onReward");

                        // 再 resolve showRewardVideoAd 的 Promise
                        if (pendingShowCall != null) {
                            Log.d(TAG, "resolve pendingShowCall (奖励成功)");
                            pendingShowCall.resolve(result);
                            pendingShowCall = null;
                        }
                    }

                    @Override
                    public void onADClick() {
                        Log.d(TAG, "广告点击 onADClick");
                        notifyListeners("onADClick", new JSObject());
                    }

                    @Override
                    public void onVideoComplete() {
                        Log.d(TAG, "视频播放完成 onVideoComplete");
                        notifyListeners("onVideoComplete", new JSObject());
                    }

                    @Override
                    public void onADClose() {
                        Log.d(TAG, "广告关闭 onADClose, isRewardGiven=" + isRewardGiven);
                        notifyListeners("onADClose", new JSObject());

                        // 延迟处理，确保 onReward 有机会先执行
                        handler.postDelayed(() -> {
                            if (pendingShowCall != null) {
                                if (isRewardGiven) {
                                    // onReward 应该已经 resolve 了，但为保险起见再检查
                                    Log.d(TAG, "onADClose delayed: 奖励已发放，resolve（不应该执行到这里）");
                                } else {
                                    // 奖励未发放，判定为失败
                                    Log.d(TAG, "onADClose delayed: 奖励未发放，resolve pendingShowCall（无奖励）");
                                    JSObject result = new JSObject();
                                    result.put("rewardVerify", false);
                                    result.put("ecpm", 0);
                                    pendingShowCall.resolve(result);
                                    pendingShowCall = null;
                                }
                            }
                        }, 300); // 延迟 300ms
                    }

                    @Override
                    public void onError(AdError adError) {
                        String msg = String.format(Locale.getDefault(),
                                "onError, error code: %d, error msg: %s",
                                adError.getErrorCode(), adError.getErrorMsg());
                        Log.e(TAG, "广告错误: " + msg);

                        JSObject errorObj = new JSObject();
                        errorObj.put("error", adError.getErrorMsg());
                        errorObj.put("errorCode", adError.getErrorCode());
                        notifyListeners("onError", errorObj);

                        if (pendingShowCall != null) {
                            pendingShowCall.reject(msg);
                            pendingShowCall = null;
                        }
                    }
                }, true);

                // 设置服务端验证选项（可选）
                ServerSideVerificationOptions options = new ServerSideVerificationOptions.Builder()
                        .setCustomData("")
                        .setUserId("")
                        .build();
                mRewardVideoAD.setServerSideVerificationOptions(options);

                // 加载广告
                mRewardVideoAD.loadAD();
                call.resolve();

            } catch (Exception e) {
                Log.e(TAG, "加载广告异常: " + e.getMessage(), e);
                call.reject("加载广告异常: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void showRewardVideoAd(PluginCall call) {
        Log.d(TAG, "显示广告");

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity 为空");
            return;
        }

        if (mRewardVideoAD == null) {
            call.reject("广告未加载");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                if (mRewardVideoAD.isValid() && !mRewardVideoAD.hasShown()) {
                    pendingShowCall = call;
                    isRewardGiven = false;  // 重置奖励标志
                    mRewardVideoAD.showAD();
                } else {
                    call.reject(mRewardVideoAD.hasShown() ? "广告已展示过" : "广告无效");
                }
            } catch (Exception e) {
                Log.e(TAG, "展示广告异常: " + e.getMessage(), e);
                call.reject("展示广告异常: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject result = new JSObject();
        boolean ready = mRewardVideoAD != null && mRewardVideoAD.isValid() && !mRewardVideoAD.hasShown();
        result.put("ready", ready);
        call.resolve(result);
    }
}
