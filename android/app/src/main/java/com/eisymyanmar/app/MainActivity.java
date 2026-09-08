package com.eisymyanmar.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ScrollView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * Full-screen WebView shell for the Eisy Myanmar web app.
 * No action / title bar — the web UI owns chrome.
 * WebView is wrapped in a ScrollView so long pages scroll smoothly.
 */
public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ScrollView scrollView;

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

        scrollView = findViewById(R.id.scroll);
        setupScrollView();

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

    private void setupScrollView() {
        if (scrollView == null) return;
        scrollView.setFillViewport(true);
        scrollView.setVerticalScrollBarEnabled(true);
        scrollView.setHorizontalScrollBarEnabled(false);
        scrollView.setSmoothScrollingEnabled(true);
        scrollView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        scrollView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
    }

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    private void setupWebView() {
        // Ensure match_parent width; height is wrap_content so ScrollView can scroll.
        ViewGroup.LayoutParams lp = webView.getLayoutParams();
        if (lp != null) {
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.height = ViewGroup.LayoutParams.WRAP_CONTENT;
            webView.setLayoutParams(lp);
        }

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

        // Vertical scrolling enabled in code (ScrollView + WebView).
        webView.setVerticalScrollBarEnabled(true);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        // Parent ScrollView owns the gesture; avoid nested-scroll fighting.
        webView.setNestedScrollingEnabled(false);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setScrollbarFadingEnabled(true);
        webView.setBackgroundColor(Color.parseColor("#0F172A"));

        // Prefer ScrollView for vertical drag; still allow WebView link taps.
        webView.setOnTouchListener((v, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    // Let ScrollView intercept after this down if needed.
                    if (v.getParent() != null) {
                        v.getParent().requestDisallowInterceptTouchEvent(false);
                    }
                    break;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    if (v.getParent() != null) {
                        v.getParent().requestDisallowInterceptTouchEvent(false);
                    }
                    break;
                default:
                    break;
            }
            return false;
        });

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
                                + "overflow-x:hidden!important;overflow-y:visible!important;"
                                + "-webkit-overflow-scrolling:touch!important;}',"
                                + "'.app-shell{height:auto!important;min-height:100dvh!important;"
                                + "overflow:visible!important;}',"
                                + "'.app-content{overflow:visible!important;"
                                + "-webkit-overflow-scrolling:touch!important;}',"
                                + "'#app{min-height:100%!important;}'"
                                + "].join('');"
                                + "document.head.appendChild(s);"
                                + "document.documentElement.style.overflowY='visible';"
                                + "if(document.body) document.body.style.overflowY='visible';"
                                + "}catch(e){}"
                                + "})();",
                        value -> {
                            // Re-measure after CSS unlock so ScrollView sees full height.
                            view.post(() -> {
                                view.requestLayout();
                                if (scrollView != null) {
                                    scrollView.requestLayout();
                                }
                            });
                        }
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
        scrollView = null;
        super.onDestroy();
    }
}
