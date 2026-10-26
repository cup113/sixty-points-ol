package io.github.cup113.sixty;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * 返回键：先在 WebView 的历史里退，退无可退才交回系统（= 退出应用）。
 *
 * 为什么要自己写：核过 @capacitor/android 8.5.3 的源码 —— BridgeActivity 没有
 * onBackPressed 覆写，核心里的 App 类也只剩状态通知，回退事件归 @capacitor/app 插件管。
 * 我们没引那个插件（不需要它的 JS 侧接口），所以不写这一段的话，按返回就是
 * 「不论在哪一屏都直接退出应用」，牌桌正打着也是。
 *
 * SvelteKit 的客户端路由走 history.pushState，WebView 的历史栈能反映出来，
 * 因此 canGoBack() 就是「还有上一屏」。
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                Bridge bridge = getBridge();
                WebView webView = bridge != null ? bridge.getWebView() : null;

                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }

                // 退到底了才真的退出：临时关掉自己，让系统继续派发（finish / 后台）
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }
}
