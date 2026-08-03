package com.qingxujifen.app;

import android.app.Application;
import android.content.Context;
import android.provider.Settings;
import android.util.Log;

import com.qq.e.comm.managers.GDTAdSdk;
import com.qq.e.comm.managers.setting.GlobalSetting;

public class MainApplication extends Application {

    private static final String TAG = "MainApplication";
    // 优量汇 AppID
    private static final String APP_ID = "1218984868";

    @Override
    public void onCreate() {
        super.onCreate();

        Log.d(TAG, "Application onCreate");

        String deviceId = getMyDeviceId();
        Log.d(TAG, "========================================");
        Log.d(TAG, "设备 ID: " + deviceId);
        Log.d(TAG, "请将此设备 ID 添加到优量汇后台的测试设备列表中");
        Log.d(TAG, "========================================");

        initGDTAdSDK();
    }

    private String getMyDeviceId() {
        try {
            return Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        } catch (Exception e) {
            Log.e(TAG, "获取设备ID失败: " + e.getMessage());
            return "unknown";
        }
    }

    private void initGDTAdSDK() {
        try {
            Log.d(TAG, "开始初始化优量汇(GDT)广告SDK，App ID: " + APP_ID);

            GlobalSetting.setChannel(1);
            GlobalSetting.setEnableCollectAppInstallStatus(true);

            // 4.560.1430 版本后使用 initWithoutStart + start 方式
            // initWithoutStart 不会采集用户信息，但必须尽快调用 start
            GDTAdSdk.initWithoutStart(this, APP_ID);

            // 调用 start 启动 SDK，否则可能影响广告填充
            GDTAdSdk.start(new GDTAdSdk.OnStartListener() {
                @Override
                public void onStartSuccess() {
                    Log.d(TAG, "✅ 优量汇(GDT)广告SDK启动成功，可以开始拉取广告");
                }

                @Override
                public void onStartFailed(Exception e) {
                    Log.e(TAG, "❌ 优量汇(GDT)广告SDK启动失败: " + e.toString());
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "优量汇SDK初始化异常: " + e.getMessage(), e);
        }
    }
}
