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
import com.qq.e.comm.listeners.NegativeFeedbackListener;
import com.qq.e.comm.pi.IReward;
import com.qq.e.comm.util.AdError;

import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "GDTAd")
public class GDTAdPlugin extends Plugin {

    private static final String TAG = "GDTAdPlugin";
    private RewardVideoAD mRewardVideoAD;
    private RewardVideoADListener mRewardVideoADListener;  // 保持强引用，防止GC回收
    private PluginCall pendingShowCall;
    private boolean isRewardGiven = false;
    private double mSavedEcpm = 0;  // 保价广告位在onADLoad时获取的ECPM
    private String mSavedEcpmLevel = "";
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

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
                mSavedEcpm = 0;
                mSavedEcpmLevel = "";

                // 创建监听器并保存为成员变量，防止被GC回收
                mRewardVideoADListener = new RewardVideoADListener() {
                    @Override
                    public void onADLoad() {
                        Log.d(TAG, "广告加载成功 onADLoad");

                        // 按照官方文档获取广告信息
                        try {
                            mSavedEcpm = mRewardVideoAD.getECPM();
                            mSavedEcpmLevel = mRewardVideoAD.getECPMLevel();

                            int rewardAdType = mRewardVideoAD.getRewardAdType();
                            long videoDuration = mRewardVideoAD.getVideoDuration();

                            Log.d(TAG, "广告类型: " + (rewardAdType == RewardVideoAD.REWARD_TYPE_VIDEO ? "视频" : "页面"));
                            Log.d(TAG, "视频时长: " + videoDuration + "ms");
                            Log.d(TAG, "ECPM: " + mSavedEcpm + ", ECPMLevel: " + mSavedEcpmLevel);

                            Map<String, Object> extraInfo = mRewardVideoAD.getExtraInfo();
                            if (extraInfo != null) {
                                Log.d(TAG, "ExtraInfo mp: " + extraInfo.get("mp") + ", request_id: " + extraInfo.get("request_id"));
                            }
                        } catch (Exception e) {
                            Log.w(TAG, "获取广告信息失败: " + e.getMessage());
                        }

                        notifyListeners("onADLoad", new JSObject());
                    }

                    @Override
                    public void onVideoCached() {
                        Log.d(TAG, "视频缓存成功 onVideoCached");
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
                        // 与官方 Demo 一致：获取 TRANS_ID 和 DEV_EXT
                        Log.i(TAG, "onReward " + map.get(ServerSideVerificationOptions.TRANS_ID) + " " + map.get(IReward.DEV_EXT));
                        Log.d(TAG, "onReward 完整map: " + map);
                        isRewardGiven = true;
                        completeReward("onReward", map);
                    }

                    @Override
                    public void onADClick() {
                        Log.d(TAG, "广告点击 onADClick");
                        notifyListeners("onADClick", new JSObject());
                    }

                    @Override
                    public void onVideoComplete() {
                        Log.d(TAG, "视频播放完成 onVideoComplete, savedEcpm=" + mSavedEcpm);
                        // 保价广告位：用保存的ECPM判断奖励
                        // ECPM有值就说明广告有效，用户看完了就应该给奖励
                        if (!isRewardGiven && mSavedEcpm > 0) {
                            Log.d(TAG, "保价广告位：ECPM有效，发放奖励");
                            isRewardGiven = true;
                            completeReward("onVideoComplete", null);
                        } else if (!isRewardGiven) {
                            Log.d(TAG, "保价广告位：ECPM为0，可能是无效广告");
                        }
                        notifyListeners("onVideoComplete", new JSObject());
                    }

                    private void completeReward(String source, Map<String, Object> map) {
                        JSObject result = new JSObject();
                        result.put("rewardVerify", true);
                        result.put("rewardSource", source);

                        // 使用官方文档要求的 ServerSideVerificationOptions.TRANS_ID
                        if (map != null && map.containsKey(ServerSideVerificationOptions.TRANS_ID)) {
                            result.put("transid", map.get(ServerSideVerificationOptions.TRANS_ID));
                        }
                        // 同时添加 DEV_EXT
                        if (map != null && map.containsKey(IReward.DEV_EXT)) {
                            result.put("devExt", map.get(IReward.DEV_EXT));
                        }

                        // 优先使用onADLoad时保存的ECPM（更可靠）
                        double ecpmValue = mSavedEcpm;
                        String ecpmLevel = mSavedEcpmLevel;

                        // 如果保存的ECPM为0，再尝试实时获取
                        if (ecpmValue == 0 && mRewardVideoAD != null) {
                            try {
                                ecpmValue = mRewardVideoAD.getECPM();
                                ecpmLevel = mRewardVideoAD.getECPMLevel();
                                Log.d(TAG, "实时获取ECPM: " + ecpmValue + ", ECPMLevel: " + ecpmLevel);
                            } catch (Exception e) {
                                Log.w(TAG, "实时获取ECPM失败: " + e.getMessage());
                            }
                        }

                        result.put("ecpm", ecpmValue);
                        result.put("ecpmLevel", ecpmLevel);
                        Log.d(TAG, "最终返回的ECPM: " + ecpmValue + ", ECPMLevel: " + ecpmLevel + ", source: " + source);

                        notifyListeners("onReward", result);
                        Log.d(TAG, "已通知前端 onReward (source: " + source + ")");

                        if (pendingShowCall != null) {
                            Log.d(TAG, "resolve pendingShowCall (奖励成功)");
                            pendingShowCall.resolve(result);
                            pendingShowCall = null;
                        }
                    }

                    @Override
                    public void onADClose() {
                        Log.d(TAG, "广告关闭 onADClose, isRewardGiven=" + isRewardGiven + ", savedEcpm=" + mSavedEcpm);
                        notifyListeners("onADClose", new JSObject());

                        // 延迟处理，给 onReward/onVideoComplete 足够时间先执行
                        handler.postDelayed(() -> {
                            if (pendingShowCall != null) {
                                if (isRewardGiven) {
                                    Log.d(TAG, "onADClose delayed: 奖励已发放");
                                } else if (mSavedEcpm > 0) {
                                    // 兜底：ECPM有值说明广告有效，即使onVideoComplete没触发也发放奖励
                                    Log.d(TAG, "onADClose delayed: 兜底发奖，ECPM有效(" + mSavedEcpm + ")");
                                    isRewardGiven = true;
                                    completeReward("onADClose_fallback", null);
                                } else {
                                    Log.d(TAG, "onADClose delayed: ECPM为0，判定为失败");
                                    JSObject result = new JSObject();
                                    result.put("rewardVerify", false);
                                    result.put("ecpm", 0);
                                    pendingShowCall.resolve(result);
                                    pendingShowCall = null;
                                }
                            }
                        }, 500);
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
                };

                // 创建 RewardVideoAD，有声播放（与官方 Demo 一致）
                mRewardVideoAD = new RewardVideoAD(activity, posId, mRewardVideoADListener, true);

                // 设置负面反馈监听器（官方文档要求）
                mRewardVideoAD.setNegativeFeedbackListener(new NegativeFeedbackListener() {
                    @Override
                    public void onComplainSuccess() {
                        Log.i(TAG, "onComplainSuccess: 用户反馈成功");
                    }
                });

                // 设置服务端验证选项（与官方 Demo 一致，即使没有服务端也建议设置）
                ServerSideVerificationOptions options = new ServerSideVerificationOptions.Builder()
                        .setCustomData("APP's custom data")
                        .setUserId("APP's user id for server verify")
                        .build();
                mRewardVideoAD.setServerSideVerificationOptions(options);
                Log.d(TAG, "已设置 ServerSideVerificationOptions");

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
        Log.d(TAG, "显示广告，mRewardVideoAD=" + mRewardVideoAD);

        Activity activity = getActivity();
        if (activity == null) {
            Log.e(TAG, "Activity 为空");
            call.reject("Activity 为空");
            return;
        }

        if (mRewardVideoAD == null) {
            Log.e(TAG, "广告未加载");
            call.reject("广告未加载");
            return;
        }

        // 先在当前线程检查广告状态
        boolean isValid = mRewardVideoAD.isValid();
        boolean hasShown = mRewardVideoAD.hasShown();
        Log.d(TAG, "广告状态检查: isValid=" + isValid + ", hasShown=" + hasShown);

        if (!isValid) {
            Log.e(TAG, "广告无效 (isValid=false)");
            call.reject("广告无效");
            return;
        }

        if (hasShown) {
            Log.e(TAG, "广告已展示过 (hasShown=true)");
            call.reject("广告已展示过");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                Log.d(TAG, "在主线程调用 showAD()...");
                pendingShowCall = call;
                isRewardGiven = false;
                mRewardVideoAD.showAD();
                Log.d(TAG, "showAD() 调用成功");
            } catch (Exception e) {
                Log.e(TAG, "展示广告异常: " + e.getMessage(), e);
                pendingShowCall = null;
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
