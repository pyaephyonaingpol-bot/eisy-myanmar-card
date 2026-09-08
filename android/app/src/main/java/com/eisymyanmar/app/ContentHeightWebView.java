package com.eisymyanmar.app;

import android.content.Context;
import android.util.AttributeSet;
import android.webkit.WebView;

/**
 * WebView that reports its full content height during measure so a parent
 * {@link android.widget.ScrollView} can scroll the page when content is taller
 * than the screen.
 */
public class ContentHeightWebView extends WebView {
    public ContentHeightWebView(Context context) {
        super(context);
    }

    public ContentHeightWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public ContentHeightWebView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        // Expand to content height so ScrollView (not an inner clipped WebView)
        // owns vertical scrolling.
        int expandSpec = MeasureSpec.makeMeasureSpec(Integer.MAX_VALUE >> 2, MeasureSpec.AT_MOST);
        super.onMeasure(widthMeasureSpec, expandSpec);
    }
}
