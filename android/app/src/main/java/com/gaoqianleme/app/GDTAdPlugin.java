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

                        notifyListeners("onReward", result);

                        if (pendingShowCall != null) {
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
                        Log.d(TAG, "广告关闭 onADClose");
                        notifyListeners("onADClose", new JSObject());

                        // 如果 onReward 没有被触发（用户跳过），广告关闭时 resolve
                        if (pendingShowCall != null) {
                            Log.d(TAG, "广告关闭时 resolve pendingShowCall（无奖励）");
                            JSObject result = new JSObject();
                            result.put("rewardVerify", false);
                            result.put("ecpm", 0);
                            pendingShowCall.resolve(result);
                            pendingShowCall = null;
                        }
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
