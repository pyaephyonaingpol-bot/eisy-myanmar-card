package com.eisymyanmar.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * Full-screen WebView shell for the Eisy Myanmar web app.
 * No action / title bar — the web UI owns chrome.
 */
public class MainActivity extends AppCompatActivity {
    private static final String TAG = "EisyMainActivity";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        try {
            setContentView(R.layout.activity_main);
        } catch (Exception e) {
            Log.e(TAG, "Failed to inflate activity_main", e);
            Toast.makeText(this, "Unable to start Eisy Myanmar", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

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
        if (webView == null) {
            Log.e(TAG, "WebView missing from layout");
            Toast.makeText(this, "WebView unavailable on this device", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        try {
            setupWebView();
            String url = BuildConfig.WEB_APP_URL;
            if (url == null || url.trim().isEmpty()) {
                url = "https://eisymyanmar.com";
            }
            webView.loadUrl(url);
        } catch (Exception e) {
            Log.e(TAG, "WebView initialization failed", e);
            Toast.makeText(this, "Unable to open the app browser", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

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
        ViewGroup.LayoutParams lp = webView.getLayoutParams();
        if (lp != null) {
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
            webView.setLayoutParams(lp);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setLayoutAlgorithm(WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Keep modern sites rendering correctly inside the system WebView.
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        try {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        } catch (Exception e) {
            Log.w(TAG, "CookieManager setup skipped", e);
        }

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
                if (request == null) return false;
                Uri uri = request.getUrl();
                if (uri == null) return false;
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                // Keep http(s) in-app; hand off payment / store / mailto schemes to the OS.
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    Log.w(TAG, "No handler for scheme=" + scheme, e);
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (view == null) return;
                // Prefer document scrolling when the site locks overflow.
                view.evaluateJavascript(
                        "(function(){"
                                + "try{"
                                + "document.documentElement.classList.add('doc-scroll');"
                                + "var s=document.getElementById('eisy-webview-scroll-fix');"
                                + "if(s) return;"
                                + "s=document.createElement('style');"
                                + "s.id='eisy-webview-scroll-fix';"
                                + "s.textContent=["
                                + "'html{height:100%!important;min-height:100%!important;"
                                + "min-height:100vh!important;overflow-x:hidden!important;"
                                + "overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;}',"
                                + "'body{position:relative!important;height:auto!important;"
                                + "min-height:100%!important;min-height:100vh!important;"
                                + "overflow-x:hidden!important;overflow-y:auto!important;"
                                + "-webkit-overflow-scrolling:touch!important;}',"
                                + "'.app-shell,.app-main,.auth-screen,#dashboardScreen{"
                                + "height:auto!important;min-height:100vh!important;overflow:visible!important;}',"
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

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.w(TAG, "WebView error " + errorCode + ": " + description + " @ " + failingUrl);
                super.onReceivedError(view, errorCode, description, failingUrl);
            }
        });

        webView.requestFocus(View.FOCUS_DOWN);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            try {
                webView.onResume();
            } catch (Exception e) {
                Log.w(TAG, "webView.onResume failed", e);
            }
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            try {
                webView.onPause();
            } catch (Exception e) {
                Log.w(TAG, "webView.onPause failed", e);
            }
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            try {
                webView.stopLoading();
                webView.loadUrl("about:blank");
                webView.setWebChromeClient(null);
                webView.setWebViewClient(null);
                ViewGroup parent = (ViewGroup) webView.getParent();
                if (parent != null) {
                    parent.removeView(webView);
                }
                webView.destroy();
            } catch (Exception e) {
                Log.w(TAG, "webView.destroy failed", e);
            }
            webView = null;
        }
        super.onDestroy();
    }
}
