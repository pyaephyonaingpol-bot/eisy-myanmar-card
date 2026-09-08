package com.eisymyanmar.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * Full-screen WebView shell for the Eisy Myanmar web app.
 * No action / title bar — the web UI owns chrome.
 * Vertical scrolling is enabled so long pages scroll smoothly.
 */
public class MainActivity extends AppCompatActivity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Ensure no action bar even if a parent theme reintroduces one.
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }

        // Fit content between status / nav bars so 100vh layouts match the
        // visible WebView height (avoids clipped, non-scrollable pages).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setStatusBarColor(Color.parseColor("#0F172A"));
        getWindow().setNavigationBarColor(Color.parseColor("#0F172A"));
        WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (insetsController != null) {
            insetsController.setAppearanceLightStatusBars(false);
            insetsController.setAppearanceLightNavigationBars(false);
        }

        webView = findViewById(R.id.webview);
        setupWebView();
        webView.loadUrl(BuildConfig.WEB_APP_URL);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // Fit modern mobile viewport meta without overview-mode squashing.
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setLayoutAlgorithm(WebSettings.LayoutAlgorithm.NORMAL);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        // Explicit vertical scrolling for long pages / inner overflow areas.
        webView.setVerticalScrollBarEnabled(true);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        webView.setNestedScrollingEnabled(true);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setScrollbarFadingEnabled(true);
        webView.setBackgroundColor(Color.parseColor("#0F172A"));

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                // Keep http(s) in-app; hand off payment / store schemes to the OS.
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // No handler installed for custom scheme.
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Prefer document scrolling when the site locks overflow on
                // html/body/.app-shell (common cause of "stuck" WebView pages).
                view.evaluateJavascript(
                        "(function(){"
                                + "try{"
                                + "var s=document.getElementById('eisy-webview-scroll-fix');"
                                + "if(s) return;"
                                + "s=document.createElement('style');"
                                + "s.id='eisy-webview-scroll-fix';"
                                + "s.textContent=["
                                + "'html,body{height:auto!important;min-height:100%!important;"
                                + "overflow-x:hidden!important;overflow-y:auto!important;"
                                + "-webkit-overflow-scrolling:touch!important;}',"
                                + "'.app-shell{height:auto!important;min-height:100dvh!important;"
                                + "overflow:visible!important;}',"
                                + "'.app-content{overflow:visible!important;"
                                + "-webkit-overflow-scrolling:touch!important;}',"
                                + "'#app{min-height:100%!important;}'"
                                + "].join('');"
                                + "document.head.appendChild(s);"
                                + "document.documentElement.style.overflowY='auto';"
                                + "if(document.body) document.body.style.overflowY='auto';"
                                + "}catch(e){}"
                                + "})();",
                        null
                );
            }
        });

        webView.requestFocus(View.FOCUS_DOWN);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
