package it.missionireflex.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import java.io.File;
import java.io.IOException;
import java.util.List;
import android.content.pm.ResolveInfo;
import androidx.core.content.FileProvider;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

public class MainActivity extends Activity {
    private static final String TAG = "MissioniReflex";
    private static final String APP_ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_ASSET_HOST + "/assets/www/index.html";
    private static final int FOREST = Color.rgb(238, 233, 223);

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private static final int FILE_CHOOSER_REQUEST = 4826;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;
    private File cameraOutputFile;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(FOREST);
        webView = new WebView(this);
        webView.setBackgroundColor(FOREST);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(webView, params);

        // On Android 11+, draw edge-to-edge but inset the WebView content once.
        // This keeps the 3D camera framing inside the actual visible mobile viewport.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                webView.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                float density = getResources().getDisplayMetrics().density;
                int topDp = Math.round(safe.top / density);
                int bottomDp = Math.round(safe.bottom / density);
                webView.evaluateJavascript(
                        "document.documentElement.style.setProperty('--safe-top', '" + topDp + "px');" +
                        "document.documentElement.style.setProperty('--safe-bottom', '" + bottomDp + "px');",
                        null);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // localStorage conserva i progressi sul telefono.
        settings.setDatabaseEnabled(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(true);

        webView.addJavascriptInterface(new ExternalLinks(), "MissioniAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                boolean capture = params != null && params.isCaptureEnabled();
                if (capture) {
                    return launchCameraCapture();
                }
                return launchGalleryPicker();
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d(TAG, message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_ASSET_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                openExternal(uri.toString());
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (APP_ASSET_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                openExternal(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && view.getRootWindowInsets() != null) {
                    Insets safe = view.getRootWindowInsets().getInsets(
                            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    float density = getResources().getDisplayMetrics().density;
                    int topDp = Math.round(safe.top / density);
                    int bottomDp = Math.round(safe.bottom / density);
                    view.evaluateJavascript(
                            "document.documentElement.style.setProperty('--safe-top', '" + topDp + "px');" +
                            "document.documentElement.style.setProperty('--safe-bottom', '" + bottomDp + "px');",
                            null);
                }
                // The credits use target="_blank". Route those links to the system browser.
                view.evaluateJavascript(
                        "document.querySelectorAll('a[target=\\\"_blank\\\"]').forEach(function(a){" +
                        "a.addEventListener('click',function(e){e.preventDefault();MissioniAndroid.openExternal(a.href);});" +
                        "});", null);
            }
        });

        setContentView(root);
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        webView.loadUrl(START_URL);
    }

    private boolean launchCameraCapture() {
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (camera.resolveActivity(getPackageManager()) == null) {
            Toast.makeText(this, "Fotocamera non disponibile: scegli una foto dalla galleria.", Toast.LENGTH_LONG).show();
            finishFileChooser(null);
            return true;
        }
        try {
            cameraOutputFile = File.createTempFile("mission-reflex-", ".jpg", getCacheDir());
            cameraOutputUri = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", cameraOutputFile);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            grantUriPermission(getPackageName(), cameraOutputUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            List<ResolveInfo> handlers = getPackageManager().queryIntentActivities(camera, 0);
            for (ResolveInfo info : handlers) {
                if (info.activityInfo != null) {
                    grantUriPermission(info.activityInfo.packageName, cameraOutputUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                }
            }
            startActivityForResult(camera, FILE_CHOOSER_REQUEST);
            return true;
        } catch (IOException | ActivityNotFoundException | IllegalArgumentException exception) {
            Log.e(TAG, "Impossibile aprire la fotocamera", exception);
            finishFileChooser(null);
            Toast.makeText(this, "Non riesco ad aprire la fotocamera. Prova la galleria.", Toast.LENGTH_LONG).show();
            return true;
        }
    }

    private boolean launchGalleryPicker() {
        try {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            startActivityForResult(Intent.createChooser(intent, "Scegli una fotografia"), FILE_CHOOSER_REQUEST);
            return true;
        } catch (ActivityNotFoundException | IllegalArgumentException exception) {
            Log.e(TAG, "Impossibile aprire la galleria", exception);
            finishFileChooser(null);
            Toast.makeText(this, "Nessuna app disponibile per scegliere una foto.", Toast.LENGTH_LONG).show();
            return true;
        }
    }

    private void finishFileChooser(Uri[] result) {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        }
        cameraOutputUri = null;
        cameraOutputFile = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST) return;

        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (cameraOutputUri != null && cameraOutputFile != null
                    && cameraOutputFile.exists() && cameraOutputFile.length() > 0) {
                result = new Uri[] { cameraOutputUri };
            } else if (data != null && data.getData() != null) {
                result = new Uri[] { data.getData() };
            }
        }
        finishFileChooser(result);
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(FOREST);
        window.setNavigationBarColor(FOREST);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        }
    }

    private void openExternal(String value) {
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            if (scheme == null || !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http"))) {
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
        } catch (ActivityNotFoundException | IllegalArgumentException exception) {
            Log.w(TAG, "Impossibile aprire il collegamento esterno", exception);
        }
    }

    private final class ExternalLinks {
        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> MainActivity.this.openExternal(url));
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // If a mission detail is open, Android Back behaves like its in-app back button.
        webView.evaluateJavascript(
                "(function(){if(window.HPHOTO_BACK){return window.HPHOTO_BACK();}" +
                "var p=document.getElementById('panel');" +
                "if(p&&p.classList.contains('on')){var b=document.getElementById('can');if(b){b.click();return true;}}" +
                "return false;})()",
                value -> {
                    if (!"true".equals(value)) {
                        finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        finishFileChooser(null);
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
